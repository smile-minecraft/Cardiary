import CardiaryKit
import Foundation
import SwiftUI
import XCTest

@testable import CardiaryApp

/// 卡片與匯入介面的掛載點：位置、模型、檢視欄、設定分頁與選單。
@MainActor
final class CardUIModuleTests: XCTestCase {
    private var originalMakeScreens: (@MainActor (AppModel) -> CardUIScreens)!
    private var originalMakeImportEntry: (@MainActor (AppModel) -> ImportUIEntry)!

    override func setUp() {
        super.setUp()
        originalMakeScreens = CardUIModule.makeScreens
        originalMakeImportEntry = ImportUIModule.makeEntry
        CardUIModule.makeScreens = { app in .pending(app: app) }
        ImportUIModule.makeEntry = { _ in .pending }
    }

    override func tearDown() {
        CardUIModule.makeScreens = originalMakeScreens
        ImportUIModule.makeEntry = originalMakeImportEntry
        super.tearDown()
    }

    func testInstallGivesEveryPositionContent() {
        let probeModel = ProbeContentModel()
        CardUIModule.makeScreens = { _ in
            CardUIScreens(
                models: [probeModel],
                cardLibrary: { AnyView(Text("卡片庫")) },
                archive: { AnyView(Text("封存區")) },
                contextInspector: { ProbeInspectorPanel() },
                freshnessSettings: { ProbeSettingsTab() },
                cardCommands: [
                    AppCommand(id: "cards.new", titleKey: .commandGroupCards) {},
                ]
            )
        }

        let model = AppModel(setupCompleted: true)

        XCTAssertNotNil(model.sidebar.slot("cards")?.content, "卡片庫要有內容")
        XCTAssertNotNil(model.sidebar.slot("archive")?.content, "封存區要有內容")
        XCTAssertEqual(
            model.sidebar.all.map(\.id),
            ["conversations", "cards", "archive", "notifications", "whiteboard", "documents", "settings"],
            "掛上內容不改變左側欄順序"
        )
        XCTAssertTrue(model.inspector.panel("context") is ProbeInspectorPanel, "檢視欄換掉預設的佔位面板")
        XCTAssertTrue(model.settings.tab("freshness") is ProbeSettingsTab)
        XCTAssertEqual(model.commands.group("cards")?.commands.map(\.id), ["cards.new"])
        XCTAssertTrue(model.contentModels.first === probeModel)
    }

    func testDefaultMountKeepsPlaceholdersAndIsSafeToRepeat() {
        let model = AppModel(setupCompleted: true)
        XCTAssertNotNil(model.sidebar.slot("cards")?.content)
        XCTAssertNotNil(model.sidebar.slot("archive")?.content)
        XCTAssertNotNil(model.inspector.panel("context"))
        XCTAssertTrue(model.commands.group("cards")?.commands.isEmpty ?? false)

        // 重複掛上同一組畫面：命令不會出現兩份，面板也不會多一個。
        let panelCount = model.inspector.all.count
        CardUIModule.install(model)
        XCTAssertEqual(model.inspector.all.count, panelCount)
        XCTAssertEqual(model.commands.group("cards")?.commands.count, 0)
    }

    func testModelsReceiveServiceEventsEpochAndDetach() async {
        let probeModel = ProbeContentModel()
        CardUIModule.makeScreens = { _ in
            CardUIScreens(
                models: [probeModel],
                cardLibrary: { AnyView(Text("卡片庫")) },
                archive: { AnyView(Text("封存區")) },
                contextInspector: { ProbeInspectorPanel() }
            )
        }
        let model = AppModel(setupCompleted: true)
        let service = FakeCardiaryService()

        await model.attach(service: service)
        XCTAssertTrue(probeModel.didAttach, "AppModel.attach 要把服務交給卡片模型")
        XCTAssertNotNil(model.service)

        let event = ServerFrame.cardChangedEvent(CardChangedEvent(
            stream: "system",
            seq: 3,
            emittedAt: "2026-01-01T00:00:03Z",
            payload: CardChangedEventPayload(cardId: "card-1", change: .updated)
        ))
        model.handle(sessionEvent: event)
        XCTAssertEqual(probeModel.events.count, 1)
        guard case .cardChangedEvent(let changed) = probeModel.events.first else {
            return XCTFail("模型沒有收到 card.changed")
        }
        XCTAssertEqual(changed.payload.cardId, "card-1")
        XCTAssertEqual(changed.stream, "system")

        await model.handleEpochChange(epoch: "epoch-2")
        XCTAssertEqual(probeModel.epochs, ["epoch-2"])

        await model.refreshContentModels()
        XCTAssertEqual(probeModel.refreshes, 1, "匯入完成等外部變更要讓內容模型自己重讀")

        model.detachClient()
        XCTAssertTrue(probeModel.didDetach)
        XCTAssertNil(model.service)
    }

    func testMediaServiceIsHandedOverAndCleared() async {
        let media = FakeMediaService()
        let model = AppModel(setupCompleted: true)

        model.attach(media: media)
        XCTAssertNotNil(model.media)

        await model.attach(service: FakeCardiaryService())
        XCTAssertNotNil(model.media, "協定連線不影響原檔服務")

        model.detachClient()
        XCTAssertNil(model.media, "斷線後不能留著指向舊 Token 的原檔服務")
    }

    func testImportModuleInstallsCommandsWithoutDuplicates() {
        ImportUIModule.makeEntry = { _ in
            ImportUIEntry(commands: [
                AppCommand(id: "import.open", titleKey: .commandGroupImport) {},
            ])
        }
        let model = AppModel(setupCompleted: true)
        XCTAssertEqual(model.commands.group("import")?.commands.map(\.id), ["import.open"])

        ImportUIModule.install(model)
        XCTAssertEqual(
            model.commands.group("import")?.commands.map(\.id),
            ["import.open"],
            "重複掛載不會出現兩份命令"
        )
    }
}

@MainActor
private final class ProbeContentModel: AppContentModel {
    var didAttach = false
    var didDetach = false
    var events: [ServerFrame] = []
    var epochs: [String] = []
    var refreshes = 0

    func attach(service: any CardiaryService) {
        didAttach = true
    }

    func detach() {
        didDetach = true
    }

    func handle(event frame: ServerFrame) {
        events.append(frame)
    }

    func handleEpochChange(epoch: String) async {
        epochs.append(epoch)
    }

    func refresh() async {
        refreshes += 1
    }
}

@MainActor
private final class ProbeInspectorPanel: InspectorPanel {
    let id = "context"
    let titleKey: AppString = .inspectorTitle
    let subtitleKey: AppString? = nil

    func makeBody() -> AnyView {
        AnyView(Text("上下文"))
    }
}

@MainActor
private final class ProbeSettingsTab: SettingsTab {
    let id = "freshness"
    let titleKey: AppString = .settingsGeneralTab

    func makeBody() -> AnyView {
        AnyView(Text("新鮮度"))
    }
}
