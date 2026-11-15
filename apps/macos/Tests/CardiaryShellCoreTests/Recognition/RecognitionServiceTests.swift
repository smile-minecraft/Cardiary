import Foundation
import XCTest

@testable import CardiaryShellCore

/// 辨識路徑驗證：只接受授權資料夾內、不是符號連結的一般檔案。
final class RecognitionPathPolicyTests: XCTestCase {
    private var folder: URL!

    override func setUpWithError() throws {
        folder = try TestSupport.makeTemporaryFolder("recognition")
    }

    private func write(_ name: String, bytes: Int = 4) throws -> URL {
        let url = folder.appendingPathComponent(name)
        try Data(repeating: 0x41, count: bytes).write(to: url)
        return url
    }

    func testAcceptsRegularFileInsideFolder() throws {
        let file = try write("note.txt", bytes: 7)
        let policy = RecognitionPathPolicy()
        let resolved = try policy.resolve(path: file.path, folderPath: folder.path)
        XCTAssertEqual(resolved.sizeBytes, 7)
        XCTAssertEqual(resolved.url.lastPathComponent, "note.txt")
    }

    func testRejectsFileOutsideFolder() throws {
        let outside = try TestSupport.makeTemporaryFolder("outside")
        let file = outside.appendingPathComponent("secret.txt")
        try Data("x".utf8).write(to: file)
        XCTAssertThrowsError(
            try RecognitionPathPolicy().resolve(path: file.path, folderPath: folder.path)
        ) { error in
            XCTAssertEqual(error as? RecognitionPathError, .notAllowed)
        }
    }

    func testRejectsSiblingFolderWithCommonPrefix() throws {
        let sibling = URL(fileURLWithPath: folder.path + "-extra")
        try FileManager.default.createDirectory(at: sibling, withIntermediateDirectories: true)
        let file = sibling.appendingPathComponent("x.png")
        try Data("x".utf8).write(to: file)
        XCTAssertThrowsError(
            try RecognitionPathPolicy().resolve(path: file.path, folderPath: folder.path)
        ) { error in
            XCTAssertEqual(error as? RecognitionPathError, .notAllowed)
        }
    }

    func testRejectsRelativePathAndMissingFile() {
        let policy = RecognitionPathPolicy()
        XCTAssertThrowsError(try policy.resolve(path: "note.txt", folderPath: folder.path))
        XCTAssertThrowsError(
            try policy.resolve(
                path: folder.appendingPathComponent("missing.png").path,
                folderPath: folder.path
            )
        ) { error in
            XCTAssertEqual(error as? RecognitionPathError, .notAllowed)
        }
    }

    func testRejectsSymbolicLink() throws {
        let target = try write("target.png")
        let link = folder.appendingPathComponent("link.png")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        XCTAssertThrowsError(
            try RecognitionPathPolicy().resolve(path: link.path, folderPath: folder.path)
        ) { error in
            XCTAssertEqual(error as? RecognitionPathError, .notAllowed)
        }
    }

    func testRejectsDirectory() throws {
        let directory = folder.appendingPathComponent("nested", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        XCTAssertThrowsError(
            try RecognitionPathPolicy().resolve(path: directory.path, folderPath: folder.path)
        ) { error in
            XCTAssertEqual(error as? RecognitionPathError, .notAllowed)
        }
    }

    func testRejectsFilesOverTheLimit() throws {
        let file = try write("big.bin", bytes: 32)
        XCTAssertThrowsError(
            try RecognitionPathPolicy(maxFileBytes: 16).resolve(
                path: file.path,
                folderPath: folder.path
            )
        ) { error in
            XCTAssertEqual(error as? RecognitionPathError, .tooLarge)
        }
    }

    func testRejectsWhenFolderIsUnset() throws {
        let file = try write("note.txt")
        XCTAssertThrowsError(try RecognitionPathPolicy().resolve(path: file.path, folderPath: ""))
    }
}

/// 回應文字上限：1 MiB，截斷要落在完整的字元邊界。
final class RecognitionTextLimiterTests: XCTestCase {
    func testKeepsShortTextUnchanged() {
        let result = RecognitionTextLimiter.limit("hello", maxBytes: 5)
        XCTAssertEqual(result.text, "hello")
        XCTAssertFalse(result.truncated)
    }

    func testTruncatesOnScalarBoundary() {
        let source = "ab🎉cd"
        // 「🎉」在 UTF-8 佔 4 bytes；上限 4 會切在它中間，必須退到「ab」。
        let result = RecognitionTextLimiter.limit(source, maxBytes: 4)
        XCTAssertEqual(result.text, "ab")
        XCTAssertTrue(result.truncated)
        XCTAssertEqual(Array(result.text.utf8).count, 2)
    }

