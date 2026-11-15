import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 模組分頁：清單、狀態與啟停。
///
/// 這裡斷言介面字串，固定用繁體中文，不跟著 CI runner 的系統語言。
@MainActor
final class ModulesSettingsModelTests: XCTestCase {
    private func makeModel() -> ModulesSettingsModel {
        ModulesSettingsModel(language: .zhHant)
    }

    private func module(
        _ id: String,
        enabled: Bool = true,
        state: ModuleState = .active,
        failure: String? = nil
    ) -> ModuleInfo {
        ModuleInfo(
            moduleId: id,
            name: "模組 \(id)",
            version: "1.0.0",
            enabled: enabled,
            state: state,
            failure: failure,
            protocolPrefixes: ["\(id)."],
            settings: []
        )
    }

    func testLoadListsModulesAndTheirState() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(modules: [
            module("cards"),
            module("local-tools", enabled: false, state: .inactive),
            module("media", state: .failed, failure: "載入失敗"),
        ]))

        await model.load()

        XCTAssertEqual(model.modules.map(\.moduleId), ["cards", "local-tools", "media"])
        XCTAssertEqual(ModulesSettingsModel.stateKey(.failed), .settingsModuleStateFailed)
        XCTAssertEqual(model.modules.last?.failure, "載入失敗")
    }

    func testSetEnabledUpdatesModuleFromResponse() async {
        let fake = FakeCardiaryService(modules: [module("cards")])
        let model = makeModel()
        model.attach(service: fake)
        await model.load()

        await model.setEnabled(model.modules[0], enabled: false)

        let changes = await fake.moduleChanges
        XCTAssertEqual(changes.last?.moduleId, "cards")
        XCTAssertEqual(changes.last?.enabled, false)
        XCTAssertEqual(model.modules[0].enabled, false)
        XCTAssertEqual(model.modules[0].state, .inactive)
        XCTAssertEqual(model.noticeMessage, "已儲存。")
    }

    func testSetEnabledWithoutServiceShowsError() async {
        let model = makeModel()
        await model.setEnabled(module("cards"), enabled: false)
        XCTAssertEqual(model.errorMessage, "還沒連上服務，設定需要連線。")
    }

    func testLoadWithoutServiceShowsError() async {
        let model = makeModel()
        await model.load()
        XCTAssertEqual(model.errorMessage, "還沒連上服務，設定需要連線。")
    }

    func testMessagesFollowInjectedLanguage() async {
        let english = ModulesSettingsModel(language: .en)
        await english.load()
        XCTAssertEqual(english.errorMessage, "Settings need a service connection.")

        let fake = FakeCardiaryService(modules: [module("cards")])
        english.attach(service: fake)
        await english.load()
        await english.setEnabled(english.modules[0], enabled: false)
        XCTAssertEqual(english.noticeMessage, "Saved.")

        let chinese = ModulesSettingsModel(language: .zhHant)
        chinese.attach(service: FakeCardiaryService(modules: [module("cards")]))
        await chinese.load()
        await chinese.setEnabled(chinese.modules[0], enabled: false)
        XCTAssertEqual(chinese.noticeMessage, "已儲存。")
    }
}
