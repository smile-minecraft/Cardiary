import Foundation

/// 服務送來的通知。
public enum ControlNotification: Equatable, Sendable {
    case fatal(reason: String, detail: String?)
    case maintenance(lifecycle: String, operationId: String?)

    /// 刪除或 VACUUM 進行中時，殼要暫停健康檢查。
    public var suspendsHealthChecks: Bool {
        if case .maintenance(let lifecycle, _) = self {
            return lifecycle != "idle"
        }
        return false
    }
}

/// 殼對代理請求的回應。
public enum BrokerReply: Equatable, Sendable {
    case ok(JSONValue)
    case unavailable(String)
}

/// 殼↔服務的私有控制通道（stdin／stdout 上的 NDJSON）。
///
/// 職責：
/// - 送出 `init`，驗證 stdout 第一行是 `ready`。
/// - 驗證 `hello` 的 `brokerToken` 與 pid，回 `hello-ack`。
/// - 每一個 frame 都驗證 Token；錯／缺一律關閉通道，不回 payload。
/// - 請求與回應的 `replyTo` 對應；對不上就關閉。
/// - 轉發代理請求與通知。
public final class ControlChannel: @unchecked Sendable {
    public struct Limits: Sendable {
        public var maxFrameBytes: Int
        public var readyTimeout: TimeInterval
        public var helloTimeout: TimeInterval
        public var defaultRequestTimeout: TimeInterval

        public init(
            maxFrameBytes: Int = ControlProtocol.maxFrameBytes,
            readyTimeout: TimeInterval = 10,
            helloTimeout: TimeInterval = 5,
            defaultRequestTimeout: TimeInterval = 10
        ) {
            self.maxFrameBytes = maxFrameBytes
            self.readyTimeout = readyTimeout
            self.helloTimeout = helloTimeout
            self.defaultRequestTimeout = defaultRequestTimeout
        }

        public static let `default` = Limits()
    }

    public enum ChannelState: String, Equatable, Sendable {
        case awaitingReady
        case awaitingHello
        case established
        case closed
    }

    public enum ChannelError: Error, Equatable, Sendable, CustomStringConvertible {
        case closed
        case busy
        case timeout
        case protocolViolation(String)
        case unsupportedProtocol(Int)
        case unsupportedRoute(String)
        case responseError(ControlErrorPayload)
        case writeFailed(Int32)

        public var description: String {
            switch self {
            case .closed: return "控制通道已關閉"
            case .busy: return "同一個路由已有在途請求"
            case .timeout: return "控制請求逾時"
            case .protocolViolation(let detail): return "控制面協定錯誤：\(detail)"
            case .unsupportedProtocol(let version): return "控制面版本 \(version) 與殼不符"
            case .unsupportedRoute(let route): return "不支援的控制路由 \(route)"
            case .responseError(let error): return "服務回報錯誤：\(error.code.rawValue)"
            case .writeFailed(let code): return "寫入控制通道失敗（errno \(code)）"
            }
        }
    }

    private struct PendingRequest {
        let route: String
        let continuation: CheckedContinuation<JSONValue, Error>
    }

    private let transport: any ServiceProcessHandle
    private let controlToken: ControlToken
    private let brokerToken: ControlToken
    private let limits: Limits
    private let queue = DispatchQueue(label: "com.cardiary.shell.control-channel")

    private var state: ChannelState = .awaitingReady
    private var buffer = Data()
    private var readyInfo: ReadyMessage?
    private var readyContinuation: CheckedContinuation<ReadyMessage, Error>?
    private var establishedContinuation: CheckedContinuation<Void, Error>?
    private var pending: [String: PendingRequest] = [:]
    private var inFlightRoutes: Set<String> = []
    private var identifierCounter = 0
    private var closeReason: ChannelError?
    private var helloDeadlineScheduled = false

    public var brokerHandler: (@Sendable (String, JSONValue) -> BrokerReply)?
    public var onNotification: (@Sendable (ControlNotification) -> Void)?
    public var onLog: (@Sendable (String) -> Void)?
    public var onClosed: (@Sendable (ChannelError) -> Void)?

    public init(
        transport: any ServiceProcessHandle,
        controlToken: ControlToken,
        brokerToken: ControlToken,
        limits: Limits = .default
    ) {
        self.transport = transport
        self.controlToken = controlToken
        self.brokerToken = brokerToken
        self.limits = limits

        transport.setDataHandler { [weak self] data in
            self?.queue.async { self?.ingest(data) }
        }
    }

