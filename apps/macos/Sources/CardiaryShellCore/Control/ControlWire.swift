import Foundation

/// 私有控制面的常數與路由白名單。
///
/// 契約在 `docs/design/shell-control.md`。白名單是精確字串比對：沒有前綴比對、
/// 沒有萬用字元、沒有列舉型路由。
public enum ControlProtocol {
    public static let version = 1
    public static let maxFrameBytes = 65_536
    public static let healthIntervalMilliseconds = 1_000
}

public enum ControlRoute {
    // 殼 → 服務
    public static let health = "control.health"
    public static let pause = "control.pause"
    public static let resume = "control.resume"
    public static let shutdown = "control.shutdown"

    // 服務 → 殼（系統能力代理）
    public static let brokerFolderGet = "broker.folder.get"
    public static let brokerKeychainGet = "broker.keychain.get"
    public static let brokerShellStateGet = "broker.shell-state.get"
    public static let brokerRecognitionOcr = "broker.recognition.ocr"
    public static let brokerRecognitionTranscribe = "broker.recognition.transcribe"

    // 殼 → 服務（遠端配對與裝置管理）
    public static let pairingApprove = "control.pairing.approve"
    public static let pairingDeny = "control.pairing.deny"
    public static let devicesList = "control.devices.list"
    public static let devicesRevoke = "control.devices.revoke"

    // 服務 → 殼（通知）
    public static let notifyFatal = "notify.fatal"
    public static let notifyMaintenance = "notify.maintenance"
    public static let notifyPairingRequested = "notify.pairing_requested"

    /// 殼送給服務的控制路由。
    public static let controlRoutes: Set<String> = [
        health, pause, resume, shutdown,
        pairingApprove, pairingDeny, devicesList, devicesRevoke,
    ]

    /// 殼願意回應的代理路由。沒有列舉、沒有搜尋。
    public static let brokerRoutes: Set<String> = [
        brokerFolderGet, brokerKeychainGet, brokerShellStateGet,
        brokerRecognitionOcr, brokerRecognitionTranscribe,
    ]

    /// 殼願意接受的通知。
    public static let notificationRoutes: Set<String> = [
        notifyFatal, notifyMaintenance, notifyPairingRequested
    ]
}

/// 控制面的錯誤碼。這組不進客戶端協定的 `ErrorCode`。
public enum ControlErrorCode: String, Codable, Sendable {
    case unauthorized
    case unsupportedRoute = "unsupported_route"
    case invalidMessage = "invalid_message"
    case busy
    case unavailable
    case timeout
    case internalError = "internal"
}

public struct ControlErrorPayload: Codable, Equatable, Sendable {
    public let code: ControlErrorCode
    public let message: String
    public let retryable: Bool

    public init(code: ControlErrorCode, message: String, retryable: Bool = false) {
        self.code = code
        self.message = message
        self.retryable = retryable
    }
}

// MARK: - 啟動交握

/// `init`：殼寫入服務 stdin 的第一行。Token 只出現在這裡。
public struct InitMessage: Encodable, Sendable {
    public struct Folder: Encodable, Sendable {
        public let path: String
    }

    public struct Limits: Encodable, Sendable {
        public let maxFrameBytes: Int
        public let healthIntervalMs: Int
    }

    public let type = "init"
    public let `protocol`: Int
    public let token: String
    public let brokerToken: String
    public let folder: Folder
    public let limits: Limits
    /// 殼簽發的客戶端 Token；服務用它驗證客戶端連線。
    ///
    /// 與控制 Token、代理 Token 分開：客戶端協定看得到這一組，控制面看不到。
    /// 省略時服務自己產生，並在 `ready` 回給殼。
    public let clientToken: String?

