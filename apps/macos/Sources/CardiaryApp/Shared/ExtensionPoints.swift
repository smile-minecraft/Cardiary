import SwiftUI

// MARK: - 左側欄

/// 左側欄的一個位置。`content` 為 nil 代表位置已保留、畫面還沒有人提供。
public struct SidebarSlot: Identifiable {
    public let id: String
    public let titleKey: AppString
    public let systemImage: String
    public let content: (@MainActor () -> AnyView)?
    public let placeholderKey: AppString

    public init(
        id: String,
        titleKey: AppString,
        systemImage: String,
        placeholderKey: AppString = .placeholderComingSoon,
        content: (@MainActor () -> AnyView)? = nil
    ) {
        self.id = id
        self.titleKey = titleKey
        self.systemImage = systemImage
        self.placeholderKey = placeholderKey
        self.content = content
    }
}

/// 左側欄的註冊表。順序由第一次註冊決定；其他介面工作只換內容，不改順序。
@MainActor
public final class SidebarRegistry {
    public private(set) var all: [SidebarSlot] = []
    private var index: [String: Int] = [:]

    public init() {}

    public func register(_ slot: SidebarSlot) {
        if let existing = index[slot.id] {
            all[existing] = slot
        } else {
            index[slot.id] = all.count
            all.append(slot)
        }
    }

    /// 讓其他介面工作把畫面掛進來。位置必須先由 App 註冊過。
    @discardableResult
    public func installContent(
        for id: String,
        content: @escaping @MainActor () -> AnyView
    ) -> Bool {
        guard let existing = index[id].map({ all[$0] }) else { return false }
        all[index[id]!] = SidebarSlot(
            id: existing.id,
            titleKey: existing.titleKey,
            systemImage: existing.systemImage,
            placeholderKey: existing.placeholderKey,
            content: content
        )
        return true
    }

    public func slot(_ id: String) -> SidebarSlot? {
        index[id].map { all[$0] }
    }
}

// MARK: - 右側檢視欄

/// 檢視欄的一片面板。主視窗只負責收合、寬度與順序。
@MainActor
public protocol InspectorPanel: AnyObject {
    var id: String { get }
    var titleKey: AppString { get }
    var subtitleKey: AppString? { get }
    func makeBody() -> AnyView
}

/// 還沒有人提供內容的面板，顯示一句說明。
@MainActor
public final class PlaceholderInspectorPanel: InspectorPanel {
    public let id: String
    public let titleKey: AppString
    public let subtitleKey: AppString?
    public let messageKey: AppString

    public init(id: String, titleKey: AppString, subtitleKey: AppString? = nil, messageKey: AppString) {
        self.id = id
        self.titleKey = titleKey
        self.subtitleKey = subtitleKey
        self.messageKey = messageKey
    }

    public func makeBody() -> AnyView {
        AnyView(PlaceholderTextView(messageKey: messageKey))
    }
}

/// 檢視欄的註冊表；同一個 id 後註冊的取代先前的（例如審批面板換成真的實作）。
@MainActor
public final class InspectorRegistry {
    public private(set) var all: [any InspectorPanel] = []
    private var index: [String: Int] = [:]

    public init() {}

    public func register(_ panel: any InspectorPanel) {
        if let existing = index[panel.id] {
            all[existing] = panel
        } else {
            index[panel.id] = all.count
            all.append(panel)
        }
    }

    public func panel(_ id: String) -> (any InspectorPanel)? {
        index[id].map { all[$0] }
    }
}

// MARK: - 設定分頁

@MainActor
public protocol SettingsTab: AnyObject {
    var id: String { get }
    var titleKey: AppString { get }
    func makeBody() -> AnyView
}

@MainActor
public final class PlaceholderSettingsTab: SettingsTab {
    public let id: String
    public let titleKey: AppString
    public let messageKey: AppString

    public init(id: String, titleKey: AppString, messageKey: AppString) {
        self.id = id
        self.titleKey = titleKey
        self.messageKey = messageKey
    }

    public func makeBody() -> AnyView {
        AnyView(PlaceholderTextView(messageKey: messageKey))
    }
}

@MainActor
public final class SettingsRegistry {
    public private(set) var all: [any SettingsTab] = []
    private var index: [String: Int] = [:]

    public init() {}

    public func register(_ tab: any SettingsTab) {
        if let existing = index[tab.id] {
            all[existing] = tab
        } else {
            index[tab.id] = all.count
            all.append(tab)
        }
    }

    public func tab(_ id: String) -> (any SettingsTab)? {
        index[id].map { all[$0] }
    }
}

// MARK: - 選單命令

/// 一個選單命令。`action` 由提供命令的目錄決定，殼只負責畫成 NSMenuItem。
public struct AppCommand: Identifiable {
    public let id: String
    public let titleKey: AppString
    public let action: @MainActor () -> Void

    public init(id: String, titleKey: AppString, action: @escaping @MainActor () -> Void) {
        self.id = id
        self.titleKey = titleKey
        self.action = action
    }
}

/// 選單的一個群組。App 先建立「卡片」「匯入」兩個空群組，其他工作往裡面加命令。
public struct CommandGroup: Identifiable {
    public let id: String
    public let titleKey: AppString
    public private(set) var commands: [AppCommand]

    public init(id: String, titleKey: AppString, commands: [AppCommand] = []) {
        self.id = id
        self.titleKey = titleKey
        self.commands = commands
    }

    mutating func append(_ command: AppCommand) {
        commands.append(command)
    }
}

@MainActor
public final class CommandRegistry {
    public private(set) var groups: [CommandGroup] = []
    private var index: [String: Int] = [:]

    public init() {}

    public func register(_ group: CommandGroup) {
        if let existing = index[group.id] {
            groups[existing] = group
        } else {
            index[group.id] = groups.count
            groups.append(group)
        }
    }

    @discardableResult
    public func append(_ command: AppCommand, to groupId: String) -> Bool {
        guard let existing = index[groupId] else { return false }
        groups[existing].append(command)
        return true
    }

    public func group(_ id: String) -> CommandGroup? {
        index[id].map { groups[$0] }
    }
}

/// 佔位畫面：說明這個位置由哪一項工作提供。
struct PlaceholderTextView: View {
    let messageKey: AppString

    var body: some View {
        VStack(spacing: DesignTokens.spacingS) {
            Image(systemName: "rectangle.dashed")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(AppL10n.text(messageKey))
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DesignTokens.spacingL)
    }
}
