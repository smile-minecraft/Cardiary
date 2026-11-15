import CardiaryKit
import Foundation

/// 匯入介面需要的請求。view model 只依賴這個介面，測試用假的實作。
///
/// 真正的傳輸由主機客戶端提供；掛載點與 `CardiaryClient` 的方法由前置工作
/// 補齊，這裡只定介面，不直接建立連線、也不碰 Token。
public protocol ImportService: Sendable {
    func sources() async throws -> [ImportSourceAvailability]
    func listFiles(path: String) async throws -> ImportFileListing
    func preview(_ request: ImportPreviewRequest) async throws -> ImportPreview
    func write(_ request: ImportWriteRequest) async throws -> ImportWriteResult
}

/// 送 `module.*` 請求的最小介面。
///
/// `CardiaryClient` 目前沒有通用的模組請求；前置工作完成後由客戶端實作這個
/// 協定，匯入介面就能接上真的主機。
public protocol ModuleRequestSending: Sendable {
    /// 回傳該型別的 response payload（`{ "data": … }` 的整個 payload）。
    func sendModuleRequest(_ type: String, payload: JSONValue) async throws -> JSONValue
}

/// 匯入請求失敗的原因。
public enum ImportClientError: Error, Equatable, LocalizedError {
    case malformedResponse(String)
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .malformedResponse(let type):
            return "主機回應的不是模組格式：\(type)"
        case .server(let message):
            return message
        }
    }
}

/// 把 `ImportService` 接到 `ModuleRequestSending` 上。
public struct ModuleImportService: ImportService {
    private let sender: any ModuleRequestSending

    public init(sender: any ModuleRequestSending) {
        self.sender = sender
    }

    public func sources() async throws -> [ImportSourceAvailability] {
        struct Response: Decodable { let sources: [ImportSourceAvailability] }
        return try await call("module.import.sources", payload: .object([:]), as: Response.self)
            .sources
    }

    public func listFiles(path: String) async throws -> ImportFileListing {
        struct Request: Encodable { let path: String }
        return try await call(
            "module.import.list",
            payload: try encode(Request(path: path)),
            as: ImportFileListing.self
        )
    }

    public func preview(_ request: ImportPreviewRequest) async throws -> ImportPreview {
        try await call("module.import.preview", payload: try encode(request), as: ImportPreview.self)
    }

    public func write(_ request: ImportWriteRequest) async throws -> ImportWriteResult {
        try await call("module.import.write", payload: try encode(request), as: ImportWriteResult.self)
    }

    private func call<T: Decodable>(
        _ type: String,
        payload: JSONValue,
        as: T.Type
    ) async throws -> T {
        let response = try await sender.sendModuleRequest(type, payload: payload)
        guard case .object(let object) = response, let data = object["data"] else {
            throw ImportClientError.malformedResponse(type)
        }
        return try decode(T.self, from: data)
    }

    private func encode<T: Encodable>(_ value: T) throws -> JSONValue {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    private func decode<T: Decodable>(_ type: T.Type, from value: JSONValue) throws -> T {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

/// 匯入介面直接使用客戶端的模組請求；不另外做一層傳輸。
///
/// `CardiaryClient.sendModuleRequest` 的簽名就是 `ModuleRequestSending` 要的
/// 形狀（回傳 `{ data: … }` 整個 payload），所以兩邊靠同一個方法接起來。
extension CardiaryClient: ModuleRequestSending {}
