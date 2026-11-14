import Foundation

/// 一條已建立且完成版本協商的客戶端連線。
///
/// 負責 frame 的收送、`replyTo` 對應與版本檢查；重連、epoch 比對與補送的決策
/// 在 `CardiaryClient`。事件透過 `events` 串流送出，呼叫端在自己的工作裡消費。
public actor CardiaryConnection {
    /// `system.hello` 的結果。
    public struct Handshake: Equatable, Sendable {
        public let connectionId: String
        /// 這次連線所屬的事件 epoch。重連時用來判斷要不要重新載入快照。
        public let epoch: String
        public let negotiatedVersion: Int
        public let limits: ServerLimits
        public let capabilities: ServerCapabilities
        public let serverName: String
        public let serverVersion: String
    }

    public struct RequestOptions: Sendable {
        public var timeout: Duration

        public init(timeout: Duration = .seconds(10)) {
            self.timeout = timeout
        }

        public static let `default` = RequestOptions()
    }

    public nonisolated let events: AsyncStream<ServerFrame>

    private let transport: any CardiaryTransport
    private let clientToken: String
    private let eventContinuation: AsyncStream<ServerFrame>.Continuation

    private var pending: [String: CheckedContinuation<ServerFrame, Error>] = [:]
    private var readerTask: Task<Void, Never>?
    private var closed = false
    private var handshake: Handshake?

    public init(transport: any CardiaryTransport, clientToken: String) {
        self.transport = transport
        self.clientToken = clientToken
        let (stream, continuation) = AsyncStream.makeStream(of: ServerFrame.self)
        self.events = stream
        self.eventContinuation = continuation
    }

    /// 送出 `system.hello`、驗證版本並回傳協商結果。
    ///
    /// `resumeSystemSeq` 只用於診斷：主機不靠它決定補送，補送由每個訂閱各自的
    /// `lastSeq` 與 `epoch` 決定。
    public func open(
        client: ClientInfo,
        resumeSystemSeq: Int? = nil,
        options: RequestOptions = .default
    ) async throws -> Handshake {
        guard !closed else { throw CardiaryClientError.connectionClosed }
        if let handshake { return handshake }

        let request = SystemHelloRequest(
            id: RequestID.next(),
            payload: SystemHelloRequestPayload(
                auth: HelloAuth(token: clientToken),
                protocol: ProtocolRange(min: ProtocolVersion.current, max: ProtocolVersion.current),
                client: client,
                resume: resumeSystemSeq.map { HelloResume(systemSeq: $0) }
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemHelloResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.hello 收到 \(frame.kindLabel) 而不是回應。"
            )
        }

        let negotiated = response.payload.protocol.version
        guard negotiated == ProtocolVersion.current else {
            throw CardiaryClientError.incompatibleVersion(
                serverMin: response.payload.protocol.min,
                serverMax: response.payload.protocol.max
            )
        }

        let result = Handshake(
            connectionId: response.payload.connectionId,
            epoch: response.payload.epoch,
            negotiatedVersion: negotiated,
            limits: response.payload.limits,
            capabilities: response.payload.capabilities,
            serverName: response.payload.server.name,
            serverVersion: response.payload.server.version
        )
        handshake = result
        return result
    }

    /// 訂閱 `system` 串流。帶 `lastSeq` 與 `epoch` 時主機會嘗試補送；不帶就回快照。
    public func subscribeSystem(
        lastSeq: Int? = nil,
        epoch: String? = nil,
        options: RequestOptions = .default
    ) async throws -> SystemSubscribeResponsePayload {
        let request = SystemSubscribeRequest(
            id: RequestID.next(),
            payload: SystemSubscribeRequestPayload(lastSeq: lastSeq, epoch: epoch)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemSubscribeResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.subscribe 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 訂閱單一會話串流。
    public func subscribeSession(
        sessionId: String,
        lastSeq: Int? = nil,
        epoch: String? = nil,
        historyLimit: Int? = nil,
        options: RequestOptions = .default
    ) async throws -> SessionSubscribeResponsePayload {
        let request = SessionSubscribeRequest(
            id: RequestID.next(),
            payload: SessionSubscribeRequestPayload(
                sessionId: sessionId,
                lastSeq: lastSeq,
                epoch: epoch,
                historyLimit: historyLimit
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionSubscribeResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.subscribe 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func listSessions(
        cursor: String? = nil,
        limit: Int? = nil,
        options: RequestOptions = .default
    ) async throws -> SessionListResponsePayload {
        let request = SessionListRequest(
            id: RequestID.next(),
            payload: SessionListRequestPayload(cursor: cursor, limit: limit)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionListResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.list 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 緊急全部暫停：暫停所有等待中的審批。
    public func pauseAllApprovals(
        reason: String? = nil,
        options: RequestOptions = .default
    ) async throws -> ApprovalPauseAllResponsePayload {
        let request = ApprovalPauseAllRequest(
            id: RequestID.next(),
            payload: ApprovalPauseAllRequestPayload(reason: reason)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .approvalPauseAllResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "approval.pause_all 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func close() async {
        guard !closed else { return }
        closed = true
        readerTask?.cancel()
        readerTask = nil
        let all = pending
        pending.removeAll()
        for (_, continuation) in all {
            continuation.resume(throwing: CardiaryClientError.connectionClosed)
        }
        eventContinuation.finish()
        await transport.close()
    }

    // MARK: - 收送

    private func perform<T: Encodable>(
        id: String,
        encode request: T,
        options: RequestOptions
    ) async throws -> ServerFrame {
        guard !closed else { throw CardiaryClientError.connectionClosed }
        startReaderIfNeeded()

        let text: String
        do {
            let data = try JSONEncoder().encode(request)
            guard let encoded = String(data: data, encoding: .utf8) else {
                throw CardiaryClientError.invalidFrame("請求無法編碼成 UTF-8。")
            }
            text = encoded
        } catch let error as CardiaryClientError {
            throw error
        } catch {
            throw CardiaryClientError.invalidFrame("請求編碼失敗：\(error)")
        }

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            Task { [transport] in
                do {
                    try await transport.send(text)
                } catch {
                    await self.failPending(id: id, error: error)
                    return
                }
                if let timeout = Self.nanoseconds(options.timeout) {
                    try? await Task.sleep(nanoseconds: timeout)
                    await self.failPending(id: id, error: CardiaryClientError.timeout)
                }
            }
        }
    }

    private static func nanoseconds(_ duration: Duration) -> UInt64? {
        let components = duration.components
        guard components.seconds >= 0, components.attoseconds >= 0 else { return nil }
        let seconds = UInt64(components.seconds)
        let attoseconds = UInt64(components.attoseconds / 1_000_000_000)
        let (whole, overflow) = seconds.multipliedReportingOverflow(by: 1_000_000_000)
        guard !overflow else { return nil }
        return whole + attoseconds
    }

    private func startReaderIfNeeded() {
        guard readerTask == nil, !closed else { return }
        readerTask = Task { [weak self] in
            await self?.readLoop()
        }
    }

    private func readLoop() async {
        while !closed {
            let text: String?
            do {
                text = try await transport.receive()
            } catch {
                await finish(with: error)
                return
            }
            guard let text else {
                await finish(with: CardiaryClientError.connectionClosed)
                return
            }
            do {
                try handle(text)
            } catch {
                await finish(with: error)
                return
            }
        }
    }

    private func handle(_ text: String) throws {
        guard let data = text.data(using: .utf8) else {
            throw CardiaryClientError.invalidFrame("訊息不是 UTF-8。")
        }
        let frame: ServerFrame
        do {
            frame = try JSONDecoder().decode(ServerFrame.self, from: data)
        } catch {
            throw CardiaryClientError.invalidFrame("\(error)")
        }

        switch frame {
        case .errorFrame(let error):
            guard let replyTo = error.replyTo else {
                throw wrappedError(error)
            }
            guard let continuation = pending.removeValue(forKey: replyTo) else {
                throw CardiaryClientError.unexpectedReply(replyTo)
            }
            continuation.resume(throwing: wrappedError(error))
        case .systemHelloResponse(let response):
            resume(response.replyTo, with: frame)
        case .systemSubscribeResponse(let response):
            resume(response.replyTo, with: frame)
        case .systemUnsubscribeResponse(let response):
            resume(response.replyTo, with: frame)
        case .sessionCreateResponse(let response):
            resume(response.replyTo, with: frame)
        case .sessionListResponse(let response):
            resume(response.replyTo, with: frame)
        case .sessionSendMessageResponse(let response):
            resume(response.replyTo, with: frame)
        case .sessionInterruptResponse(let response):
            resume(response.replyTo, with: frame)
        case .sessionSubscribeResponse(let response):
            resume(response.replyTo, with: frame)
        case .sessionUnsubscribeResponse(let response):
            resume(response.replyTo, with: frame)
        case .sessionGetHistoryResponse(let response):
            resume(response.replyTo, with: frame)
        case .approvalDecideResponse(let response):
            resume(response.replyTo, with: frame)
        case .approvalPauseAllResponse(let response):
            resume(response.replyTo, with: frame)
        case .moduleResponse(let response):
            resume(response.replyTo, with: frame)
        default:
            eventContinuation.yield(frame)
        }
    }

    private func resume(_ replyTo: String, with frame: ServerFrame) {
        guard let continuation = pending.removeValue(forKey: replyTo) else {
            // 沒有對應請求的回應是協定錯誤：丟棄並關閉，避免偽造的回應被套用。
            eventContinuation.finish()
            return
        }
        continuation.resume(returning: frame)
    }

    private func wrappedError(_ error: ErrorFrame) -> CardiaryClientError {
        if error.code == .incompatibleVersion {
            let details = error.details
            return .incompatibleVersion(
                serverMin: details?["serverMin"]?.intValue,
                serverMax: details?["serverMax"]?.intValue
            )
        }
        return .server(error)
    }

    private func failPending(id: String, error: Error) {
        guard let continuation = pending.removeValue(forKey: id) else { return }
        continuation.resume(throwing: error)
    }

    private func finish(with error: Error) async {
        guard !closed else { return }
        closed = true
        readerTask?.cancel()
        readerTask = nil
        let clientError = (error as? CardiaryClientError) ?? .invalidFrame("\(error)")
        let all = pending
        pending.removeAll()
        for (_, continuation) in all {
            continuation.resume(throwing: clientError)
        }
        eventContinuation.finish()
        await transport.close()
    }
}
