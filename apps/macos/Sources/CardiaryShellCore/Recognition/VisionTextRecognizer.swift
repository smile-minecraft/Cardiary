import Foundation
import Vision

/// 文字辨識引擎；正式實作是 Vision，測試用替身。
public protocol TextRecognizing: Sendable {
    /// 讀取一個本機檔案並回傳辨識文字；尚未截斷，截斷由呼叫端統一處理。
    func recognize(url: URL, locales: [String]) async throws -> RecognitionText
}

/// macOS 內建的 Vision 文字辨識。
///
/// 不寫任何檔案、不需要網路；第一次使用時系統會跳隱私提示，使用者拒絕或
/// 系統不支援時丟 `RecognitionEngineError`，由呼叫端轉成 `available:false`。
public struct VisionTextRecognizer: TextRecognizing {
    public init() {}

    public func recognize(url: URL, locales: [String]) async throws -> RecognitionText {
        try Task.checkCancellation()
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let usable = usableLocales(locales, request: request)
        if !usable.isEmpty {
            request.recognitionLanguages = usable
        }
        do {
            try VNImageRequestHandler(url: url).perform([request])
        } catch {
            throw mapError(error)
        }
        try Task.checkCancellation()
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        let joined = lines.joined(separator: "\n")
        return RecognitionText(
            text: joined,
            locale: usable.first,
            truncated: false
        )
    }

    /// 要求的語言必須是這個版本支援的；不支援的就略過，不要讓整次辨識失敗。
    private func usableLocales(_ requested: [String], request: VNRecognizeTextRequest) -> [String] {
        let candidates = requested.isEmpty
            ? Array(Locale.preferredLanguages.prefix(3))
            : requested
        let supported = (try? request.supportedRecognitionLanguages()) ?? []
        guard !supported.isEmpty else { return candidates }
        return candidates.filter { supported.contains($0) }
    }

    private func mapError(_ error: Error) -> RecognitionEngineError {
        let nsError = error as NSError
        if nsError.domain == NSCocoaErrorDomain,
            nsError.code == NSFileReadNoPermissionError
        {
            return RecognitionEngineError(reason: .notAuthorized, message: "系統未授權讀取這個檔案。")
        }
        return RecognitionEngineError(
            reason: .failed,
            message: "Vision 文字辨識失敗：\(nsError.domain) \(nsError.code)"
        )
    }
}