    public init(token: String, brokerToken: String, folderPath: String, clientToken: String? = nil) {
        self.protocol = ControlProtocol.version
        self.token = token
        self.brokerToken = brokerToken
        self.folder = Folder(path: folderPath)
        self.limits = Limits(
            maxFrameBytes: ControlProtocol.maxFrameBytes,
            healthIntervalMs: ControlProtocol.healthIntervalMilliseconds
        )
        self.clientToken = clientToken
    }
}

/// `ready`：服務寫入 stdout 的第一行。
public struct ReadyMessage: Decodable, Equatable, Sendable {
    public let `protocol`: Int
    public let pid: Int32
    public let clientPort: UInt16
    public let folderId: String
    public let epoch: String
    /// 服務實際使用的客戶端 Token。
    ///
    /// 有帶 `init.clientToken` 時是同一把；沒有帶時是服務自己產生的。
    /// 舊版服務沒有這個欄位，解碼後是 `nil`。
    public let clientToken: String?

    private enum CodingKeys: String, CodingKey {
        case `protocol`, pid, clientPort, folderId, epoch, clientToken
    }
}

// MARK: - 信封

public enum InboundKind: String, Sendable {
    case hello
    case helloAck = "hello-ack"
    case request
    case response
    case notification
}

public struct InboundEnvelope: Equatable, Sendable {
    public let v: Int
    public let kind: InboundKind
    public let id: String?
    public let replyTo: String?
    public let route: String?
    public let role: String?
    public let pid: Int32?
    public let token: String?
    public let ok: Bool?
    public let payload: JSONValue?
    public let error: ControlErrorPayload?
}

public struct EnvelopeError: Error, Equatable, Sendable, CustomStringConvertible {
    public enum Reason: Equatable, Sendable {
        case frameTooLarge(limit: Int, actual: Int)
        case notUTF8
        case notJSONObject
        case unsupportedVersion(Int)
        case unknownKind(String)
        case missingField(String)
        case invalidField(String)
    }

    public let reason: Reason

    public init(_ reason: Reason) {
        self.reason = reason
    }

    public var description: String {
        switch reason {
        case .frameTooLarge(let limit, let actual):
            return "frame 超過上限（\(actual) > \(limit) bytes）"
        case .notUTF8:
            return "frame 不是 UTF-8"
        case .notJSONObject:
            return "frame 不是 JSON 物件"
        case .unsupportedVersion(let v):
            return "不支援的控制面版本 \(v)"
        case .unknownKind(let kind):
            return "不認得的 frame 種類 \(kind)"
        case .missingField(let field):
            return "缺少欄位 \(field)"
        case .invalidField(let field):
            return "欄位 \(field) 不合法"
        }
    }
}

/// 解析控制面的 NDJSON frame。
public enum ControlFrameDecoder {
    public static func envelope(_ data: Data, maxFrameBytes: Int) throws -> InboundEnvelope {
        guard data.count <= maxFrameBytes else {
            throw EnvelopeError(.frameTooLarge(limit: maxFrameBytes, actual: data.count))
        }
        guard let text = String(data: data, encoding: .utf8) else {
            throw EnvelopeError(.notUTF8)
        }
        guard let objectData = text.data(using: .utf8),
            let raw = try? JSONSerialization.jsonObject(with: objectData),
            let object = raw as? [String: Any]
        else {
            throw EnvelopeError(.notJSONObject)
        }

        guard let v = object["v"] as? Int else { throw EnvelopeError(.missingField("v")) }
        guard v == ControlProtocol.version else {
            throw EnvelopeError(.unsupportedVersion(v))
        }
        guard let rawKind = object["kind"] as? String else {
            throw EnvelopeError(.missingField("kind"))
        }
        guard let kind = InboundKind(rawValue: rawKind) else {
            throw EnvelopeError(.unknownKind(rawKind))
        }

        let auth = object["auth"] as? [String: Any]
        let token = auth?["token"] as? String

        var payload: JSONValue?
        if let payloadObject = object["payload"] {
            let data = try JSONSerialization.data(withJSONObject: payloadObject)
            payload = try JSONDecoder().decode(JSONValue.self, from: data)
        }

        var error: ControlErrorPayload?
        if let errorObject = object["error"] {
            let data = try JSONSerialization.data(withJSONObject: errorObject)
            error = try? JSONDecoder().decode(ControlErrorPayload.self, from: data)
        }

        return InboundEnvelope(
            v: v,
            kind: kind,
            id: object["id"] as? String,
            replyTo: object["replyTo"] as? String,
            route: object["route"] as? String,
            role: object["role"] as? String,
            pid: (object["pid"] as? NSNumber)?.int32Value,
            token: token,
            ok: object["ok"] as? Bool,
            payload: payload,
            error: error
        )
    }

