import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 一般設定：分級顯示、草稿、逐項儲存與格式錯誤。
///
/// 這裡斷言介面字串，固定用繁體中文，不跟著 CI runner 的系統語言。
@MainActor
final class GeneralSettingsModelTests: XCTestCase {
    private func makeModel() -> GeneralSettingsModel {
        GeneralSettingsModel(language: .zhHant)
    }

    private func items() -> [SettingItem] {
        [
            SettingItem(
                key: "models.summary.maxOutputTokens",
                value: .number(4096),
                level: .free,
                title: "摘要輸出上限",
                description: "小於 4,096 時主機仍用 4,096",
                updatedAt: "2026-01-01T00:00:00Z"
            ),
            SettingItem(
                key: "ui.showTimestamps",
                value: .bool(true),
                level: .approval,
                updatedAt: "2026-01-01T00:00:00Z"
            ),
            SettingItem(
                key: "models.defaultNote",
                value: .string("草案"),
                level: .humanOnly,
                updatedAt: "2026-01-01T00:00:00Z"
            ),
        ]
    }

    func testLoadFillsDraftsAndKeepsLevels() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(settings: items()))

        await model.load()

        XCTAssertEqual(model.items.count, 3)
        XCTAssertEqual(model.drafts["models.summary.maxOutputTokens"], "4096")
        XCTAssertEqual(model.drafts["ui.showTimestamps"], "true")
        XCTAssertEqual(model.drafts["models.defaultNote"], "草案")
        XCTAssertEqual(GeneralSettingsModel.levelKey(.humanOnly), .settingsLevelHumanOnly)
        XCTAssertEqual(
            model.title(for: model.items[1]),
            "ui.showTimestamps",
            "沒有標題時顯示鍵名"
        )
        XCTAssertEqual(
            model.title(for: model.items[0]),
            "摘要輸出上限",
            "繁中界面用主機目錄的標題"
        )
    }

    func testLoadHidesModelOwnedSettings() async {
        let model = makeModel()
        let settings = items() + [
            SettingItem(
                key: "models.providers",
                value: .array([]),
                level: .approval,
                title: "模型供應商",
                updatedAt: "2026-01-01T00:00:00Z"
            ),
            SettingItem(
                key: "models.roles",
                value: .array([]),
                level: .approval,
                title: "模型角色",
                updatedAt: "2026-01-01T00:00:00Z"
            ),
            SettingItem(
                key: "remote.accessEnabled",
                value: .bool(false),
                level: .humanOnly,
                title: "允許遠端裝置連線",
                updatedAt: "2026-01-01T00:00:00Z"
            ),
        ]
        model.attach(service: FakeCardiaryService(settings: settings))

        await model.load()

        XCTAssertEqual(model.items.count, 3, "供應商、角色與遠端開關只在各自的分頁")
        XCTAssertNil(model.drafts["models.providers"])
        XCTAssertNil(model.drafts["models.roles"])
        XCTAssertNil(model.drafts["remote.accessEnabled"])
        XCTAssertNil(model.errorMessage)
    }

    func testEnglishUsesLocalizedTitlesWithoutHostChinese() async {
        let model = GeneralSettingsModel(language: .en)
        model.attach(service: FakeCardiaryService(settings: items()))
        await model.load()

        let summary = model.items[0]
        XCTAssertEqual(model.title(for: summary), "Summary output limit")
        XCTAssertEqual(
            model.description(for: summary),
            "Output token limit for summaries and distillation; the host still uses 4,096 when the setting is lower."
        )
        let unknown = model.items[1]
        XCTAssertEqual(model.title(for: unknown), "ui.showTimestamps")
        XCTAssertNil(model.description(for: unknown), "沒有在地化字串時不顯示中文說明")
    }

    func testToggleSendsInvertedBoolean() async {
        let fake = FakeCardiaryService(settings: items())
        let model = makeModel()
        model.attach(service: fake)
        await model.load()

        await model.toggle(model.items[1])

        let changes = await fake.settingChanges
        XCTAssertEqual(changes.last?.count, 1)
        XCTAssertEqual(changes.last?.first?.key, "ui.showTimestamps")
        XCTAssertEqual(changes.last?.first?.value, .bool(false))
        XCTAssertEqual(model.noticeMessage, "已儲存。")
        XCTAssertEqual(model.boolValue(model.items[1]), false, "套用主機回應後的現值")
    }

    func testInvalidNumberKeepsValueAndShowsError() async {
        let fake = FakeCardiaryService(settings: items())
        let model = makeModel()
        model.attach(service: fake)
        await model.load()

        model.drafts["models.summary.maxOutputTokens"] = "很多"
        await model.save(key: "models.summary.maxOutputTokens")

        let changes = await fake.settingChanges
        XCTAssertTrue(changes.isEmpty, "格式不對時不能送給主機")
        XCTAssertEqual(model.errorMessage, "這個值格式不對。")
        XCTAssertEqual(model.drafts["models.summary.maxOutputTokens"], "很多", "保留使用者輸入")
    }

    func testSaveStringAndNumber() async {
        let fake = FakeCardiaryService(settings: items())
        let model = makeModel()
        model.attach(service: fake)
        await model.load()

        model.drafts["models.summary.maxOutputTokens"] = "8192"
        await model.save(key: "models.summary.maxOutputTokens")
        model.drafts["models.defaultNote"] = "正式"
        await model.save(key: "models.defaultNote")

        let changes = await fake.settingChanges
        XCTAssertEqual(changes.count, 2)
        XCTAssertEqual(changes[0].first?.value, .number(8192))
        XCTAssertEqual(changes[1].first?.value, .string("正式"))
        XCTAssertEqual(model.drafts["models.defaultNote"], "正式")
    }

    func testLoadWithoutServiceShowsError() async {
        let model = makeModel()
        await model.load()
        XCTAssertEqual(model.errorMessage, "還沒連上服務，設定需要連線。")
    }

    func testMessagesFollowInjectedLanguage() async {
        let english = GeneralSettingsModel(language: .en)
        await english.load()
        XCTAssertEqual(english.errorMessage, "Settings need a service connection.")

        let chinese = GeneralSettingsModel(language: .zhHant)
        await chinese.load()
        XCTAssertEqual(chinese.errorMessage, "還沒連上服務，設定需要連線。")
    }
}
