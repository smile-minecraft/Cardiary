import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 儲存空間分頁：用量、選取、預覽與清除。
///
/// 這裡斷言介面字串，固定用繁體中文，不跟著 CI runner 的系統語言。
@MainActor
final class StorageSettingsModelTests: XCTestCase {
    private func makeModel() -> StorageSettingsModel {
        StorageSettingsModel(language: .zhHant)
    }

    private func usageRows() -> [StorageCategoryUsage] {
        [
            StorageCategoryUsage(category: .cards, bytes: 10_000, cleanableBytes: 0),
            StorageCategoryUsage(category: .assets, bytes: 20_000, cleanableBytes: 0),
            StorageCategoryUsage(category: .state, bytes: 3_000, cleanableBytes: 0),
            StorageCategoryUsage(category: .cache, bytes: 4_000, cleanableBytes: 4_000),
            StorageCategoryUsage(category: .tmp, bytes: 1_500, cleanableBytes: 1_500),
            StorageCategoryUsage(category: .logs, bytes: 500, cleanableBytes: 500),
            StorageCategoryUsage(category: .shellState, bytes: 50_000, cleanableBytes: 0),
        ]
    }

    func testLoadShowsAllSevenCategories() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(storageUsage: usageRows()))

        await model.load()

        XCTAssertEqual(model.usage.count, 7)
        XCTAssertEqual(StorageSettingsModel.usageOrder.count, 7)
        XCTAssertEqual(StorageSettingsModel.usageOrder.first, .cards)
        XCTAssertEqual(StorageSettingsModel.usageOrder.last, .shellState)
        XCTAssertEqual(model.usageRow(.shellState)?.bytes, 50_000)
        XCTAssertEqual(model.usageRow(.cache)?.cleanableBytes, 4_000)
        XCTAssertNil(model.errorMessage)
    }

    func testToggleSelectsAndRemovesCategory() {
        let model = makeModel()

        model.toggle(.cache)
        model.toggle(.logs)
        XCTAssertEqual(model.selected, [.cache, .logs])

        model.toggle(.cache)
        XCTAssertEqual(model.selected, [.logs])
    }

    func testPreviewSendsSelectedCategoriesInFixedOrder() async {
        let model = makeModel()
        let service = FakeCardiaryService(storageUsage: usageRows())
        model.attach(service: service)

        model.toggle(.logs)
        model.toggle(.indexes)
        model.toggle(.cache)
        await model.previewCleanup()

        let requested = await service.storagePreviewCategories
        XCTAssertEqual(requested, [["cache", "indexes", "logs"]])
        XCTAssertEqual(model.preview?.targets.count, 3)
    }

    func testChangingSelectionDiscardsPreview() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(storageUsage: usageRows()))

        model.toggle(.cache)
        await model.previewCleanup()
        XCTAssertNotNil(model.preview)

        model.toggle(.logs)
        XCTAssertNil(model.preview)
    }

    func testPreviewWithoutSelectionReportsAndSendsNothing() async {
        let model = makeModel()
        let service = FakeCardiaryService(storageUsage: usageRows())
        model.attach(service: service)

        await model.previewCleanup()

        let requested = await service.storagePreviewCategories
        XCTAssertEqual(requested, [])
        XCTAssertEqual(model.errorMessage, "先選取要清理的類別。")
        XCTAssertNil(model.preview)
    }

    func testApplyWithoutPreviewDoesNothing() async {
        let model = makeModel()
        let service = FakeCardiaryService(storageUsage: usageRows())
        model.attach(service: service)

        await model.applyCleanup()

        let applied = await service.storageApplyCategories
        XCTAssertEqual(applied, [])
        XCTAssertNil(model.errorMessage)
        XCTAssertNil(model.noticeMessage)
    }

    func testApplyUsesPreviewedCategoriesAndReloadsUsage() async {
        let model = makeModel()
        let service = FakeCardiaryService(storageUsage: usageRows())
        model.attach(service: service)
        await model.load()

        model.toggle(.logs)
        model.toggle(.cache)
        await model.previewCleanup()
        await model.applyCleanup()

        let previewed = await service.storagePreviewCategories
        let applied = await service.storageApplyCategories
        let usageCalls = await service.storageUsageCalls
        XCTAssertEqual(previewed, [["cache", "logs"]])
        XCTAssertEqual(applied, [["cache", "logs"]])
        XCTAssertEqual(usageCalls, 2, "清除後要重新載入用量")
        XCTAssertEqual(model.selected, [])
        XCTAssertNil(model.preview)
        XCTAssertNil(model.errorMessage)
        XCTAssertNotNil(model.noticeMessage)
    }

    func testLoadFailureShowsMessage() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(failure: .storageUsage))

        await model.load()

        XCTAssertEqual(model.errorMessage, "設定請求失敗：storageUsage")
        XCTAssertTrue(model.usage.isEmpty)
    }

    func testPreviewFailureShowsMessageAndClearsPreview() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(failure: .storagePreview))

        model.toggle(.cache)
        await model.previewCleanup()

        XCTAssertEqual(model.errorMessage, "設定請求失敗：storagePreview")
        XCTAssertNil(model.preview)
    }

    func testApplyFailureShowsMessage() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(
            storageUsage: usageRows(),
            failure: .storageApply
        ))

        model.toggle(.cache)
        await model.previewCleanup()
        await model.applyCleanup()

        XCTAssertEqual(model.errorMessage, "設定請求失敗：storageApply")
        XCTAssertNil(model.noticeMessage)
        XCTAssertEqual(model.selected, [.cache], "清除失敗時保留選取，讓使用者可以重試")
    }

    func testDetachClearsState() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(storageUsage: usageRows()))

        model.toggle(.cache)
        await model.previewCleanup()
        await model.load()
        model.detach()

        XCTAssertTrue(model.usage.isEmpty)
        XCTAssertEqual(model.selected, [])
        XCTAssertNil(model.preview)
    }

    // MARK: - 資料夾外寫入明細

    private func outsideWrites() -> [StorageOutsideWriteEntry] {
        [
            StorageOutsideWriteEntry(
                path: "/Users/me/.claude/projects",
                tool: "claude-code",
                bytes: 2_048,
                status: .measured
            ),
            StorageOutsideWriteEntry(
                path: "/Users/me/.claude/backups",
                tool: "claude-code",
                bytes: 0,
                status: .absent
            ),
            StorageOutsideWriteEntry(
                path: "/Users/me/Library/Caches/claude-cli-nodejs",
                tool: "claude-code",
                bytes: nil,
                status: .unavailable
            ),
        ]
    }

    func testLoadFromResponseWithoutOutsideWritesIsEmpty() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(storageUsage: usageRows()))

        await model.load()

        XCTAssertTrue(model.outsideWrites.isEmpty, "舊版回應缺欄位時不顯示外部明細")
        XCTAssertNil(model.errorMessage)
    }

    func testLoadPreservesAllThreeOutsideWriteStates() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(
            storageUsage: usageRows(),
            storageOutsideWrites: outsideWrites()
        ))

        await model.load()

        XCTAssertEqual(model.outsideWrites.count, 3)
        XCTAssertEqual(model.outsideWrites[0].status, .measured)
        XCTAssertEqual(model.outsideWrites[0].bytes, 2_048)
        XCTAssertEqual(model.outsideWrites[1].status, .absent)
        XCTAssertEqual(model.outsideWrites[1].bytes, 0)
        XCTAssertEqual(model.outsideWrites[2].status, .unavailable)
        XCTAssertNil(model.outsideWrites[2].bytes, "unavailable 不能把 nil 變成 0")
    }

    func testDetachClearsOutsideWrites() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(
            storageUsage: usageRows(),
            storageOutsideWrites: outsideWrites()
        ))
        await model.load()
        XCTAssertEqual(model.outsideWrites.count, 3)

        model.detach()

        XCTAssertTrue(model.outsideWrites.isEmpty)
    }

    func testReloadFromPresentToMissingClearsOutsideWrites() async {
        let model = makeModel()
        let service = FakeCardiaryService(
            storageUsage: usageRows(),
            storageOutsideWrites: outsideWrites()
        )
        model.attach(service: service)
        await model.load()
        XCTAssertEqual(model.outsideWrites.count, 3)

        await service.setStorageOutsideWrites(nil)
        await model.load()

        XCTAssertTrue(model.outsideWrites.isEmpty, "從有欄位重載到舊版缺欄位要清掉舊明細")
    }

    func testOutsideWritesStayOutOfSevenCategoriesAndCleanupRequests() async {
        let model = makeModel()
        let service = FakeCardiaryService(
            storageUsage: usageRows(),
            storageOutsideWrites: outsideWrites()
        )
        model.attach(service: service)
        await model.load()

        model.toggle(.cache)
        await model.previewCleanup()
        await model.applyCleanup()

        let previewed = await service.storagePreviewCategories
        let applied = await service.storageApplyCategories
        XCTAssertEqual(model.usage.count, 7, "外部明細不進七類用量")
        XCTAssertEqual(previewed, [["cache"]])
        XCTAssertEqual(applied, [["cache"]], "清除請求不含外部位置")
    }

    func testOutsideWriteSizeFormatting() {
        let measured = StorageOutsideWriteEntry(
            path: "/p", tool: "claude-code", bytes: 2_048, status: .measured
        )
        XCTAssertEqual(
            StorageSettingsModel.outsideWriteSize(measured, language: .zhHant),
            StorageSettingsModel.formattedBytes(2_048)
        )

        let absent = StorageOutsideWriteEntry(
            path: "/p", tool: "claude-code", bytes: 0, status: .absent
        )
        XCTAssertEqual(
            StorageSettingsModel.outsideWriteSize(absent, language: .zhHant),
            "不存在"
        )

        let unavailable = StorageOutsideWriteEntry(
            path: "/p", tool: "claude-code", bytes: nil, status: .unavailable
        )
        XCTAssertEqual(
            StorageSettingsModel.outsideWriteSize(unavailable, language: .zhHant),
            "無法取得大小（可能權限不足）"
        )

        let measuredMissingBytes = StorageOutsideWriteEntry(
            path: "/p", tool: "claude-code", bytes: nil, status: .measured
        )
        XCTAssertEqual(
            StorageSettingsModel.outsideWriteSize(measuredMissingBytes, language: .zhHant),
            "無法取得大小（可能權限不足）",
            "measured 缺 bytes 不能顯示 0 B"
        )
    }

    func testOutsideWriteToolName() {
        XCTAssertEqual(
            StorageSettingsModel.outsideWriteToolName("claude-code", language: .zhHant),
            "Claude Code"
        )
        XCTAssertEqual(
            StorageSettingsModel.outsideWriteToolName("some-other-tool", language: .zhHant),
            "some-other-tool",
            "未知工具保留原字串"
        )
    }
}
