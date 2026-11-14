import AppKit
import CardiaryKit
import CardiaryShellCore

/// 殼的主要協調者：資料夾授權、服務監管、選單列與視窗。
@MainActor
final class ShellController: NSObject {
    /// 客戶端 Token 的來源。
    ///
    /// 殼在每次啟動服務時簽發一把，經 `init.clientToken` 交給服務，服務在
    /// `ready.clientToken` 回同一把。Token 只在記憶體，不寫日誌或磁碟。
    private final class ClientTokenStore: @unchecked Sendable {
        private let lock = NSLock()
        private var token: String?

        var current: String? {
            lock.lock()
            defer { lock.unlock() }
            return token
        }

        func set(_ value: String?) {
            lock.lock()
            token = value
            lock.unlock()
        }
    }

    private let stateDirectory: ShellStateDirectory
    private let log: ShellLog
    private let keychain = KeychainStore()
    private let loginItem = LoginItemController()
    private let clientTokens = ClientTokenStore()

    private var authorization: FolderAuthorization?
    private var folder = FolderSnapshot.unselected
    /// 代理請求來自身序列佇列，不能直接讀主執行緒的狀態。
    private let folderBox = FolderSnapshotBox()
    private var supervisor: ServiceSupervisor?
    private var client: CardiaryClient?
    private var brokerService: BrokerService?
    private var approvalCount: Int?
    private var serviceSnapshot = ServiceStatusSnapshot()

    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private var infoWindow: InfoWindowController?
    private var volumeObservers: [NSObjectProtocol] = []
    private var securityScopedURL: URL?
    private var warningShownForPath: String?
    private var terminating = false
    private var loggedMissingClientToken = false
    private var reportedVersionMismatch = false
    private var pruneTimer: Timer?

    override init() {
        let directory = AppPaths.shellStateDirectory()
        self.stateDirectory = directory
        self.log = ShellLog(fileURL: directory.logURL())
        super.init()
    }

    // MARK: - 啟動

    func start() {
        try? stateDirectory.ensureExists()
        log.write("啟動 Cardiary 殼（狀態目錄 \(stateDirectory.root.path)）")
        let report = stateDirectory.pruneIfNeeded()
        if !report.removedFiles.isEmpty {
            log.write("殼狀態超過上限，移除 \(report.removedFiles.count) 個檔案（\(report.bytesBefore) → \(report.bytesAfter) bytes）")
        }

        let folderBox = self.folderBox
        brokerService = BrokerService(
            keychain: keychain,
            stateDirectory: stateDirectory,
            folderProvider: { folderBox.snapshot }
        )

        installStatusItem()
        observeVolumes()
        scheduleDailyPrune()
        loadAuthorization()

        if authorization == nil {
            refreshMenu()
            presentFirstRun()
        } else {
            refreshFolder(startService: true)
            refreshMenu()
        }
    }

    /// 殼狀態目錄的清理：啟動時做一次，執行期間每天再做一次。
    private func scheduleDailyPrune() {
        pruneTimer?.invalidate()
        pruneTimer = Timer.scheduledTimer(withTimeInterval: 24 * 60 * 60, repeats: true) {
            [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let report = self.stateDirectory.pruneIfNeeded()
                if !report.removedFiles.isEmpty {
                    self.log.write(
                        "每日清理殼狀態：移除 \(report.removedFiles.count) 個檔案（\(report.bytesBefore) → \(report.bytesAfter) bytes）"
                    )
                }
            }
        }
    }

    // MARK: - 資料夾

    private func loadAuthorization() {
        let url = stateDirectory.authorizationURL
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        do {
            authorization = try FolderAuthorizationStore.load(from: url)
            log.write("讀取資料夾授權紀錄：\(authorization?.displayPath ?? "?")")
        } catch {
            log.write("資料夾授權紀錄讀取失敗：\(error)")
            authorization = nil
        }
    }

    private func saveAuthorization() {
        guard let authorization else { return }
        do {
            try FolderAuthorizationStore.save(authorization, to: stateDirectory.authorizationURL)
        } catch {
            log.write("無法寫入資料夾授權紀錄：\(error)")
        }
    }