    func testDefaultLimitIsOneMebibyte() {
        XCTAssertEqual(RecognitionTextLimiter.maxBytes, 1024 * 1024)
        let source = String(repeating: "a", count: RecognitionTextLimiter.maxBytes + 10)
        let result = RecognitionTextLimiter.limit(source)
        XCTAssertTrue(result.truncated)
        XCTAssertEqual(Array(result.text.utf8).count, RecognitionTextLimiter.maxBytes)
    }
}

private final class FakeTextRecognizer: TextRecognizing, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [(URL, [String])] = []
    private let handler: @Sendable (URL, [String]) async throws -> RecognitionText

    init(handler: @escaping @Sendable (URL, [String]) async throws -> RecognitionText) {
        self.handler = handler
    }

    var calls: [(URL, [String])] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func recognize(url: URL, locales: [String]) async throws -> RecognitionText {
        lock.lock()
        recorded.append((url, locales))
        lock.unlock()
        return try await handler(url, locales)
    }
}

private final class FakeSpeechTranscriber: SpeechTranscribing, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [(URL, String?)] = []
    private let handler: @Sendable (URL, String?) async throws -> RecognitionText

    init(handler: @escaping @Sendable (URL, String?) async throws -> RecognitionText) {
        self.handler = handler
    }

    var calls: [(URL, String?)] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func transcribe(url: URL, locale: String?) async throws -> RecognitionText {
        lock.lock()
        recorded.append((url, locale))
        lock.unlock()
        return try await handler(url, locale)
    }
}

final class RecognitionServiceTests: XCTestCase {
    private var folder: URL!

    override func setUpWithError() throws {
        folder = try TestSupport.makeTemporaryFolder("recognition-service")
    }

    private func makeFile(_ name: String = "note.png", bytes: Int = 8) throws -> URL {
        let url = folder.appendingPathComponent(name)
        try Data(repeating: 0x42, count: bytes).write(to: url)
        return url
    }

    private func makeService(
        ocr: any TextRecognizing = FakeTextRecognizer { _, _ in RecognitionText(text: "沒有") },
        speech: any SpeechTranscribing = FakeSpeechTranscriber { _, _ in
            RecognitionText(text: "沒有")
        },
        limits: RecognitionService.Limits = .default,
        onLog: (@Sendable (String) -> Void)? = nil
    ) -> RecognitionService {
        RecognitionService(
            folderProvider: {
                FolderSnapshot(state: .ready, path: self.folder.path, writable: true)
            },
            ocr: ocr,
            speech: speech,
            limits: limits,
            onLog: onLog
        )
    }

    func testOCRReturnsTextAndLocale() async throws {
        let file = try makeFile()
        let engine = FakeTextRecognizer { url, locales in
            XCTAssertEqual(url.lastPathComponent, "note.png")
            XCTAssertEqual(locales, ["zh-Hant", "en-US"])
            return RecognitionText(text: "預算 120 萬", locale: "zh-Hant")
        }
        let service = makeService(ocr: engine)
        let reply = await service.ocr(
            payload: .object([
                "path": .string(file.path),
                "locales": .array([.string("zh-Hant"), .string("en-US")]),
            ])
        )
        guard case .ok(let payload) = reply else {
            return XCTFail("辨識應該成功")
        }
        XCTAssertEqual(payload["available"]?.boolValue, true)
        XCTAssertEqual(payload["text"]?.stringValue, "預算 120 萬")
        XCTAssertEqual(payload["locale"]?.stringValue, "zh-Hant")
        XCTAssertNil(payload["truncated"])
        XCTAssertEqual(engine.calls.count, 1)
    }

    func testTranscribeReturnsSegments() async throws {
        let file = try makeFile("voice.m4a")
        let engine = FakeSpeechTranscriber { _, locale in
            XCTAssertEqual(locale, "zh-TW")
            return RecognitionText(
                text: "下週去看房子",
                locale: "zh-TW",
                segments: [
                    RecognitionSegment(text: "下週", startMs: 0, durationMs: 400),
                    RecognitionSegment(text: "去看房子", startMs: 400, durationMs: 900),
                ]
            )
        }
        let service = makeService(speech: engine)
        let reply = await service.transcribe(
            payload: .object(["path": .string(file.path), "locale": .string("zh-TW")])
        )
        guard case .ok(let payload) = reply else {
            return XCTFail("語音轉文字應該成功")
        }
        XCTAssertEqual(payload["text"]?.stringValue, "下週去看房子")
        let segments = payload["segments"]?.arrayValue
        XCTAssertEqual(segments?.count, 2)
        XCTAssertEqual(segments?[1]["text"]?.stringValue, "去看房子")
        XCTAssertEqual(segments?[1]["startMs"]?.intValue, 400)
    }

