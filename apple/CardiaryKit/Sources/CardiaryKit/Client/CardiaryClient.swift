import Foundation

/// 連線失敗後的重連節奏。故意放慢到 4 秒上限，避免服務還沒準備好就被打滿。
public struct ReconnectPolicy: Equatable, Sendable {
    public var baseDelay: Duration
    public var maxDelay: Duration
    public var maxAttempts: Int?

    public init(
        baseDelay: Duration = .milliseconds(250),
        maxDelay: Duration = .seconds(4),
        maxAttempts: Int? = nil
    ) {
        self.baseDelay = baseDelay
        self.maxDelay = maxDelay
        self.maxAttempts = maxAttempts
    }

    public static let `default` = ReconnectPolicy()

    public func delay(afterAttempt attempt: Int) -> Duration {
        guard attempt > 1 else { return baseDelay }
        var delay = baseDelay
        for _ in 1..<attempt {
            delay = delay * 2
            if delay >= maxDelay { return maxDelay }
        }
        return min(delay, maxDelay)
    }
}

/// 殼使用的客戶端：負責連線、版本協商、訂閱與斷線重連。
///
/// 補送規則在 `StreamCursor`：重連時先比對 `system.hello` 回報的 epoch；不同就
/// 要求完整快照，不帶 `lastSeq`。同一個 epoch 才帶 `lastSeq` 補送。
public actor CardiaryClient {
    public struct Configuration: Sendable {
        public var endpoint: URL
        public var clientToken: String
        public var client: ClientInfo
        public var reconnect: ReconnectPolicy
        /// 是否在連上後列出並訂閱進行中的會話（待審批數量需要）。
        public var subscribeActiveSessions: Bool

        public init(
            endpoint: URL,
            clientToken: String,
            client: ClientInfo,
            reconnect: ReconnectPolicy = .default,
            subscribeActiveSessions: Bool = true
        ) {
            self.endpoint = endpoint
            self.clientToken = clientToken
            self.client = client
            self.reconnect = reconnect
            self.subscribeActiveSessions = subscribeActiveSessions
        }
    }

    public enum State: Equatable, Sendable {
        case idle
        case connecting(attempt: Int)
        case connected(epoch: String, serverVersion: String)
        case disconnected(reason: String)
        case stopped
    }

    private let configuration: Configuration
    private let transportFactory: @Sendable (URL) -> any CardiaryTransport

    private var connection: CardiaryConnection?
    private var state: State = .idle
    private var runTask: Task<Void, Never>?
    private var systemModel = SystemStatusModel()
    private var sessions: [String: SessionStreamModel] = [:]
    private var approvals = ApprovalCounter()
    private var forceFullSnapshot = false
    private var hasConnectedBefore = false

    /// 回呼。殼在 `start()` 之前設定；之後只讀。
    public nonisolated let handlers = Handlers()

    public init(
        configuration: Configuration,
        transportFactory: @escaping @Sendable (URL) -> any CardiaryTransport = { WebSocketTransport(endpoint: $0) }
    ) {
        self.configuration = configuration
        self.transportFactory = transportFactory
    }

    public var currentState: State { state }

    public var systemStatus: SystemStatus? { systemModel.status }

    public func start() {
        guard runTask == nil else { return }
        runTask = Task { [weak self] in
            await self?.runLoop()
        }
    }

    public func stop() async {
        runTask?.cancel()
        runTask = nil
        await connection?.close()
        connection = nil
        update(state: .stopped)
    }

    /// 緊急全部暫停。連線不在時直接報錯，由畫面顯示「服務未連線」。
    public func pauseAllApprovals(reason: String) async throws {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        _ = try await connection.pauseAllApprovals(reason: reason)
    }

    // MARK: - 連線迴圈

    private func runLoop() async {
        var attempt = 0
        while !Task.isCancelled {
            attempt += 1
            update(state: .connecting(attempt: attempt))
            do {
                try await connectOnce()
                // 連線期間出錯會拋出，統一由下面的 catch 處理。
            } catch {
                if Task.isCancelled { return }
                let reason = (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
                update(state: .disconnected(reason: reason))
                handlers.onDiagnostic?("客戶端連線中斷：\(reason)")

                if case .incompatibleVersion = error as? CardiaryClientError {
                    // 版本不符不是暫時性錯誤：停止重連，由畫面顯示「需要更新」。
                    handlers.onDiagnostic?("協定版本不符，停止重連。")
                    return
                }

                if let maxAttempts = configuration.reconnect.maxAttempts, attempt >= maxAttempts {
                    return
                }
                let delay = configuration.reconnect.delay(afterAttempt: attempt)
                try? await Task.sleep(for: delay)
                continue
            }
            attempt = 0
        }
    }

    private func connectOnce() async throws {
        let connection = CardiaryConnection(
            transport: transportFactory(configuration.endpoint),
            clientToken: configuration.clientToken
        )
        self.connection = connection

        let handshake: CardiaryConnection.Handshake
        do {
            handshake = try await connection.open(
                client: configuration.client,
                resumeSystemSeq: systemModel.cursor.lastSeq > 0 ? systemModel.cursor.lastSeq : nil
            )
        } catch {
            // 連線失敗要收掉底層 transport，否則重連會累積半開的連線。
            await connection.close()
            self.connection = nil
            throw error
        }

        let epochChanged = hasConnectedBefore && systemModel.cursor.epoch != nil
            && systemModel.cursor.epoch != handshake.epoch
        if epochChanged || forceFullSnapshot {
            // 舊 epoch 的 lastSeq 一律無效：丟掉游標與會話狀態，要求完整快照。
            systemModel = SystemStatusModel(epoch: handshake.epoch, lastSeq: 0)
            sessions.removeAll()
            approvals.reset()
            forceFullSnapshot = false
            handlers.onDiagnostic?("事件 epoch 改變（\(handshake.epoch)），重新載入快照。")
        }
        hasConnectedBefore = true
        if systemModel.cursor.epoch == nil {
            systemModel = SystemStatusModel(epoch: handshake.epoch, lastSeq: 0)
        }
        update(state: .connected(epoch: handshake.epoch, serverVersion: handshake.serverVersion))

        let parameters = systemModel.cursor.subscriptionParameters(currentEpoch: handshake.epoch)
        let subscribe: SystemSubscribeResponsePayload
        do {
            subscribe = try await connection.subscribeSystem(
                lastSeq: parameters.lastSeq,
                epoch: parameters.epoch
            )
        } catch {
            await connection.close()
            self.connection = nil
            throw error
        }
        if let snapshot = subscribe.snapshot {
            systemModel.applySnapshot(snapshot, epoch: subscribe.epoch, seq: subscribe.seq)
            // 只有真的套用快照才回報一次；補送的情況等事件推進，避免重複通知。
            if let status = systemModel.status {
                handlers.onSystemStatus?(status)
            }
        } else {
            // 沒有快照代表主機要補送 lastSeq + 1 到回應 seq 的事件；保留 lastSeq，
            // 讓補送事件推進游標，否則全部會被當成重複。
            systemModel.adoptEpochOnly(subscribe.epoch)
        }

        if configuration.subscribeActiveSessions {
            await subscribeActiveSessions(on: connection, epoch: subscribe.epoch)
        }

        for await frame in connection.events {
            if Task.isCancelled { break }
            handle(frame: frame, connectionEpoch: handshake.epoch, connection: connection)
        }
        await connection.close()
        if Task.isCancelled { return }
        throw CardiaryClientError.connectionClosed
    }

    private func subscribeActiveSessions(on connection: CardiaryConnection, epoch: String) async {
        do {
            var summaries: [SessionSummary] = []
            var cursor: String?
            var pageCount = 0
            repeat {
                let page = try await connection.listSessions(cursor: cursor, limit: 50)
                summaries.append(contentsOf: page.sessions)
                cursor = page.nextCursor
                pageCount += 1
            } while cursor != nil && pageCount < 20

            for summary in summaries where summary.status == .running {
                let existing = sessions[summary.id]
                let parameters = (existing?.cursor ?? StreamCursor(stream: "session:\(summary.id)"))
                    .subscriptionParameters(currentEpoch: epoch)
                let response = try await connection.subscribeSession(
                    sessionId: summary.id,
                    lastSeq: parameters.lastSeq,
                    epoch: parameters.epoch
                )
                var model = existing ?? SessionStreamModel(sessionId: summary.id)
                if let snapshot = response.snapshot {
                    model.applySnapshot(snapshot, epoch: response.epoch, seq: response.seq)
                } else {
                    // 同 epoch 的補送：保留 lastSeq，等事件推進。
                    model.adoptEpochOnly(response.epoch)
                }
                sessions[summary.id] = model
            }
        } catch {
            // 會話列表失敗不影響系統串流；待審批數量會在下次重連時補上。
            handlers.onDiagnostic?("列出會話失敗：\(error)")
        }
    }

    private func handle(
        frame: ServerFrame,
        connectionEpoch: String,
        connection: CardiaryConnection
    ) {
        switch frame {
        case .systemStatusEvent(let event):
            let advance = systemModel.apply(event)
            switch advance {
            case .applied:
                if let status = systemModel.status {
                    handlers.onSystemStatus?(status)
                }
            case .gap:
                forceFullSnapshot = true
                handlers.onDiagnostic?("system 串流有缺口，要求完整快照。")
                Task { await connection.close() }
            case .epochChanged:
                forceFullSnapshot = true
                Task { await connection.close() }
            case .duplicate:
                break
            }

        default:
            approvals.apply(frame)
            handlers.onApprovalCount?(approvals.count)

            if let stream = frame.eventStream, let sessionId = Self.sessionId(from: stream),
                var model = sessions[sessionId]
            {
                let advance = model.apply(frame)
                sessions[sessionId] = model
                if case .gap = advance {
                    forceFullSnapshot = true
                    Task { await connection.close() }
                }
            }
        }
    }

    private static func sessionId(from stream: String) -> String? {
        let prefix = "session:"
        guard stream.hasPrefix(prefix) else { return nil }
        return String(stream.dropFirst(prefix.count))
    }

    private func update(state: State) {
        guard self.state != state else { return }
        self.state = state
        handlers.onStateChange?(state)
    }
}


/// 客戶端的回呼集合。用鎖保護，讓殼與測試可以從任何執行緒設定與讀取。
public final class Handlers: @unchecked Sendable {
    private let lock = NSLock()
    private var stateHandler: (@Sendable (CardiaryClient.State) -> Void)?
    private var statusHandler: (@Sendable (SystemStatus) -> Void)?
    private var approvalHandler: (@Sendable (Int) -> Void)?
    private var diagnosticHandler: (@Sendable (String) -> Void)?

    public init() {}

    public var onStateChange: (@Sendable (CardiaryClient.State) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return stateHandler }
        set { lock.lock(); stateHandler = newValue; lock.unlock() }
    }

    public var onSystemStatus: (@Sendable (SystemStatus) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return statusHandler }
        set { lock.lock(); statusHandler = newValue; lock.unlock() }
    }

    public var onApprovalCount: (@Sendable (Int) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return approvalHandler }
        set { lock.lock(); approvalHandler = newValue; lock.unlock() }
    }

    public var onDiagnostic: (@Sendable (String) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return diagnosticHandler }
        set { lock.lock(); diagnosticHandler = newValue; lock.unlock() }
    }
}
