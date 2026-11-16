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
}