    /// `ready` 是第一行，格式與之後的信封不同：沒有 `v` 與 `kind`。
    public static func ready(_ data: Data, maxFrameBytes: Int) throws -> ReadyMessage {
        guard data.count <= maxFrameBytes else {
            throw EnvelopeError(.frameTooLarge(limit: maxFrameBytes, actual: data.count))
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String,
            type == "ready"
        else {
            throw EnvelopeError(.notJSONObject)
        }
        guard let message = try? JSONDecoder().decode(ReadyMessage.self, from: data) else {
            throw EnvelopeError(.invalidField("ready"))
        }
        guard message.protocol == ControlProtocol.version else {
            throw EnvelopeError(.unsupportedVersion(message.protocol))
        }
        guard message.pid > 0 else { throw EnvelopeError(.invalidField("pid")) }
        // `clientPort: 0` 代表這個服務沒有客戶端協定（開發用的替身就是這樣）。
        // 只要不是 0，就必須是合法的埠號。
        guard !message.folderId.isEmpty else { throw EnvelopeError(.invalidField("folderId")) }
        guard !message.epoch.isEmpty else { throw EnvelopeError(.invalidField("epoch")) }
        return message
    }
}

/// 產生殼要送出的 frame。一行一個 JSON 物件，`\n` 結尾。
public enum ControlFrameEncoder {
    private static func line(_ object: [String: Any]) throws -> Data {
        var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        data.append(0x0A)
        return data
    }

    public static func initMessage(_ message: InitMessage) throws -> Data {
        var data = try JSONEncoder().encode(message)
        data.append(0x0A)
        return data
    }

    public static func helloAck(token: ControlToken) throws -> Data {
        try line([
            "v": ControlProtocol.version,
            "kind": "hello-ack",
            "role": "shell",
            "auth": ["token": token.value],
        ])
    }

    public static func request(
        id: String,
        route: String,
        token: ControlToken,
        payload: JSONValue = .object([:])
    ) throws -> Data {
        try line([
            "v": ControlProtocol.version,
            "kind": "request",
            "id": id,
            "route": route,
            "auth": ["token": token.value],
            "payload": try payloadObject(payload),
        ])
    }

    public static func response(
        id: String,
        replyTo: String,
        token: ControlToken,
        payload: JSONValue
    ) throws -> Data {
        try line([
            "v": ControlProtocol.version,
            "kind": "response",
            "id": id,
            "replyTo": replyTo,
            "auth": ["token": token.value],
            "ok": true,
            "payload": try payloadObject(payload),
        ])
    }

    public static func errorResponse(
        id: String,
        replyTo: String?,
        token: ControlToken,
        error: ControlErrorPayload
    ) throws -> Data {
        var object: [String: Any] = [
            "v": ControlProtocol.version,
            "kind": "response",
            "id": id,
            "auth": ["token": token.value],
            "ok": false,
            "error": try object(from: error),
        ]
        if let replyTo { object["replyTo"] = replyTo }
        return try line(object)
    }

    private static func payloadObject(_ payload: JSONValue) throws -> Any {
        let data = try JSONEncoder().encode(payload)
        return try JSONSerialization.jsonObject(with: data)
    }

    private static func object<T: Encodable>(from value: T) throws -> Any {
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data)
    }
}
