import Foundation

/// 代理的辨識路由；`BrokerService` 只依賴這個介面，測試可以替換。
public protocol RecognitionHandling: Sendable {
    func ocr(payload: JSONValue) async -> BrokerReply
    func transcribe(payload: JSONValue) async -> BrokerReply
}

/// `broker.recognition.ocr` 與 `broker.recognition.transcribe` 的實作。
///
/// 流程固定是「驗證路徑 → 呼叫引擎（有時限）→ 截斷文字」。任何一步失敗
/// 都回 `available:false` 與原因，不是控制面錯誤；服務端據此退回文字替身。
/// 日誌只記路徑、位元組數、耗時與結果碼，不記內容。
public final class RecognitionService: RecognitionHandling, @unchecked Sendable {
    public struct Limits: Sendable {
        /// OCR 60 秒（`shell-control.md` 第 5.2 節）。
        public var ocrTimeout: TimeInterval
        /// 語音 5 分鐘。
        public var transcribeTimeout: TimeInterval
        /// 原檔大小上限 200 MB。
        public var maxFileBytes: Int
        /// 回應文字上限 1 MiB。
        public var maxTextBytes: Int

        public init(
            ocrTimeout: TimeInterval = 60,
            transcribeTimeout: TimeInterval = 300,
            maxFileBytes: Int = RecognitionPathPolicy.defaultMaxFileBytes,
            maxTextBytes: Int = RecognitionTextLimiter.maxBytes
        ) {
            self.ocrTimeout = ocrTimeout
            self.transcribeTimeout = transcribeTimeout
            self.maxFileBytes = maxFileBytes
            self.maxTextBytes = maxTextBytes
        }

        public static let `default` = Limits()
    }

    private let folderProvider: @Sendable () -> FolderSnapshot
    private let pathPolicy: RecognitionPathPolicy
    private let ocrEngine: any TextRecognizing
    private let speechEngine: any SpeechTranscribing
    private let limits: Limits
    private let onLog: (@Sendable (String) -> Void)?

    public init(
        folderProvider: @escaping @Sendable () -> FolderSnapshot = { .unselected },
        ocr: any TextRecognizing = VisionTextRecognizer(),
        speech: any SpeechTranscribing = SpeechTranscriber(),
        limits: Limits = .default,
        onLog: (@Sendable (String) -> Void)? = nil
    ) {
        self.folderProvider = folderProvider
        self.pathPolicy = RecognitionPathPolicy(maxFileBytes: limits.maxFileBytes)
        self.ocrEngine = ocr
        self.speechEngine = speech
        self.limits = limits
        self.onLog = onLog
    }

    public func ocr(payload: JSONValue) async -> BrokerReply {
        let requested = payload["locales"]?.arrayValue?.compactMap(\.stringValue) ?? []
        return await recognize(
            route: "ocr",
            path: payload["path"]?.stringValue,
            timeout: limits.ocrTimeout
        ) { [ocrEngine] url in
            try await ocrEngine.recognize(url: url, locales: requested)
        }
    }

    public func transcribe(payload: JSONValue) async -> BrokerReply {
        let locale = payload["locale"]?.stringValue
        return await recognize(
            route: "transcribe",
            path: payload["path"]?.stringValue,
            timeout: limits.transcribeTimeout
        ) { [speechEngine] url in
            try await speechEngine.transcribe(url: url, locale: locale)
        }
    }

    private func recognize(
        route: String,
        path: String?,
        timeout: TimeInterval,
        engine: @escaping @Sendable (URL) async throws -> RecognitionText
    ) async -> BrokerReply {
        let startedAt = Date()
        let resolved: (url: URL, sizeBytes: Int)
        do {
            guard let path, let folderPath = folderProvider().path else {
                throw RecognitionPathError.notAllowed
            }
            resolved = try pathPolicy.resolve(path: path, folderPath: folderPath)
        } catch {
            return reply(route: route, path: path, bytes: nil, startedAt: startedAt, outcome: .unavailable(.pathNotAllowed))
        }

        let outcome: RecognitionOutcome
        do {
            let text = try await withTimeout(seconds: timeout) {
                try await engine(resolved.url)
            }
            let limited = RecognitionTextLimiter.limit(text.text, maxBytes: limits.maxTextBytes)
            outcome = .available(
                RecognitionText(
                    text: limited.text,
                    locale: text.locale,
                    truncated: text.truncated || limited.truncated,
                    segments: text.segments
                )
            )
        } catch let error as RecognitionEngineError {
            outcome = .unavailable(error.reason)
        } catch is RecognitionTimeoutError {
            outcome = .unavailable(.timeout)
        } catch {
            outcome = .unavailable(.failed)
        }
        return reply(
            route: route,
            path: path,
            bytes: resolved.sizeBytes,
            startedAt: startedAt,
            outcome: outcome
        )
    }

    private func reply(
        route: String,
        path: String?,
        bytes: Int?,
        startedAt: Date,
        outcome: RecognitionOutcome
    ) -> BrokerReply {
        let code: String
        switch outcome {
        case .available: code = "available"
        case .unavailable(let reason): code = reason.rawValue
        }
        let elapsed = Int(Date().timeIntervalSince(startedAt) * 1000)
        onLog?(
            "本機辨識：route=\(route) path=\(path ?? "-") bytes=\(bytes.map(String.init) ?? "-") ms=\(elapsed) result=\(code)"
        )
        return .ok(outcome.payload)
    }
}

/// 執行 `operation` 並在時限內等結果；逾時丟 `RecognitionTimeoutError`。
private func withTimeout<T: Sendable>(
    seconds: TimeInterval,
    operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
            throw RecognitionTimeoutError()
        }
        guard let first = try await group.next() else {
            throw RecognitionTimeoutError()
        }
        group.cancelAll()
        return first
    }
}
