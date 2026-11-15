import CardiaryKit
import CardiaryShellCore
import Combine
import Foundation

/// 介面選了哪裡。左側欄的對話與其他入口共用同一個選取狀態。
public enum AppSelection: Equatable, Hashable, Sendable {
    case conversation(String)
    case slot(String)
    case none
}

/// 產品介面的根狀態：畫面、左側欄選取、對話與四個擴充點。
///
/// 殼只透過這個型別與 `ShellBridge` 和介面溝通：殼呼叫 `update(folder:)`、
/// `update(connection:)`、`attach(client:)`，介面按鈕走 `bridge.actions`。
@MainActor
public final class AppModel: ObservableObject {
    public let bridge: ShellBridge
    public let conversations: ConversationListModel
    public let conversation: ConversationModel
    public let firstRun: FirstRunModel
    public let approvals: ApprovalModel
    public let settingsModel: SettingsModel
    public let sidebar = SidebarRegistry()
    public let inspector = InspectorRegistry()
    public let settings = SettingsRegistry()
    public let commands = CommandRegistry()

    @Published public private(set) var screen: AppScreen = .firstRun
    @Published public private(set) var selection: AppSelection = .none
    @Published public private(set) var isInspectorVisible = true
    @Published public var language: AppLanguage {
        didSet { AppL10n.language = language }
    }

    private var service: (any CardiaryService)?

    /// - Parameter setupCompleted: 殼在啟動時是否已經有資料夾授權紀錄。有的話是回訪，
    ///   直接進主畫面，不再走首次設定。
    public init(
        bridge: ShellBridge? = nil,
        language: AppLanguage = AppL10n.language,
        setupCompleted: Bool = false,
        keychain: (any KeychainWriting)? = nil
    ) {
        self.bridge = bridge ?? ShellBridge()
        self.language = language
        AppL10n.language = language
        self.conversations = ConversationListModel()
        self.conversation = ConversationModel()
        self.firstRun = FirstRunModel(keychain: keychain)
        self.approvals = ApprovalModel(language: language)
        self.settingsModel = SettingsModel(keychain: keychain, language: language)
        AppRegistry.installBuiltins(self)
        if setupCompleted {
            firstRun.markComplete()
        }
        recomputeScreen()
    }

    public var isServiceAvailable: Bool { service != nil }

    // MARK: - 殼推來的狀態

    public func update(folder: FolderPresentation) {
        bridge.update(folder: folder)
        if folder.availability == .ready {
            firstRun.folderDidBecomeReady()
        }
        recomputeScreen()
    }

    public func update(connection: ConnectionPresentation) {
        bridge.update(connection: connection)
        recomputeScreen()
    }

    /// 殼推來的完整待審批清單；`nil` 代表還沒連上服務（數量未知）。
    public func update(approvals: [ApprovalRequest]?) {
        self.approvals.update(requests: approvals)
        bridge.update(approvalCount: approvals?.count)
    }

    /// 新的客戶端連線（第一次連上、重連、服務換行程後都走這裡）。
    public func attach(client: CardiaryClient) {
        Task { await attach(service: client) }
    }

    public func attach(service: any CardiaryService) async {
        self.service = service
        conversations.attach(service: service)
        conversation.attach(service: service)
        firstRun.attach(service: service)
        approvals.attach(service: service)
        settingsModel.attach(service: service)
        await reloadAfterAttach()
        // 首次設定停在「選模型」時，連線一好就把供應商與模型載進來。
        if firstRun.step == .model, firstRun.providers.isEmpty {
            await firstRun.loadModels()
        }
    }

    public func detachClient() {
        service = nil
        conversation.markDisconnected()
        settingsModel.detach()
        firstRun.detach()
        update(approvals: nil)
    }

    /// epoch 換代：舊 epoch 的事件與狀態一律丟棄，重新列出對話並載入目前對話。
    public func handleEpochChange(epoch: String) async {
        guard let service else { return }
        await conversations.reload()
        if case .conversation(let id) = selection {
            await conversation.open(sessionId: id, service: service)
        }
        reconcileSelection()
    }

    /// 殼轉來的會話事件。只有目前開啟的對話會套用。
    public func handle(sessionEvent frame: ServerFrame) {
        conversation.apply(frame: frame)
    }

    // MARK: - 介面動作

    public func chooseFolder() {
        bridge.actions.chooseFolder()
    }

    public func retry() {
        bridge.actions.retry()
    }

    public func pauseAllApprovals() {
        bridge.actions.pauseAllApprovals()
    }

    public func toggleInspector() {
        isInspectorVisible.toggle()
    }

    public func selectSlot(_ id: String) {
        selection = .slot(id)
    }

    public func selectConversation(_ id: String) async {
        selection = .conversation(id)
        conversations.select(id)
        guard let service else { return }
        let title = conversations.sessions.first { $0.id == id }?.title
        await conversation.open(sessionId: id, title: title, service: service)
    }

    /// 建立新對話並打開它。
    @discardableResult
    public func createConversation() async -> String? {
        await conversations.reload()
        guard let id = await conversations.create() else { return nil }
        selection = .conversation(id)
        conversations.select(id)
        if let service {
            await conversation.open(sessionId: id, service: service)
        }
        return id
    }

    /// 首次設定的最後一步：開第一場對話，之後不再顯示設定流程。
    public func startFirstConversation() async {
        guard await createConversation() != nil else { return }
        firstRun.markComplete()
        recomputeScreen()
    }

    public func selectSettings() {
        selection = .slot(AppRegistry.settingsSlotId)
    }

    // MARK: - 內部

    private func reloadAfterAttach() async {
        await conversations.reload()
        reconcileSelection()
        if case .conversation(let id) = selection, let service {
            await conversation.open(sessionId: id, service: service)
        }
    }

    /// 選擇的對話還在就保留；不見了就改選清單裡的第一場。
    private func reconcileSelection() {
        switch selection {
        case .conversation(let id):
            if !conversations.sessions.contains(where: { $0.id == id }) {
                if let first = conversations.sessions.first {
                    selection = .conversation(first.id)
                    conversations.select(first.id)
                } else {
                    selection = .none
                    conversations.select(nil)
                }
            }
        case .slot, .none:
            // 還沒選過對話時，跟著清單的第一場走（重連後也能回到原本的工作）。
            if case .none = selection, let id = conversations.selectedId {
                selection = .conversation(id)
            }
        }
    }

    private func recomputeScreen() {
        switch bridge.folder.availability {
        case .unselected:
            screen = .firstRun
        case .unavailable:
            screen = .unavailable(.unavailable)
        case .mismatch:
            screen = .unavailable(.mismatch)
        case .ready:
            if bridge.connection == .needsUpdate {
                screen = .needsUpdate
            } else if firstRun.isComplete {
                screen = .main
            } else {
                screen = .firstRun
            }
        }
    }
}
