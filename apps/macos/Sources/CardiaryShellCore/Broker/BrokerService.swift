import Foundation

/// 殼提供給服務的系統能力代理。
///
/// 五個路由、都只回單一項目：沒有列舉、沒有搜尋、沒有 keychain.list。
/// 三個同步路由（資料夾、鑰匙圈、殼狀態）加兩個辨識路由（OCR、語音轉
/// 文字）；回應不含金鑰長度、指紋或建立時間，也不含檔案內容。
public final class BrokerService: @unchecked Sendable {
    public struct KeychainAccount: Equatable, Sendable {
        public let value: String

        public init?(_ raw: String) {
            guard raw == raw.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
            guard !raw.isEmpty, raw.count <= 200 else { return nil }
            let segments = raw.split(separator: "/", omittingEmptySubsequences: false)
            guard segments.count >= 2, segments.count <= 4 else { return nil }
            let allowed = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
            for (index, segment) in segments.enumerated() {
                guard !segment.isEmpty, segment.count <= 64 else { return nil }
                guard segment.allSatisfy({ allowed.contains($0) }) else { return nil }
                if index == 0 {
                    guard segment.allSatisfy({ $0.isLowercase && $0.isLetter || $0 == "-" }) else {
                        return nil
                    }
                }
            }
            value = raw
        }
    }

    private let keychain: any KeychainReading
    private let stateDirectory: ShellStateDirectory
    private let folderProvider: @Sendable () -> FolderSnapshot
    private let recognition: any RecognitionHandling

    public init(
        keychain: any KeychainReading,
        stateDirectory: ShellStateDirectory,
        folderProvider: @escaping @Sendable () -> FolderSnapshot,
        recognition: any RecognitionHandling = RecognitionService()
    ) {
        self.keychain = keychain
        self.stateDirectory = stateDirectory
        self.folderProvider = folderProvider
        self.recognition = recognition
    }

    /// 同步路由：資料夾、鑰匙圈與殼狀態。
    ///
    /// 辨識路由要等 Vision／Speech，走非同步的 `handle(route:payload:) async`；
    /// 從同步呼叫端碰不到那兩條路由。
    public func handle(route: String, payload: JSONValue) -> BrokerReply {
        handleSynchronously(route: route, payload: payload)
    }

    /// 全部路由；控制通道用這一個，辨識會等到有結果或逾時才回應。
    public func handle(route: String, payload: JSONValue) async -> BrokerReply {
        switch route {
        case ControlRoute.brokerRecognitionOcr:
            return await recognition.ocr(payload: payload)
        case ControlRoute.brokerRecognitionTranscribe:
            return await recognition.transcribe(payload: payload)
        default:
            return handleSynchronously(route: route, payload: payload)
        }
    }

    private func handleSynchronously(route: String, payload: JSONValue) -> BrokerReply {
        switch route {
        case ControlRoute.brokerFolderGet:
            return .ok(folderPayload())
        case ControlRoute.brokerKeychainGet:
            return keychainPayload(payload)
        case ControlRoute.brokerShellStateGet:
            return .ok(stateDirectory.payload())
        default:
            return .unavailable("不支援的路由。")
        }
    }

    private func folderPayload() -> JSONValue {
        let folder = folderProvider()
        var object: [String: JSONValue] = [
            "path": .string(folder.path ?? ""),
            "displayName": .string(folder.displayName ?? ""),
            "available": .bool(folder.isUsable),
            "writable": .bool(folder.writable),
        ]
        if let uuid = folder.volumeUUID {
            object["volumeUUID"] = .string(uuid)
        }
        if folder.state != .ready {
            object["reason"] = .string(folder.state.rawValue)
        }
        return .object(object)
    }

    private func keychainPayload(_ payload: JSONValue) -> BrokerReply {
        guard let raw = payload["account"]?.stringValue else {
            return .unavailable("缺少 account。")
        }
        guard let account = KeychainAccount(raw) else {
            return .unavailable("account 格式不合法。")
        }
        guard let value = keychain.read(account: account.value) else {
            // 「查不到」與「讀不出來」對服務是同一個結果。
            return .ok(.object(["found": .bool(false)]))
        }
        return .ok(.object(["found": .bool(true), "value": .string(value)]))
    }
}

/// 殼的鑰匙圈讀取介面。正式實作在 App 端（Security framework），測試用替身。
public protocol KeychainReading: Sendable {
    /// 查詢單一帳號；查不到或讀不出來都回 nil。
    func read(account: String) -> String?
}
