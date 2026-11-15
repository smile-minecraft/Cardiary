import Foundation
import Speech

/// 語音轉文字引擎；正式實作是 Speech，測試用替身。
public protocol SpeechTranscribing: Sendable {
    /// 讀取一個本機音訊檔並回傳逐字稿；尚未截斷，截斷由呼叫端統一處理。
    func transcribe(url: URL, locale: String?) async throws -> RecognitionText
}

/// macOS 內建的 Speech 語音辨識。
///
/// 第一次使用會跳隱私提示；拒絕或不支援時丟 `RecognitionEngineError`，由
/// 呼叫端轉成 `available:false`。音訊內容不進日誌。
public struct SpeechTranscriber: SpeechTranscribing {
    public init() {}

    public func transcribe(url: URL, locale: String?) async throws -> RecognitionText {
        try Task.checkCancellation()
        let requested =
            locale.flatMap { $0.isEmpty ? nil : Locale(identifier: $0) } ?? Locale.current
        let status = await Self.authorizationStatus()
        guard status == .authorized else {
            throw RecognitionEngineError(reason: .notAuthorized, message: "系統未授權語音辨識。")
        }
        guard let recognizer = SFSpeechRecognizer(locale: requested), recognizer.isAvailable else {
            throw RecognitionEngineError(
                reason: .unsupported,
                message: "這個語言沒有可用的語音辨識。"
            )
        }
        // 不強制 on-device：沒有離線模型時系統仍可辨識，強制只會讓本來可用的
        // 語言失敗。音訊是否離開本機由使用者的系統設定決定。
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        let result = try await recognize(recognizer: recognizer, request: request)
        let transcription = result.bestTranscription
        let segments = transcription.segments.map { segment in
            RecognitionSegment(
                text: segment.substring,
                startMs: Int((segment.timestamp * 1000).rounded()),
                durationMs: Int((segment.duration * 1000).rounded())
            )
        }
        return RecognitionText(
            text: transcription.formattedString,
            locale: requested.identifier,
            truncated: false,
            segments: segments.isEmpty ? nil : segments
        )
    }

    private static func authorizationStatus() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    private func recognize(
        recognizer: SFSpeechRecognizer,
        request: SFSpeechURLRecognitionRequest
    ) async throws -> SFSpeechRecognitionResult {
        let box = SpeechTaskBox()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                box.install(continuation)
                let task = recognizer.recognitionTask(with: request) { result, error in
                    if let error {
                        box.finish(.failure(Self.mapError(error)))
                        return
                    }
                    guard let result, result.isFinal else { return }
                    box.finish(.success(result))
                }
                box.setTask(task)
            }
        } onCancel: {
            box.cancel()
        }
    }

    private static func mapError(_ error: Error) -> RecognitionEngineError {
        if error is CancellationError {
            return RecognitionEngineError(reason: .timeout, message: "語音辨識已取消。")
        }
        let nsError = error as NSError
        return RecognitionEngineError(
            reason: .failed,
            message: "Speech 語音辨識失敗：\(nsError.domain) \(nsError.code)"
        )
    }
}

/// 讓非同步等待與 Speech 的回呼只完成一次；取消時一併取消辨識工作。
private final class SpeechTaskBox: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<SFSpeechRecognitionResult, Error>?
    private var task: SFSpeechRecognitionTask?
    private var finished = false
    private var cancelled = false

    func install(_ continuation: CheckedContinuation<SFSpeechRecognitionResult, Error>) {
        lock.lock()
        self.continuation = continuation
        lock.unlock()
    }

    func setTask(_ task: SFSpeechRecognitionTask) {
        lock.lock()
        self.task = task
        let shouldCancel = cancelled
        lock.unlock()
        if shouldCancel {
            task.cancel()
        }
    }

    func finish(_ result: Result<SFSpeechRecognitionResult, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let task = self.task
        lock.unlock()
        task?.cancel()
        finish(.failure(CancellationError()))
    }
}