    public var currentState: ChannelState {
        queue.sync { state }
    }

    public var ready: ReadyMessage? {
        queue.sync { readyInfo }
    }

    /// 送出 `init`，等 `ready` 與 `hello`／`hello-ack` 完成。
    public func handshake(folderPath: String) async throws -> ReadyMessage {
        let line = try ControlFrameEncoder.initMessage(
            InitMessage(
                token: controlToken.value,
                brokerToken: brokerToken.value,
                folderPath: folderPath
            )
        )
        try queue.sync {
            guard state == .awaitingReady else {
                throw ChannelError.protocolViolation("重複送出 init")
            }
            do {
                try transport.write(line)
            } catch ServiceLaunchError.stdinClosed {
                throw ChannelError.closed
            } catch ServiceLaunchError.writeFailed(let code) {
                throw ChannelError.writeFailed(code)
            }
        }

        let ready = try await awaitReady()
        try await awaitEstablished()
        log("控制通道完成交握：pid \(ready.pid)、clientPort \(ready.clientPort)")
        return ready
    }

    /// 送出一則控制請求。同一個路由一次只能有一個在途請求，第二個回 `busy`。
    public func request(
        route: String,
        payload: JSONValue = .object([:]),
        timeout: TimeInterval? = nil
    ) async throws -> JSONValue {
        let deadline = timeout ?? limits.defaultRequestTimeout
        return try await withCheckedThrowingContinuation { continuation in
            queue.async {
                guard self.state == .established else {
                    continuation.resume(throwing: self.closeReason ?? ChannelError.closed)
                    return
                }
                guard ControlRoute.controlRoutes.contains(route) else {
                    continuation.resume(throwing: ChannelError.unsupportedRoute(route))
                    return
                }
                guard !self.inFlightRoutes.contains(route) else {
                    continuation.resume(throwing: ChannelError.busy)
                    return
                }

                let id = self.nextIdentifier(prefix: "ctl")
                self.pending[id] = PendingRequest(route: route, continuation: continuation)
                self.inFlightRoutes.insert(route)

                do {
                    let data = try ControlFrameEncoder.request(
                        id: id,
                        route: route,
                        token: self.controlToken,
                        payload: payload
                    )
                    try self.transport.write(data)
                } catch {
                    self.pending.removeValue(forKey: id)
                    self.inFlightRoutes.remove(route)
                    let code = (error as? ServiceLaunchError)?.errnoCode ?? 0
                    continuation.resume(throwing: ChannelError.writeFailed(code))
                    return
                }

                self.queue.asyncAfter(deadline: .now() + deadline) { [weak self] in
                    self?.expire(id)
                }
            }
        }
    }

    public func invalidate(reason: ChannelError = .closed) {
        queue.async { self.close(reason) }
    }

    // MARK: - 接收

