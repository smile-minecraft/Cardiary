import Foundation

/// 原檔的 HTTP 客戶端：`POST /v1/blobs` 上傳、`GET /v1/blobs/<id>` 下載。
///
/// 認證與 WebSocket 相同，`Authorization: Bearer <clientToken>`；Token 只放在標頭，
/// 不進 URL 或日誌。端點與 Token 由殼提供（見 `ShellController`），App 不自己拼。
/// 上傳用 `URLSession` 的上傳任務，檔案不整份讀進記憶體。
public struct BlobClient: Sendable {
    public struct Configuration: Sendable, Equatable {
        /// 服務的 HTTP 根網址，例如 `http://127.0.0.1:51234`。
        public var baseURL: URL
        public var clientToken: String
        /// 單次請求的期限；匯入大檔時主機仍需時間處理，預設給到兩分鐘。
        public var timeout: Duration

        public init(
            baseURL: URL,
            clientToken: String,
            timeout: Duration = .seconds(120)
        ) {
            self.baseURL = baseURL
            self.clientToken = clientToken
            self.timeout = timeout
        }
    }

    /// `GET /v1/blobs/<id>?variant=thumb` 的縮圖變體。
    public enum Variant: String, Sendable, CaseIterable {
        case thumb
    }

    public let configuration: Configuration
    private let session: URLSession

    public init(configuration: Configuration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    /// 把檔案的位元組串流上傳，回主機算出的 blob 資訊。同一個內容重送回同一個 `blobId`。
    public func upload(fileURL: URL, mediaType: String) async throws -> BlobInfo {
        let request = try uploadRequest(mediaType: mediaType)
        let (data, response) = try await session.upload(for: request, fromFile: fileURL)
        return try decode(BlobInfo.self, data: data, response: response)
    }

    /// 上傳記憶體中的內容；適合剪貼簿或拖放拿到 `Data` 的情況。
    public func upload(data: Data, mediaType: String) async throws -> BlobInfo {
        let request = try uploadRequest(mediaType: mediaType)
        let (body, response) = try await session.upload(for: request, from: data)
        return try decode(BlobInfo.self, data: body, response: response)
    }

    /// 下載原檔；帶 `variant` 時取得主機產生的縮圖。
    public func download(blobId: String, variant: Variant? = nil) async throws -> Data {
        var components = try blobComponents(blobId: blobId)
        if let variant {
            components.queryItems = [URLQueryItem(name: "variant", value: variant.rawValue)]
        }
        guard let url = components.url else {
            throw CardiaryClientError.invalidEndpoint(configuration.baseURL.absoluteString)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = Self.seconds(configuration.timeout)
        authorize(&request)

        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return data
    }

    // MARK: - 請求組裝

    private func uploadRequest(mediaType: String) throws -> URLRequest {
        guard let url = try blobsURL() else {
            throw CardiaryClientError.invalidEndpoint(configuration.baseURL.absoluteString)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = Self.seconds(configuration.timeout)
        request.setValue(mediaType, forHTTPHeaderField: "Content-Type")
        authorize(&request)
        return request
    }

    private func authorize(_ request: inout URLRequest) {
        request.setValue("Bearer \(configuration.clientToken)", forHTTPHeaderField: "Authorization")
    }

    private func blobsURL() throws -> URL? {
        try endpoint(path: "v1/blobs")
    }

    private func blobComponents(blobId: String) throws -> URLComponents {
        guard Self.isBlobId(blobId) else {
            throw CardiaryClientError.invalidFrame("blobId 必須是 64 個小寫十六進位字元。")
        }
        guard let url = endpoint(path: "v1/blobs/\(blobId)"),
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            throw CardiaryClientError.invalidEndpoint(configuration.baseURL.absoluteString)
        }
        components.query = nil
        return components
    }

    /// 只接受 http(s)：`ws` 端點不能當原檔端點用。
    private func endpoint(path: String) -> URL? {
        guard let scheme = configuration.baseURL.scheme?.lowercased(),
            scheme == "http" || scheme == "https"
        else { return nil }
        return configuration.baseURL.appending(path: path)
    }

    private static func isBlobId(_ value: String) -> Bool {
        guard value.count == 64 else { return false }
        let hex = Set("0123456789abcdef")
        return value.allSatisfy { hex.contains($0) }
    }

    private static func seconds(_ duration: Duration) -> TimeInterval {
        let components = duration.components
        return TimeInterval(components.seconds) + TimeInterval(components.attoseconds) / 1e18
    }

    // MARK: - 回應

    private func decode<T: Decodable>(
        _ type: T.Type,
        data: Data,
        response: URLResponse
    ) throws -> T {
        try validate(response, data: data)
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw CardiaryClientError.invalidFrame("回應無法解碼：\(error)")
        }
    }

    /// 非 2xx 時優先解讀主機的錯誤信封；沒有信封就當成不合法的回應。
    private func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw CardiaryClientError.invalidFrame("原檔端點沒有回 HTTP 回應。")
        }
        guard (200..<300).contains(http.statusCode) else {
            if let frame = try? JSONDecoder().decode(ErrorFrame.self, from: data) {
                throw CardiaryClientError.server(frame)
            }
            throw CardiaryClientError.invalidFrame(
                "原檔端點回 \(http.statusCode)，內容不是錯誤信封。"
            )
        }
    }
}