    func testNotAuthorizedIsAnAvailableFalseResponse() async throws {
        let file = try makeFile()
        let engine = FakeTextRecognizer { _, _ in
            throw RecognitionEngineError(reason: .notAuthorized, message: "denied")
        }
        let service = makeService(ocr: engine)
        let reply = await service.ocr(payload: .object(["path": .string(file.path)]))
        guard case .ok(let payload) = reply else {
            return XCTFail("未授權是正常退化，不是控制面錯誤")
        }
        XCTAssertEqual(payload["available"]?.boolValue, false)
        XCTAssertEqual(payload["reason"]?.stringValue, "not_authorized")
    }

    func testPathOutsideFolderDoesNotReachTheEngine() async throws {
        let outside = try TestSupport.makeTemporaryFolder("outside")
        let file = outside.appendingPathComponent("secret.png")
        try Data("x".utf8).write(to: file)
        let engine = FakeTextRecognizer { _, _ in
            XCTFail("路徑不合法時不能讀檔")
            return RecognitionText(text: "不該出現")
        }
        let service = makeService(ocr: engine)
        let reply = await service.ocr(payload: .object(["path": .string(file.path)]))
        guard case .ok(let payload) = reply else {
            return XCTFail("路徑不合法要回正常回應")
        }
        XCTAssertEqual(payload["available"]?.boolValue, false)
        XCTAssertEqual(payload["reason"]?.stringValue, "path_not_allowed")
        XCTAssertEqual(engine.calls.count, 0)
    }

    func testMissingPathIsRejectedWithoutReading() async {
        let service = makeService()
        let reply = await service.ocr(payload: .object([:]))
        guard case .ok(let payload) = reply else {
            return XCTFail("缺少 path 要回正常回應")
        }
        XCTAssertEqual(payload["reason"]?.stringValue, "path_not_allowed")
    }

    func testTimeoutReturnsUnavailable() async throws {
        let file = try makeFile()
        let engine = FakeTextRecognizer { _, _ in
            try await Task.sleep(nanoseconds: 2_000_000_000)
            return RecognitionText(text: "太慢了")
        }
        let service = makeService(ocr: engine, limits: .init(ocrTimeout: 0.05))
        let started = Date()
        let reply = await service.ocr(payload: .object(["path": .string(file.path)]))
        guard case .ok(let payload) = reply else {
            return XCTFail("逾時要回正常回應")
        }
        XCTAssertEqual(payload["available"]?.boolValue, false)
        XCTAssertEqual(payload["reason"]?.stringValue, "timeout")
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.5, "逾時不應該等滿引擎的睡眠")
    }

    func testTruncatesLongResponses() async throws {
        let file = try makeFile()
        let engine = FakeTextRecognizer { _, _ in
            RecognitionText(text: "abcdefghij")
        }
        let service = makeService(ocr: engine, limits: .init(maxTextBytes: 4))
        let reply = await service.ocr(payload: .object(["path": .string(file.path)]))
        guard case .ok(let payload) = reply else {
            return XCTFail("截斷仍要成功")
        }
        XCTAssertEqual(payload["text"]?.stringValue, "abcd")
        XCTAssertEqual(payload["truncated"]?.boolValue, true)
    }

    func testLogsOnlyPathSizeAndResult() async throws {
        let file = try makeFile("note.png", bytes: 8)
        let box = LogBox()
        let engine = FakeTextRecognizer { _, _ in RecognitionText(text: "機密內容") }
        let service = makeService(ocr: engine, onLog: { box.append($0) })
        _ = await service.ocr(payload: .object(["path": .string(file.path)]))
        let line = try XCTUnwrap(box.lines.first)
        XCTAssertTrue(line.contains(file.path))
        XCTAssertTrue(line.contains("bytes=8"))
        XCTAssertTrue(line.contains("result=available"))
        XCTAssertFalse(line.contains("機密內容"), "辨識內容不能進日誌")
    }
}

private final class LogBox: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []

    var lines: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func append(_ line: String) {
        lock.lock()
        recorded.append(line)
        lock.unlock()
    }
}