    private func ingest(_ data: Data) {
        guard state != .closed else { return }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer.subdata(in: buffer.startIndex..<newline)
            buffer.removeSubrange(buffer.startIndex...newline)
            if !line.isEmpty {
                handleLine(line)
            }
            if state == .closed { return }
        }
        // 一行都還沒結束就超過上限：視為通道失效。
        if buffer.count > limits.maxFrameBytes {
            close(.protocolViolation("單行超過 \(limits.maxFrameBytes) bytes"))
        }
    }

    private func handleLine(_ line: Data) {
        switch state {
        case .awaitingReady:
            handleReady(line)
        case .awaitingHello:
            handleEnvelope(line, expect: .hello)
        case .established:
            handleEstablished(line)
        case .closed:
            break
        }
    }

    private func handleReady(_ line: Data) {
        do {
            let ready = try ControlFrameDecoder.ready(line, maxFrameBytes: limits.maxFrameBytes)
            guard ready.pid == transport.pid else {
                close(.protocolViolation("ready.pid \(ready.pid) 與子行程 \(transport.pid) 不符"))
                return
            }
            readyInfo = ready
            state = .awaitingHello
            let continuation = readyContinuation
            readyContinuation = nil
            continuation?.resume(returning: ready)
            scheduleHelloDeadline()
        } catch let error as EnvelopeError {
            if case .unsupportedVersion(let version) = error.reason {
                // 版本不符不是暫時性錯誤：殼要停止重啟並顯示。
                close(.unsupportedProtocol(version))
                return
            }
            close(.protocolViolation("ready 不合法：\(error.description)"))
        } catch {
            close(.protocolViolation("ready 不合法"))
        }
    }

    private func handleEnvelope(_ line: Data, expect kind: InboundKind) {
        let envelope: InboundEnvelope
        do {
            envelope = try ControlFrameDecoder.envelope(line, maxFrameBytes: limits.maxFrameBytes)
        } catch let error as EnvelopeError {
            close(.protocolViolation("frame 不合法：\(error.description)"))
            return
        } catch {
            close(.protocolViolation("frame 不合法"))
            return
        }

        guard envelope.kind == kind else {
            close(.protocolViolation("預期 \(kind.rawValue)，收到 \(envelope.kind.rawValue)"))
            return
        }

        // 先驗 Token，再看其他欄位。
        guard brokerToken.matches(envelope.token) else {
            close(.protocolViolation("hello 的 brokerToken 不符"))
            return
        }
        guard envelope.role == "host-service" else {
            close(.protocolViolation("hello.role 不是 host-service"))
            return
        }
        guard envelope.pid == transport.pid else {
            close(.protocolViolation("hello.pid 與子行程不符"))
            return
        }

        do {
            let ack = try ControlFrameEncoder.helloAck(token: controlToken)
            try transport.write(ack)
        } catch {
            close(.protocolViolation("無法回應 hello-ack"))
            return
        }

        state = .established
        let continuation = establishedContinuation
        establishedContinuation = nil
        continuation?.resume(returning: ())
    }

    private func handleEstablished(_ line: Data) {
        let envelope: InboundEnvelope
        do {
            envelope = try ControlFrameDecoder.envelope(line, maxFrameBytes: limits.maxFrameBytes)
        } catch let error as EnvelopeError {
            close(.protocolViolation("frame 不合法：\(error.description)"))
            return
        } catch {
            close(.protocolViolation("frame 不合法"))
            return
        }

        // 每一個 frame 都帶 Token，而且服務→殼的方向只認 brokerToken。
        guard brokerToken.matches(envelope.token) else {
            close(.protocolViolation("frame 的 Token 不符"))
            return
        }

        switch envelope.kind {
        case .hello:
            close(.protocolViolation("重複的 hello"))
        case .helloAck:
            close(.protocolViolation("殼不該收到 hello-ack"))
        case .request:
            handleBrokerRequest(envelope)
        case .response:
            handleResponse(envelope)
        case .notification:
            handleNotification(envelope)
        }
    }

    private func handleBrokerRequest(_ envelope: InboundEnvelope) {
        guard let id = envelope.id, !id.isEmpty else {
            close(.protocolViolation("request 缺少 id"))
            return
        }
        guard let route = envelope.route else {
            close(.protocolViolation("request 缺少 route"))
            return
        }
        guard ControlRoute.brokerRoutes.contains(route) else {
            respondError(id: id, error: ControlErrorPayload(code: .unsupportedRoute, message: "不支援的路由。"))
            return
        }

        let payload = envelope.payload ?? .object([:])
        let reply = brokerHandler?(route, payload) ?? .unavailable("殼沒有處理這個路由。")
        switch reply {
        case .ok(let payload):
            respond(id: id, payload: payload)
        case .unavailable(let message):
            respondError(id: id, error: ControlErrorPayload(code: .unavailable, message: message))
        }
    }

    private func handleResponse(_ envelope: InboundEnvelope) {
        guard let replyTo = envelope.replyTo else {
            close(.protocolViolation("response 缺少 replyTo"))
            return
        }
        guard let entry = pending.removeValue(forKey: replyTo) else {
            close(.protocolViolation("response 的 replyTo 對不上在途請求"))
            return
        }
        inFlightRoutes.remove(entry.route)

        if envelope.ok == true {
            entry.continuation.resume(returning: envelope.payload ?? .object([:]))
            return
        }
        let error = envelope.error
            ?? ControlErrorPayload(code: .internalError, message: "服務回報失敗但沒有錯誤內容。")
        if error.code == .busy || error.code == .unavailable {
            // 這兩種不是通道錯誤：保留通道，讓呼叫端決定重試。
            entry.continuation.resume(throwing: ChannelError.responseError(error))
            return
        }
        entry.continuation.resume(throwing: ChannelError.responseError(error))
    }

    private func handleNotification(_ envelope: InboundEnvelope) {
        guard let route = envelope.route else {
            close(.protocolViolation("notification 缺少 route"))
            return
        }
        guard ControlRoute.notificationRoutes.contains(route) else {
            close(.protocolViolation("不支援的通知路由 \(route)"))
            return
        }
        let payload = envelope.payload

        switch route {
        case ControlRoute.notifyFatal:
            let reason = payload?["reason"]?.stringValue ?? "internal"
            let detail = payload?["detail"]?.stringValue
            onNotification?(.fatal(reason: reason, detail: detail))
        case ControlRoute.notifyMaintenance:
            let lifecycle = payload?["lifecycle"]?.stringValue ?? "idle"
            let operationId = payload?["operationId"]?.stringValue
            onNotification?(.maintenance(lifecycle: lifecycle, operationId: operationId))
        default:
            break
        }
    }

    private func respond(id: String, payload: JSONValue) {
        do {
            let data = try ControlFrameEncoder.response(
                id: nextIdentifier(prefix: "res"),
                replyTo: id,
                token: controlToken,
                payload: payload
            )
            try transport.write(data)
        } catch {
            close(.writeFailed((error as? ServiceLaunchError)?.errnoCode ?? 0))
        }
    }

    private func respondError(id: String, error: ControlErrorPayload) {
        do {
            let data = try ControlFrameEncoder.errorResponse(
                id: nextIdentifier(prefix: "res"),
                replyTo: id,
                token: controlToken,
                error: error
            )
            try transport.write(data)
        } catch {
            close(.writeFailed((error as? ServiceLaunchError)?.errnoCode ?? 0))
        }
    }

    // MARK: - 等待與關閉

    private func awaitReady() async throws -> ReadyMessage {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                if let ready = self.readyInfo {
                    continuation.resume(returning: ready)
                    return
                }
                if let error = self.closeReason {
                    continuation.resume(throwing: error)
                    return
                }
                self.readyContinuation = continuation
                self.queue.asyncAfter(deadline: .now() + self.limits.readyTimeout) { [weak self] in
                    guard let self else { return }
                    guard let pending = self.readyContinuation else { return }
                    self.readyContinuation = nil
                    pending.resume(throwing: ChannelError.timeout)
                    self.close(.timeout)
                }
            }
        }
    }

    private func awaitEstablished() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                if self.state == .established {
                    continuation.resume(returning: ())
                    return
                }
                if let error = self.closeReason {
                    continuation.resume(throwing: error)
                    return
                }
                self.establishedContinuation = continuation
            }
        }
    }

    private func scheduleHelloDeadline() {
        guard !helloDeadlineScheduled else { return }
        helloDeadlineScheduled = true
        queue.asyncAfter(deadline: .now() + limits.helloTimeout) { [weak self] in
            guard let self, self.state == .awaitingHello else { return }
            self.close(.timeout)
        }
    }

    private func expire(_ id: String) {
        guard let entry = pending.removeValue(forKey: id) else { return }
        inFlightRoutes.remove(entry.route)
        entry.continuation.resume(throwing: ChannelError.timeout)
    }

    private func close(_ reason: ChannelError) {
        guard state != .closed else { return }
        state = .closed
        closeReason = reason

        let readyPending = readyContinuation
        readyContinuation = nil
        readyPending?.resume(throwing: reason)

        let establishedPending = establishedContinuation
        establishedContinuation = nil
        establishedPending?.resume(throwing: reason)

        let all = pending
        pending.removeAll()
        inFlightRoutes.removeAll()
        for (_, entry) in all {
            entry.continuation.resume(throwing: reason)
        }

        log("控制通道關閉：\(reason.description)")
        onClosed?(reason)
    }

    private func nextIdentifier(prefix: String) -> String {
        identifierCounter += 1
        let random = UInt32.random(in: 0...UInt32.max)
        return "\(prefix)_\(String(identifierCounter, radix: 36))\(String(random, radix: 36))"
    }

    private func log(_ message: String) {
        onLog?(message)
    }
}

private extension ServiceLaunchError {
    var errnoCode: Int32 {
        if case .writeFailed(let code) = self { return code }
        return 0
    }
}