    /// 解析書籤、確認資料夾與磁碟狀態。不建立任何資料夾。
    private func refreshFolder(startService: Bool) {
        guard let authorization else {
            setFolder(.unselected)
            return
        }

        var isStale = false
        let resolved: URL
        do {
            resolved = try URL(
                resolvingBookmarkData: authorization.bookmark,
                options: [.withSecurityScope, .withoutUI],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
        } catch {
            log.write("書籤解析失敗：\(error)")
            setFolder(.unavailable, reason: "bookmark_unresolved", keepPath: authorization.displayPath)
            presentUnavailable()
            return
        }

        if securityScopedURL?.path != resolved.path {
            securityScopedURL?.stopAccessingSecurityScopedResource()
            _ = resolved.startAccessingSecurityScopedResource()
            securityScopedURL = resolved
        }
        if isStale {
            log.write("書籤已過期，重新建立")
            if let data = try? resolved.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil) {
                self.authorization?.bookmark = data
                saveAuthorization()
            }
        }

        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory)
        guard exists, isDirectory.boolValue else {
            // 資料夾不在：停在不可用畫面，絕不建立空資料夾。
            log.write("資料夾不在：\(resolved.path)")
            setFolder(.unavailable, reason: "missing", keepPath: resolved.path)
            presentUnavailable()
            return
        }

        let writable = FileManager.default.isWritableFile(atPath: resolved.path)
        let volume = VolumeProbe.probe(path: resolved.path)
        var state: FolderAvailabilityState = .ready
        var reason: String?

        if !writable {
            state = .mismatch
            reason = "not_writable"
        } else if let recorded = authorization.volumeUUID, let current = volume?.uuid, recorded != current {
            state = .mismatch
            reason = "volume_mismatch"
        }

        folder = FolderSnapshot(
            state: state,
            path: resolved.path,
            displayName: (resolved.path as NSString).lastPathComponent,
            volumeUUID: volume?.uuid,
            writable: writable
        )
        folderBox.snapshot = folder
        supervisor?.folderSnapshot = folder
        log.write("資料夾狀態：\(state.rawValue)\(reason.map { "（\($0)）" } ?? "")")

        if let volume, !volume.isAPFS, warningShownForPath != resolved.path {
            warningShownForPath = resolved.path
            let message = VolumeProbe.formatWarning(for: volume) ?? L10n.text(.nonAPFSWarningBody)
            log.write("資料夾所在磁碟不是 APFS：\(volume.fileSystemName ?? "?")")
            presentInfo(
                title: L10n.text(.nonAPFSWarningTitle),
                body: message,
                primary: nil,
                secondary: nil
            )
        }

