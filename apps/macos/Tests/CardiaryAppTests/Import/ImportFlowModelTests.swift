import CardiaryKit
import Foundation
import XCTest

@testable import CardiaryApp

/// 匯入流程的狀態機：預設勾選、範圍限制、寫入請求和進度。
@MainActor
final class ImportFlowModelTests: XCTestCase {
    func testLoadSourcesSelectsAvailableAlma() async {
        let service = FakeImportService()
        service.sourcesResult = [
            ImportSourceAvailability(
                kind: .generic,
                name: "通用資料夾",
                available: true,
                path: "",
                detail: "任意資料夾",
                unverified: nil
            ),
            ImportSourceAvailability(
                kind: .alma,
                name: "Alma",
                available: true,
                path: "/Users/test/Library/Application Support/alma/chat_threads.db",
                detail: "唯讀",
                unverified: "threads.json"
            ),
        ]
        let model = ImportFlowModel(service: service)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.sources.count, 2)
        XCTAssertEqual(model.sourceKind, .alma)
        XCTAssertEqual(model.sourcePath, service.sourcesResult[1].path)
    }

    func testGenericSourcePreviewsWithCategoriesAndDefaultSelection() async {
        let service = FakeImportService()
        service.filesResult = ImportFileListing(
            files: [
                ImportFileEntry(
                    relativePath: "persona.md",
                    name: "persona.md",
                    sizeBytes: 40,
                    modifiedAt: nil,
                    supported: true
                ),
                ImportFileEntry(
                    relativePath: "memory.md",
                    name: "memory.md",
                    sizeBytes: 80,
                    modifiedAt: nil,
                    supported: true
                ),
            ],
            truncated: false
        )
        service.previewResult = SamplePreviews.preview
        let model = ImportFlowModel(service: service)
        await model.load()
        await model.chooseSource(kind: .generic, path: "/tmp/source")
        XCTAssertEqual(model.files.count, 2)

        model.setCategory(.persona, for: "persona.md")
        model.setCategory(.memory, for: "memory.md")
        await model.preview()

        XCTAssertEqual(model.phase, .previewed)
        XCTAssertEqual(model.preview?.jobId, "job-1")
        // 記憶與操作規則預設勾選；人格要過目、對話預設不匯入、重複的不勾。
        XCTAssertTrue(model.selectedKeys.contains("file:memory.md"))
        XCTAssertTrue(model.selectedKeys.contains("file:rule.md"))
        XCTAssertFalse(model.selectedKeys.contains("file:persona.md"))
        XCTAssertFalse(model.selectedKeys.contains("conversation:1"))
        XCTAssertFalse(model.selectedKeys.contains("file:duplicate.md"))
        // 使用者資料預設列入核心記憶候選。
        XCTAssertTrue(model.coreMemoryKeys.contains("file:user.md"))
        XCTAssertEqual(model.selectedCardCount, 3)
        XCTAssertEqual(model.selectedSkillCount, 1)
    }

    func testProjectMemoryIsNotSelectedByDefault() async {
        let service = FakeImportService()
        service.previewResult = SamplePreviews.projectPreview
        let model = ImportFlowModel(service: service)
        await model.chooseSource(kind: .codex, path: "/tmp/.codex")
        await model.preview()
        XCTAssertFalse(model.selectedKeys.contains("codex:project:memories/rollout_summaries/one.md"))
        XCTAssertTrue(model.selectedKeys.contains("codex:personal:AGENTS.md"))
        XCTAssertTrue(model.selectedKeys.contains("codex:personal:memories/MEMORY.md"))
    }

    func testClaudeExportNeedsAFileAndSelectsConversations() async {
        let service = FakeImportService()
        service.previewResult = SamplePreviews.projectPreview
        let model = ImportFlowModel(service: service)
        await model.chooseSource(kind: .claude, path: "")
        XCTAssertTrue(model.includeConversations)
        XCTAssertFalse(model.canPreview)
        await model.chooseSource(kind: .claude, path: "/tmp/export.zip")
        XCTAssertFalse(model.canPreview)
        model.setRange(
            start: Date(timeIntervalSince1970: 1_760_000_000),
            end: Date(timeIntervalSince1970: 1_762_000_000)
        )
        XCTAssertTrue(model.canPreview)
    }

    func testPreviewIsNotSentWithoutRangeForConversations() async {
        // 訊息跟著注入的語言走；測試兩種語言都跑，不依賴系統語言。
        for language in AppLanguage.allCases {
            let service = FakeImportService()
            service.previewResult = SamplePreviews.preview
            let model = ImportFlowModel(service: service, language: language)
            await model.chooseSource(kind: .alma, path: "/tmp/alma.db")
            model.includeConversations = true
            XCTAssertFalse(model.canPreview)
            XCTAssertTrue(model.requiresRange)
            await model.preview()
            XCTAssertEqual(service.previewRequests.count, 0)
            XCTAssertEqual(
                model.errorMessage,
                ImportL10n.text(.importRangeRequired, language: language)
            )
        }
    }

    func testWriteSendsSelectedKeysAndCoreMemoryCandidates() async {
        let service = FakeImportService()
        service.previewResult = SamplePreviews.preview
        service.writeResult = SamplePreviews.writeResult
        let model = ImportFlowModel(service: service)
        await model.chooseSource(kind: .generic, path: "/tmp/source")
        await model.preview()

        model.setSelected("file:persona.md", true)
        model.setCoreMemory("file:memory.md", true)
        await model.write()

        XCTAssertEqual(model.phase, .completed)
        XCTAssertEqual(model.result?.cardsCreated, 4)
        let request = try? XCTUnwrap(service.writeRequests.first)
        XCTAssertEqual(
            request?.itemKeys.sorted(),
            ["file:memory.md", "file:persona.md", "file:rule.md", "file:user.md", "skill:1"].sorted()
        )
        XCTAssertEqual(request?.coreMemoryItemKeys?.contains("file:memory.md"), true)
        XCTAssertEqual(request?.coreMemoryItemKeys?.contains("file:user.md"), true)
    }

    func testReimportToggleCountsDuplicatesAndSendsFlag() async {
        let service = FakeImportService()
        service.previewResult = SamplePreviews.preview
        service.writeResult = SamplePreviews.writeResult
        let model = ImportFlowModel(service: service)
        await model.chooseSource(kind: .generic, path: "/tmp/source")
        await model.preview()

        // 重複項目預設不勾；就算手動放進勾選，關閉「重新匯入」時也不計入。
        model.setSelected("file:duplicate.md", true)
        XCTAssertEqual(model.selectedCardCount, 3)

        // 打開「重新匯入」之後，同一筆勾選會被計入，寫入時送出 reimport。
        model.allowReimport = true
        XCTAssertEqual(model.selectedCardCount, 4)
        await model.write()

        let request = try? XCTUnwrap(service.writeRequests.first)
        XCTAssertEqual(request?.reimport, true)
        XCTAssertTrue(request?.itemKeys.contains("file:duplicate.md") == true)
    }

    func testWriteRefusesConversationWithoutRange() async {
        for language in AppLanguage.allCases {
            let service = FakeImportService()
            service.previewResult = SamplePreviews.preview
            let model = ImportFlowModel(service: service, language: language)
            await model.chooseSource(kind: .alma, path: "/tmp/alma.db")
            model.includeConversations = true
            model.setRange(start: Date(timeIntervalSince1970: 1_760_000_000), end: Date(timeIntervalSince1970: 1_762_000_000))
            await model.preview()
            model.setSelected("conversation:1", true)
            model.clearRange()
            await model.write()

            XCTAssertEqual(service.writeRequests.count, 0)
            XCTAssertEqual(
                model.errorMessage,
                ImportL10n.text(.importRangeRequired, language: language)
            )
        }
    }

    func testProgressOnlyAppliesToCurrentJob() async {
        let service = FakeImportService()
        service.previewResult = SamplePreviews.preview
        let model = ImportFlowModel(service: service)
        await model.chooseSource(kind: .alma, path: "/tmp/alma.db")
        await model.preview()

        model.apply(progress: ImportProgress(
            jobId: "other-job",
            done: 9,
            total: 10,
            status: "written",
            category: .memory,
            reason: nil
        ))
        XCTAssertNil(model.progress)

        model.apply(progress: ImportProgress(
            jobId: "job-1",
            done: 1,
            total: 4,
            status: "written",
            category: .memory,
            reason: nil
        ))
        XCTAssertEqual(model.progress?.done, 1)
        XCTAssertEqual(model.progress?.total, 4)
    }

    func testWriteWithoutSelectionReportsNothingSelected() async {
        for language in AppLanguage.allCases {
            let service = FakeImportService()
            service.previewResult = SamplePreviews.preview
            let model = ImportFlowModel(service: service, language: language)
            await model.chooseSource(kind: .alma, path: "/tmp/alma.db")
            await model.preview()
            model.deselectAll()
            await model.write()
            XCTAssertEqual(service.writeRequests.count, 0)
            XCTAssertEqual(
                model.errorMessage,
                ImportL10n.text(.importNothingSelected, language: language)
            )
        }
    }

    func testWriteCompletionNotifiesOnlyAfterSuccess() async {
        let service = FakeImportService()
        service.previewResult = SamplePreviews.preview
        service.writeResult = SamplePreviews.writeResult
        let model = ImportFlowModel(service: service)
        var completions = 0
        model.onWriteCompleted = { completions += 1 }

        await model.chooseSource(kind: .alma, path: "/tmp/alma.db")
        await model.preview()
        await model.write()
        XCTAssertEqual(model.phase, .completed)
        XCTAssertEqual(completions, 1, "寫入成功後要通知卡片庫重讀")

        let failing = FakeImportService()
        failing.previewResult = SamplePreviews.preview
        let failingModel = ImportFlowModel(service: failing)
        var failedCompletions = 0
        failingModel.onWriteCompleted = { failedCompletions += 1 }
        await failingModel.chooseSource(kind: .alma, path: "/tmp/alma.db")
        await failingModel.preview()
        failing.error = NSError(domain: "test", code: 1)
        await failingModel.write()
        XCTAssertEqual(failedCompletions, 0, "寫入失敗不能通知卡片庫重讀")
    }

    func testModuleImportServiceUnwrapsDataAndSendsPayload() async throws {
        let sender = RecordingModuleSender()
        sender.response = .object([
            "data": SamplePreviews.previewJson,
        ])
        let service = ModuleImportService(sender: sender)
        let preview = try await service.preview(ImportPreviewRequest(
            sourceKind: .generic,
            sourcePath: "/tmp/source",
            categories: ["memory.md": .memory],
            defaultCategory: nil,
            includeConversations: nil,
            rangeStart: nil,
            rangeEnd: nil,
            providedPersona: nil
        ))
        XCTAssertEqual(preview.jobId, "job-1")
        XCTAssertEqual(preview.items.count, 5)
        XCTAssertEqual(sender.requests.first?.type, "module.import.preview")
        guard case .object(let payload) = sender.requests.first?.payload else {
            return XCTFail("payload 必須是物件")
        }
        XCTAssertEqual(payload["sourceKind"], .string("generic"))
        XCTAssertEqual(payload["sourcePath"], .string("/tmp/source"))
        XCTAssertEqual(payload["categories"], .object(["memory.md": .string("memory")]))
    }

    func testTimestampAcceptsFractionalSeconds() throws {
        let plain = try XCTUnwrap(ImportTimestamp.date(from: "2026-11-10T09:00:00Z"))
        let fractional = try XCTUnwrap(ImportTimestamp.date(from: "2026-11-10T09:00:00.123Z"))
        XCTAssertEqual(fractional.timeIntervalSince(plain), 0.123, accuracy: 0.001)
    }
}

