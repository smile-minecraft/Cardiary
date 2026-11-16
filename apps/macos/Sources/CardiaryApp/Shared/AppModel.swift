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

    /// 目前的服務連線；畫面與模型都從這裡取得請求方法。
    public private(set) var service: (any CardiaryService)?
    /// 原檔上傳與媒體匯入；殼提供端點與 Token，App 不自己拼。
    public private(set) var media: (any MediaService)?
    /// 卡片與封存的模型；由 `CardUIModule` 掛上，AppModel 只轉發生命週期。
    public private(set) var contentModels: [any AppContentModel] = []

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
        conversation.onMessageSent = { [weak self] in
            await self?.conversations.reload()
        }
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
    ///
    /// `media` 由殼一起給：原檔的 HTTP 端點與 client Token 只有殼知道。
    public func attach(client: CardiaryClient, media: (any MediaService)?) {
        self.media = media
        Task { await attach(service: client) }
    }

    /// 只換原檔服務（測試或殼更正端點時）；不影響協定連線。
    public func attach(media: (any MediaService)?) {
        self.media = media
    }

    public func attach(service: any CardiaryService) async {
        self.service = service
        conversations.attach(service: service)
        conversation.attach(service: service)
        firstRun.attach(service: service)
        approvals.attach(service: service)
        settingsModel.attach(service: service)
        for model in contentModels {
            model.attach(service: service)
        }
        await reloadAfterAttach()
        // 首次設定停在「選模型」時，連線一好就把供應商與模型載進來。
        if firstRun.step == .model, firstRun.providers.isEmpty {
            await firstRun.loadModels()
        }
    }

    public func detachClient() {
        service = nil
        media = nil
        for model in contentModels {
            model.detach()
        }
        conversation.markDisconnected()
        settingsModel.detach()
        firstRun.detach()
        update(approvals: nil)
    }

    /// epoch 換代：舊 epoch 的事件與狀態一律丟棄，重新列出對話並載入目前對話。
    /// 卡片與封存的模型收到同一個通知，自己從主機重新載入。
    public func handleEpochChange(epoch: String) async {
        for model in contentModels {
            await model.handleEpochChange(epoch: epoch)
        }
        guard let service else { return }
        await conversations.reload()
        if case .conversation(let id) = selection {
            await conversation.open(sessionId: id, service: service)
        }
        reconcileSelection()
    }

    /// 殼轉來的會話事件。對話只套用目前開啟的那一場；卡片與封存的模型自己過濾。
    public func handle(sessionEvent frame: ServerFrame) {
        conversations.handle(frame: frame)
        reconcileSelection()
        conversation.apply(frame: frame)
        for model in contentModels {
            model.handle(event: frame)
        }
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

    public func showApprovals() {
        guard approvals.count > 0 else { return }
        isInspectorVisible = true
    }

    public func openImport() {
        commands.group(AppRegistry.importCommandsGroupId)?.commands
            .first(where: { $0.id == "import.open" })?.action()
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

    // MARK: - 掛載點

    /// 把卡片介面的模型、畫面、檢視欄、設定分頁與選單掛上。
    ///
    /// 由 `CardUIModule.install` 呼叫。重複呼叫時同一個位置、面板、分頁與命令都只留
    /// 一份，測試換一組畫面或重新組合都不會疊出兩份。
    public func installCardUI(_ screens: CardUIScreens) {
        if !contentModels.isEmpty {
            for model in contentModels {
                model.detach()
            }
        }
        contentModels = screens.models
        if let service {
            for model in contentModels {
                model.attach(service: service)
            }
        }
        sidebar.installContent(for: AppRegistry.cardsSlotId) { screens.cardLibrary() }
        sidebar.installContent(for: AppRegistry.archiveSlotId) { screens.archive() }
        inspector.register(screens.contextInspector())
        if let makeTab = screens.freshnessSettings {
            settings.register(makeTab())
        }
        for command in screens.cardCommands {
            commands.upsert(command, in: AppRegistry.cardCommandsGroupId)
        }
    }

    /// 把匯入介面的命令掛上；由 `ImportUIModule.install` 呼叫。
    public func installImportUI(_ entry: ImportUIEntry) {
        for command in entry.commands {
            commands.upsert(command, in: AppRegistry.importCommandsGroupId)
        }
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