        if state == .ready {
            hideUnavailable()
            if startService {
                startServiceIfNeeded()
            } else {
                Task { await supervisor?.restartIfFolderUsable() }
            }
        } else {
            presentUnavailable()
        }
    }

    private func setFolder(
        _ state: FolderAvailabilityState,
        reason: String? = nil,
        keepPath: String? = nil
    ) {
        folder = FolderSnapshot(
            state: state,
            path: keepPath ?? folder.path,
            displayName: keepPath.map { ($0 as NSString).lastPathComponent } ?? folder.displayName,
            volumeUUID: folder.volumeUUID,
            writable: state == .ready ? folder.writable : false
        )
        log.write("資料夾狀態：\(state.rawValue)\(reason.map { "（\($0)）" } ?? "")")
        folderBox.snapshot = folder
        supervisor?.folderSnapshot = folder
        refreshMenu()
    }

    private func presentFirstRun() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = L10n.text(.firstRunBody)
        panel.prompt = L10n.text(.firstRunChooseFolder)
        NSApp.activate(ignoringOtherApps: true)

        guard panel.runModal() == .OK, let url = panel.url else {
            // 首次啟動沒有選資料夾：停在「資料不可用」，不建立任何東西。
            setFolder(.unselected, reason: "first_run_cancelled")
            presentUnavailable()
            return
        }
        adoptFolder(url)
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = L10n.text(.firstRunBody)
        panel.prompt = L10n.text(.firstRunChooseFolder)
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        adoptFolder(url)
    }

    private func adoptFolder(_ url: URL) {
        let bookmark: Data
        do {
            bookmark = try url.bookmarkData(
                options: [.withSecurityScope],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
        } catch {
            log.write("建立書籤失敗：\(error)")
            presentInfo(
                title: L10n.text(.unavailableTitle),
                body: "\(error)",
                primary: nil,
                secondary: nil
            )
            return
        }

        let volume = VolumeProbe.probe(path: url.path)
        authorization = FolderAuthorization(
            displayPath: url.path,
            bookmark: bookmark,
            volumeUUID: volume?.uuid,
            volumePath: volume?.path,
            isExternalVolume: volume?.isExternal ?? false,
            folderId: nil
        )
        saveAuthorization()
        log.write("使用者選擇資料夾：\(url.path)")

        Task { [weak self] in
            guard let self else { return }
            if let supervisor = self.supervisor, supervisor.snapshot.phase != .stopped {
                let outcome = await supervisor.shutdownRetryingWhileBusy(reason: .restart)
                guard !outcome.isBusy else {
                    self.log.write("切換資料夾前無法停止舊服務（忙碌），保留原資料夾")
                    self.presentInfo(
                        title: L10n.text(.menuChooseFolder),
                        body: L10n.text(.serviceBusyBody),
                        primary: nil,
                        secondary: nil
                    )
                    return
                }
            }
            self.supervisor = nil
            self.client = nil
            self.refreshFolder(startService: true)
        }
    }

    // MARK: - 服務

    private func startServiceIfNeeded() {
        guard folder.isUsable, let path = folder.path else {
            log.write("資料夾不可用，不啟動服務")
            return
        }

        guard let node = AppPaths.nodeExecutable(), let script = AppPaths.serviceScript() else {
            log.write("找不到內嵌的 Node 或服務腳本，無法啟動服務")
            presentInfo(
                title: L10n.text(.serviceFailed),
                body: "Contents/Helpers/Node/node 或 Contents/Resources/Service/dist/main.js 不存在。",
                primary: nil,
                secondary: nil
            )
            return
        }

        if supervisor == nil {
            let plan = ServiceLaunchPlan.make(
                nodeURL: node,
                scriptURL: script,
                folderPath: path,
                // 空的資料夾由服務初始化；已有 state/folder.json 時這個旗標不影響。
                initializeFolder: true
            )
            let configuration = ServiceSupervisorConfiguration(launchPlan: plan)
            let broker = brokerService
            let supervisor = ServiceSupervisor(
                configuration: configuration,
                folder: folder,
                brokerHandler: { route, payload in
                    broker?.handle(route: route, payload: payload)
                        ?? .unavailable("殼尚未準備好。")
                }
            )
            supervisor.onStatusChange = { [weak self] snapshot in
                Task { @MainActor in self?.applyServiceSnapshot(snapshot) }
            }
            supervisor.onLog = { [weak self] message in
                let log = self?.log
                Task { @MainActor in log?.write(message) }
            }
            supervisor.onClientToken = { [weak self] token in
                Task { @MainActor in self?.acceptClientToken(token) }
            }
            supervisor.authorizedVolumeUUID = authorization?.volumeUUID
            self.supervisor = supervisor
        }

        guard let supervisor else { return }
        Task { await supervisor.start(folder: folder) }
    }

    private func applyServiceSnapshot(_ snapshot: ServiceStatusSnapshot) {
        serviceSnapshot = snapshot

        if let folderId = snapshot.folderId, authorization?.folderId != folderId {
            authorization?.folderId = folderId
            saveAuthorization()
        }

        if snapshot.phase == .running, let port = snapshot.clientPort {
            connectClientIfPossible(port: port)
        } else if snapshot.phase != .starting {
            // 服務停了或換了行程：舊的 Token 與連線都失效。
            dropClientConnection()
        }
        if let error = snapshot.lastError, error.hasPrefix("version_mismatch"), !reportedVersionMismatch {
            reportedVersionMismatch = true
            log.write("背景服務版本不符：\(error)")
            presentInfo(
                title: L10n.text(.unavailableVersionMismatch),
                body: L10n.text(.unavailableVersionMismatch),
                primary: nil,
                secondary: nil
            )
        }
        refreshMenu()
    }

    /// 服務就緒時回報的客戶端 Token；換一把就重連。
    private func acceptClientToken(_ token: String) {
        let changed = clientTokens.current != token
        clientTokens.set(token)
        if changed {
            dropClientConnection()
        }
        if serviceSnapshot.phase == .running, let port = serviceSnapshot.clientPort {
            connectClientIfPossible(port: port)
        }
    }

    /// 收掉客戶端連線；Token 留在 store，等新的進程換掉。
    private func dropClientConnection() {
        guard let existing = client else { return }
        client = nil
        approvalCount = nil
        Task { await existing.stop() }
        refreshMenu()
    }

    private func connectClientIfPossible(port: UInt16) {
        guard client == nil else { return }
        guard let token = clientTokens.current else {
            if !loggedMissingClientToken {
                loggedMissingClientToken = true
                log.write("還沒有 client Token，等服務就緒後再建立客戶端連線。")
            }
            return
        }
        loggedMissingClientToken = false
        guard let endpoint = URL(string: "ws://127.0.0.1:\(port)/v1/ws") else { return }

        let info = ClientInfoFactory.make()
        let configuration = CardiaryClient.Configuration(
            endpoint: endpoint,
            clientToken: token,
            client: info,
            subscribeActiveSessions: true
        )
        let client = CardiaryClient(configuration: configuration)
        client.handlers.onSystemStatus = { [weak self] status in
            Task { @MainActor in
                self?.log.write(
                    "協定狀態：folder=\(status.folder.state.rawValue) service=\(status.service.state.rawValue)"
                )
            }
        }
        client.handlers.onApprovalCount = { [weak self] count in
            Task { @MainActor in
                self?.approvalCount = count
                self?.refreshMenu()
            }
        }
        client.handlers.onDiagnostic = { [weak self] message in
            Task { @MainActor in self?.log.write(message) }
        }
        self.client = client
        Task { await client.start() }
    }

    private func stopServiceForUser() {
        guard let supervisor else { return }
        Task { [weak self] in
            guard let self else { return }
            // 慢速 pause／resume 在途時 shutdown 會回 busy：保留 supervisor 並重試，
            // 不能把未停止的服務丟掉。
            let outcome = await supervisor.shutdownRetryingWhileBusy(reason: .user)
            self.log.write("結束背景服務：cleanShutdown=\(outcome.cleanShutdown.map(String.init) ?? "nil")")
            guard !outcome.isBusy else {
                self.log.write("服務仍在生命週期操作中，保留監管並顯示忙碌")
                self.presentInfo(
                    title: L10n.text(.menuStopService),
                    body: L10n.text(.serviceBusyBody),
                    primary: nil,
                    secondary: nil
                )
                return
            }
            if let client = self.client {
                await client.stop()
                self.client = nil
            }
            self.supervisor = nil
            self.refreshMenu()
        }
    }

    private func pauseAllApprovals() {
        guard let client else {
            presentInfo(
                title: L10n.text(.menuPauseAll),
                body: L10n.text(.statusApprovalsUnavailable),
                primary: nil,
                secondary: nil
            )
            return
        }
        Task { [weak self] in
            do {
                try await client.pauseAllApprovals(reason: "user")
                self?.log.write("已送出緊急全部暫停")
            } catch {
                self?.log.write("緊急全部暫停失敗：\(error)")
            }
        }
    }

    // MARK: - 磁碟插拔

    private func observeVolumes() {
        let center = NSWorkspace.shared.notificationCenter
        let unmount = center.addObserver(
            forName: NSWorkspace.willUnmountNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleWillUnmount(notification) }
        }
        let mount = center.addObserver(
            forName: NSWorkspace.didMountNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleDidMount(notification) }
        }
        volumeObservers = [unmount, mount]
    }

    private func handleWillUnmount(_ notification: Notification) {
        guard let volumeURL = notification.userInfo?[NSWorkspace.volumeURLUserInfoKey] as? URL,
            let authorization
        else { return }

        let matchesPath = authorization.volumePath == volumeURL.path
        let probed = VolumeProbe.probe(path: volumeURL.path)
        let matchesUUID = authorization.volumeUUID != nil && probed?.uuid == authorization.volumeUUID
        guard matchesPath || matchesUUID else { return }

        log.write("磁碟即將卸載：\(volumeURL.path)，先暫停服務")
        // 先把資料夾標成不可用，避免行程被 SIGBUS 殺掉後殼又重啟它。
        setFolder(.unavailable, reason: "unmount", keepPath: folder.path)
        Task { [weak self] in
            let outcome = await self?.supervisor?.pause(reason: "unmount")
            self?.log.write("卸載前暫停結果：\(String(describing: outcome))")
        }
    }

    private func handleDidMount(_ notification: Notification) {
        guard let volumeURL = notification.userInfo?[NSWorkspace.volumeURLUserInfoKey] as? URL,
            let authorization
        else { return }

        let probed = VolumeProbe.probe(path: volumeURL.path)
        let matchesPath = authorization.volumePath == volumeURL.path
        let matchesUUID = authorization.volumeUUID != nil && probed?.uuid == authorization.volumeUUID
        guard matchesPath || matchesUUID else { return }

        log.write("磁碟已接回：\(volumeURL.path)")

        refreshFolder(startService: false)
        guard folder.isUsable else { return }

        // 只有一條路徑：暫停中走 resume；其他狀態才由 restartIfFolderUsable 判斷
        // 要不要啟動新行程。兩者不能同時排，否則接回時會有兩個服務。
        guard let supervisor else {
            // App 啟動時資料夾不在、服務從未啟動：接回後直接啟動。
            startServiceIfNeeded()
            return
        }

        let phase = supervisor.snapshot.phase
        Task { [weak self] in
            guard let self else { return }
            if phase == .paused {
                let outcome = await supervisor.resume(volumeUUID: self.folder.volumeUUID)
                self.log.write("接回後恢復結果：\(String(describing: outcome))")
                if outcome != .completed {
                    await supervisor.restartIfFolderUsable()
                }
            } else {
                await supervisor.restartIfFolderUsable()
            }
            self.refreshMenu()
        }
    }

    // MARK: - 選單列

    private func installStatusItem() {
        statusItem.menu = menu
        menu.autoenablesItems = false
        statusItem.button?.imagePosition = .imageOnly
        updateStatusIcon()
    }

    private func updateStatusIcon() {
        let symbol: String
        switch serviceSnapshot.phase {
        case .running: symbol = "circle.fill"
        case .starting: symbol = "arrow.triangle.2.circlepath"
        case .paused: symbol = "pause.circle"
        case .unavailable: symbol = "exclamationmark.triangle"
        case .failed: symbol = "xmark.circle"
        case .stopping, .stopped, .idle: symbol = "circle"
        }
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: statusText())
        image?.isTemplate = true
        statusItem.button?.image = image

        switch serviceSnapshot.phase {
        case .running: statusItem.button?.contentTintColor = .systemGreen
        case .paused: statusItem.button?.contentTintColor = .systemYellow
        case .unavailable, .failed: statusItem.button?.contentTintColor = .systemOrange
        default: statusItem.button?.contentTintColor = nil
        }
        statusItem.button?.toolTip = statusText()
    }

    private func statusText() -> String {
        if folder.state == .unavailable || folder.state == .mismatch {
            return L10n.text(.serviceUnavailable)
        }
        return L10n.text(serviceSnapshot.phase.localizationKey)
    }

    private func refreshMenu() {
        updateStatusIcon()
        menu.removeAllItems()

        let status = NSMenuItem(title: "\(L10n.text(.menuStatus))：\(statusText())", action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)

        let folderItem = NSMenuItem(
            title: "\(L10n.text(.menuFolderSection))：\(L10n.text(folder.state.localizationKey))",
            action: nil,
            keyEquivalent: ""
        )
        folderItem.isEnabled = false
        menu.addItem(folderItem)

        if let epoch = serviceSnapshot.epoch {
            let epochItem = NSMenuItem(title: "epoch \(epoch)", action: nil, keyEquivalent: "")
            epochItem.isEnabled = false
            menu.addItem(epochItem)
        }
        if serviceSnapshot.restarts > 0 {
            let restarts = NSMenuItem(
                title: L10n.count(.statusRestarts, count: serviceSnapshot.restarts),
                action: nil,
                keyEquivalent: ""
            )
            restarts.isEnabled = false
            menu.addItem(restarts)
        }
        if let lastError = serviceSnapshot.lastError {
            let item = NSMenuItem(
                title: L10n.format(.statusLastError, value: lastError),
                action: nil,
                keyEquivalent: ""
            )
            item.isEnabled = false
            menu.addItem(item)
        }

        menu.addItem(.separator())

        let approvalsTitle: String
        if let approvalCount {
            approvalsTitle = approvalCount == 0
                ? "\(L10n.text(.menuApprovals))：\(L10n.text(.menuApprovalsNone))"
                : "\(L10n.text(.menuApprovals))：" + L10n.count(.menuApprovalsCount, count: approvalCount)
        } else {
            approvalsTitle = "\(L10n.text(.menuApprovals))：\(L10n.text(.statusApprovalsUnavailable))"
        }
        let approvals = NSMenuItem(title: approvalsTitle, action: nil, keyEquivalent: "")
        approvals.isEnabled = false
        menu.addItem(approvals)

        let pauseAll = NSMenuItem(
            title: L10n.text(.menuPauseAll),
            action: #selector(pauseAllAction),
            keyEquivalent: ""
        )
        pauseAll.target = self
        pauseAll.isEnabled = client != nil
        menu.addItem(pauseAll)

        let stop = NSMenuItem(
            title: L10n.text(.menuStopService),
            action: #selector(stopServiceAction),
            keyEquivalent: ""
        )
        stop.target = self
        stop.isEnabled = [.running, .paused, .starting].contains(serviceSnapshot.phase)
        menu.addItem(stop)

        menu.addItem(.separator())

        let choose = NSMenuItem(
            title: L10n.text(.menuChooseFolder),
            action: #selector(chooseFolderAction),
            keyEquivalent: ""
        )
        choose.target = self
        menu.addItem(choose)

        let reveal = NSMenuItem(
            title: L10n.text(.menuOpenFolder),
            action: #selector(revealFolderAction),
            keyEquivalent: ""
        )
        reveal.target = self
        reveal.isEnabled = folder.path.map { FileManager.default.fileExists(atPath: $0) } ?? false
        menu.addItem(reveal)

        let retry = NSMenuItem(
            title: L10n.text(.unavailableRetry),
            action: #selector(retryAction),
            keyEquivalent: ""
        )
        retry.target = self
        retry.isEnabled = authorization != nil
        menu.addItem(retry)

        menu.addItem(.separator())

        let login = NSMenuItem(
            title: L10n.text(.menuLaunchAtLogin),
            action: #selector(toggleLoginItemAction),
            keyEquivalent: ""
        )
        login.target = self
        login.state = loginItem.isEnabled ? .on : .off
        menu.addItem(login)

        menu.addItem(.separator())

        let quit = NSMenuItem(
            title: L10n.text(.menuQuit),
            action: #selector(quitAction),
            keyEquivalent: "q"
        )
        quit.target = self
        menu.addItem(quit)
    }

    @objc private func pauseAllAction() {
        pauseAllApprovals()
    }

    @objc private func stopServiceAction() {
        stopServiceForUser()
    }

    @objc private func chooseFolderAction() {
        chooseFolder()
    }

    @objc private func revealFolderAction() {
        guard let path = folder.path else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }

    @objc private func retryAction() {
        refreshFolder(startService: true)
    }

    @objc private func toggleLoginItemAction() {
        do {
            try loginItem.setEnabled(!loginItem.isEnabled)
        } catch {
            log.write("無法變更開機自啟：\(error)")
            presentInfo(
                title: L10n.text(.menuLaunchAtLogin),
                body: "\(error)",
                primary: nil,
                secondary: nil
            )
        }
        refreshMenu()
    }

    @objc private func quitAction() {
        NSApp.terminate(nil)
    }

    // MARK: - 視窗

    private func presentUnavailable() {
        if infoWindow == nil {
            infoWindow = InfoWindowController()
        }
        infoWindow?.present(
            title: L10n.text(.unavailableTitle),
            body: L10n.text(.unavailableBody),
            primaryTitle: L10n.text(.unavailableChooseFolder),
            primaryAction: { [weak self] in self?.chooseFolder() },
            secondaryTitle: L10n.text(.unavailableRetry),
            secondaryAction: { [weak self] in self?.refreshFolder(startService: true) }
        )
    }

    private func hideUnavailable() {
        infoWindow?.close()
        infoWindow = nil
    }

    private func presentInfo(title: String, body: String, primary: String?, secondary: String?) {
        if infoWindow == nil {
            infoWindow = InfoWindowController()
        }
        infoWindow?.present(
            title: title,
            body: body,
            primaryTitle: primary,
            primaryAction: nil,
            secondaryTitle: secondary,
            secondaryAction: nil
        )
    }

    // MARK: - 結束

    func beginTermination(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateLater }
        let phase = supervisor?.snapshot.phase
        guard phase == .running || phase == .paused || phase == .starting else {
            return .terminateNow
        }
        terminating = true
        let supervisor = self.supervisor
        Task { @MainActor in
            if let supervisor {
                let outcome = await supervisor.shutdown(reason: .shellExit)
                self.log.write(
                    "App 結束：cleanShutdown=\(outcome.cleanShutdown.map(String.init) ?? "nil")、強制結束=\(outcome.forcedTermination)"
                )
            }
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func forceStopForTermination() {
        supervisor?.stopImmediately()
        log.write("App 結束（同步收尾）")
    }
}

/// 依協定建立客戶端資訊。instanceId 每次啟動不同即可，M0 用隨機值。
enum ClientInfoFactory {
    static func make() -> ClientInfo {
        ClientInfo(
            name: "Cardiary macOS",
            version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0",
            platform: .macos,
            instanceId: "inst_\(UUID().uuidString.prefix(8))"
        )
    }
}