// MARK: - 替身

/// 記錄每一次請求的服務；測試用它驗證介面送了什麼。
final class FakeImportService: ImportService, @unchecked Sendable {
    private let lock = NSLock()
    private var _previewRequests: [ImportPreviewRequest] = []
    private var _writeRequests: [ImportWriteRequest] = []

    var sourcesResult: [ImportSourceAvailability] = []
    var filesResult = ImportFileListing(files: [], truncated: false)
    var previewResult = SamplePreviews.preview
    var writeResult = SamplePreviews.writeResult
    var error: Error?

    var previewRequests: [ImportPreviewRequest] {
        lock.lock(); defer { lock.unlock() }
        return _previewRequests
    }

    var writeRequests: [ImportWriteRequest] {
        lock.lock(); defer { lock.unlock() }
        return _writeRequests
    }

    func sources() async throws -> [ImportSourceAvailability] {
        if let error { throw error }
        return sourcesResult
    }

    func listFiles(path: String) async throws -> ImportFileListing {
        if let error { throw error }
        return filesResult
    }

    func preview(_ request: ImportPreviewRequest) async throws -> ImportPreview {
        lock.lock(); _previewRequests.append(request); lock.unlock()
        if let error { throw error }
        return previewResult
    }

    func write(_ request: ImportWriteRequest) async throws -> ImportWriteResult {
        lock.lock(); _writeRequests.append(request); lock.unlock()
        if let error { throw error }
        return writeResult
    }
}

