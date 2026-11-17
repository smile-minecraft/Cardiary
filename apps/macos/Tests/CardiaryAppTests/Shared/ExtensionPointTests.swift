import CardiaryKit
import Foundation
import SwiftUI
import XCTest

@testable import CardiaryApp

/// 幾個介面工作共用的掛載點：順序、取代與新增。
@MainActor
final class ExtensionPointTests: XCTestCase {
    func testBuiltinSlotsHaveFixedOrder() {
        let model = AppModel(setupCompleted: true)

        XCTAssertEqual(
            model.sidebar.all.map(\.id),
            ["conversations", "cards", "archive", "notifications", "whiteboard", "documents", "settings"]
        )
        XCTAssertEqual(model.sidebar.slot("conversations")?.titleKey, .sidebarSectionSession)
        XCTAssertEqual(model.sidebar.slot("cards")?.placeholderKey, .placeholderCards)
    }

    func testInstallContentKeepsPositionAndOrder() {
        let model = AppModel(setupCompleted: true)
        // 掛載點預設就給了佔位畫面，卡片介面之後只換內容、不換位置。
        XCTAssertNotNil(model.sidebar.slot("cards")?.content)
        XCTAssertNotNil(model.sidebar.slot("archive")?.content)

        let installed = model.sidebar.installContent(for: "cards") {
            AnyView(Text("cards"))
        }
        XCTAssertTrue(installed)
        XCTAssertEqual(
            model.sidebar.all.map(\.id),
            ["conversations", "cards", "archive", "notifications", "whiteboard", "documents", "settings"],
            "掛上內容不應改變其他入口的順序"
        )
        XCTAssertNotNil(model.sidebar.slot("cards")?.content)
        XCTAssertNotNil(model.sidebar.slot("archive")?.content)

        XCTAssertFalse(model.sidebar.installContent(for: "unknown") { AnyView(Text("x")) })
    }

    func testInspectorRegistryReplacesPanelWithSameId() {
        let model = AppModel(setupCompleted: true)
        let count = model.inspector.all.count

        model.inspector.register(RecordingPanel(id: "approvals", titleKey: .inspectorApprovalsTitle))
        XCTAssertEqual(model.inspector.all.count, count, "同 id 應取代而不是新增")
        XCTAssertTrue(model.inspector.panel("approvals") is RecordingPanel)
    }

    func testSettingsTabsKeepOrderAndAllowAdding() {
        let model = AppModel(setupCompleted: true)
        XCTAssertEqual(
            model.settings.all.map(\.id),
            ["models", "general", "modules", "storage", "mcp", "remote"]
        )

        model.settings.register(PlaceholderSettingsTab(
            id: "freshness",
            titleKey: .settingsGeneralTab,
            messageKey: .placeholderComingSoon
        ))
        XCTAssertEqual(
            model.settings.all.map(\.id),
            ["models", "general", "modules", "storage", "mcp", "remote", "freshness"]
        )

        model.settings.register(PlaceholderSettingsTab(
            id: "models",
            titleKey: .settingsModelsTab,
            messageKey: .placeholderCards
        ))
        XCTAssertEqual(
            model.settings.all.map(\.id),
            ["models", "general", "modules", "storage", "mcp", "remote", "freshness"]
        )
    }

    func testBuiltinTabsAndPanelsAreRealImplementations() {
        let model = AppModel(setupCompleted: true)

        XCTAssertTrue(model.inspector.panel("approvals") is ApprovalInspectorPanel)
        XCTAssertTrue(model.settings.tab("models") is ModelsSettingsTab)
        XCTAssertTrue(model.settings.tab("general") is GeneralSettingsTab)
        XCTAssertTrue(model.settings.tab("modules") is ModulesSettingsTab)
        XCTAssertTrue(model.settings.tab("storage") is StorageSettingsTab)
        XCTAssertTrue(model.settings.tab("mcp") is McpSettingsTab)
        XCTAssertTrue(model.settings.tab("remote") is RemoteSettingsTab)
    }

    func testCommandGroupsHaveFixedSlots() {
        let model = AppModel(setupCompleted: true)
        XCTAssertEqual(model.commands.groups.map(\.id), ["view", "cards", "import"])
        XCTAssertEqual(model.commands.group("cards")?.commands.isEmpty, true)
        XCTAssertEqual(
            model.commands.group("import")?.commands.map(\.id),
            ["import.open"],
            "匯入流程預設掛上開啟命令"
        )

        XCTAssertTrue(model.commands.append(
            AppCommand(id: "import.preview", titleKey: .commandGroupImport, action: {}),
            to: "import"
        ))
        XCTAssertEqual(
            model.commands.group("import")?.commands.map(\.id),
            ["import.open", "import.preview"]
        )
        XCTAssertFalse(model.commands.append(
            AppCommand(id: "nope", titleKey: .commandGroupImport, action: {}),
            to: "missing-group"
        ))
    }

    func testViewGroupHoldsToggleInspectorCommand() {
        let model = AppModel(setupCompleted: true)
        let command = model.commands.group("view")?.commands.first
        XCTAssertEqual(command?.titleKey, .commandToggleInspector)
    }
}

@MainActor
private final class RecordingPanel: InspectorPanel {
    let id: String
    let titleKey: AppString
    let subtitleKey: AppString? = nil

    init(id: String, titleKey: AppString) {
        self.id = id
        self.titleKey = titleKey
    }

    func makeBody() -> AnyView {
        AnyView(Text("recording"))
    }
}