/// 只記錄請求、回固定 JSON 的模組傳輸。
final class RecordingModuleSender: ModuleRequestSending, @unchecked Sendable {
    struct Request {
        let type: String
        let payload: JSONValue
    }

    private let lock = NSLock()
    private var _requests: [Request] = []
    var response: JSONValue = .object(["data": .object([:])])

    var requests: [Request] {
        lock.lock(); defer { lock.unlock() }
        return _requests
    }

    func sendModuleRequest(_ type: String, payload: JSONValue) async throws -> JSONValue {
        lock.lock(); _requests.append(Request(type: type, payload: payload)); lock.unlock()
        return response
    }
}

/// 固定的預覽內容；每一類各一項，另加一個重複項目。
enum SamplePreviews {
    static let preview = ImportPreview(
        jobId: "job-1",
        source: ImportPreview.Source(kind: .generic, path: "/tmp/source", tool: "generic", version: nil),
        items: [
            item(key: "file:persona.md", category: .persona, title: "我的語氣"),
            item(key: "file:user.md", category: .user, title: "使用者資料"),
            item(key: "file:memory.md", category: .memory, title: "我住在台北"),
            item(key: "file:rule.md", category: .rule, title: "先確認日期"),
            item(key: "file:duplicate.md", category: .memory, title: "已匯入", duplicateCardId: "card-1"),
        ],
        skills: [
            ImportPreviewSkill(
                key: "skill:1",
                name: "alpha",
                description: "測試技能",
                slug: "alpha",
                contentHash: "hash",
                source: ImportItemSource(tool: "generic", path: "/tmp/source/SKILL.md"),
                attachmentsNotCopied: 0,
                existingSkillPath: nil
            ),
        ],
        conversations: [
            ImportConversation(
                key: "conversation:1",
                title: "搬家的討論",
                createdAt: "2026-11-10T09:00:00.000Z",
                updatedAt: nil,
                messageCount: 4,
                characterCount: 120,
                existingSummary: "- 三月搬家",
                contentHash: "hash",
                source: ImportItemSource(tool: "alma", path: "/tmp/alma.db#threads/1"),
                unverified: nil
            ),
        ],
        skipped: [],
        notes: [],
        warnings: [],
        conversationEstimate: nil,
        newCards: 4,
        duplicates: 1
    )

    static let writeResult = ImportWriteResult(
        jobId: "job-1",
        status: "completed",
        cardsCreated: 4,
        skillsCopied: 1,
        duplicates: 0,
        failed: 0,
        skipped: [],
        results: [],
        coreMemoryCandidates: ["card-2"],
        conversationEstimate: nil,
        warnings: []
    )

    static let previewJson: JSONValue = {
        let data = try! JSONEncoder().encode(preview)
        return try! JSONDecoder().decode(JSONValue.self, from: data)
    }()

    static let projectPreview = ImportPreview(
        jobId: "job-project",
        source: ImportPreview.Source(kind: .codex, path: "/tmp/.codex", tool: "codex", version: nil),
        items: [
            item(key: "codex:personal:AGENTS.md", category: .rule, title: "規則"),
            item(key: "codex:personal:memories/MEMORY.md", category: .memory, title: "個人記憶"),
            item(
                key: "codex:project:memories/rollout_summaries/one.md",
                category: .memory,
                title: "專案記憶",
                origin: "project"
            ),
        ],
        skills: [],
        conversations: [],
        skipped: [],
        notes: [],
        warnings: [],
        conversationEstimate: nil,
        newCards: 3,
        duplicates: 0
    )

    static func item(
        key: String,
        category: ImportCategory,
        title: String,
        duplicateCardId: String? = nil,
        origin: String? = nil
    ) -> ImportPreviewItem {
        ImportPreviewItem(
            key: key,
            category: category,
            title: title,
            body: "內容",
            summary: nil,
            tags: [],
            createdAt: nil,
            contentHash: "hash-\(key)",
            source: ImportItemSource(tool: "generic", path: "/tmp/source"),
            importance: nil,
            duplicateCardId: duplicateCardId,
            origin: origin
        )
    }
}
