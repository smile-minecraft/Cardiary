import Foundation

/// 服務監管的狀態。名稱與 `docs/design/shell-control.md` 一致。
public enum ServicePhase: String, Equatable, Sendable {
    case idle
    case starting
    case running
    case paused
    case unavailable
    case failed
    case stopping
    case stopped

    /// 選單列顯示用的在地化字串鍵。
    public var localizationKey: L10n.Key {
        switch self {
        case .idle: return .serviceIdle
        case .starting: return .serviceStarting
        case .running: return .serviceRunning
        case .paused: return .servicePaused
        case .unavailable: return .serviceUnavailable
        case .failed: return .serviceFailed
        case .stopping: return .serviceStopping
        case .stopped: return .serviceStopped
        }
    }
}

public struct ServiceStatusSnapshot: Equatable, Sendable {
    public var phase: ServicePhase = .idle
    public var pid: Int32 = 0
    public var epoch: String?
    public var folderId: String?
    public var clientPort: UInt16?
    public var restarts: Int = 0
    public var consecutiveFailures: Int = 0
    public var lastExit: String?
    public var lastError: String?
    /// `control.health` 回報的 lifecycle；`idle` 以外代表服務正在做生命週期工作。
    public var lifecycle: String = "idle"
    /// 服務送了 `notify.maintenance` 且還沒送 `idle`。
    public var maintenanceInProgress: Bool = false

    public init() {}
}

public enum ShutdownReason: String, Sendable {
    case user
    case shellExit = "shell_exit"
    case restart
}

public enum LifecycleOutcome: Equatable, Sendable {
    case completed
    case alreadyInState
    case busy
    case unavailable
    case failed(String)
}

public struct ShutdownOutcome: Equatable, Sendable {
    /// 服務回報的 `cleanShutdown`。`nil` 代表沒有送出或沒有收到回應；資料庫才是唯一權威。
    public var cleanShutdown: Bool?
    public var reason: String?
    public var forcedTermination: Bool

    public init(cleanShutdown: Bool? = nil, reason: String? = nil, forcedTermination: Bool = false) {
        self.cleanShutdown = cleanShutdown
        self.reason = reason
        self.forcedTermination = forcedTermination
    }

    /// 另一個生命週期操作正在進行；呼叫端要保留 supervisor 並稍後重試。
    public var isBusy: Bool { reason == "busy" }
}

public struct FolderSnapshot: Equatable, Sendable {
    public var state: FolderAvailabilityState
    public var path: String?
    public var displayName: String?
    public var volumeUUID: String?
    public var writable: Bool

    public init(
        state: FolderAvailabilityState = .unselected,
        path: String? = nil,
        displayName: String? = nil,
        volumeUUID: String? = nil,
        writable: Bool = false
    ) {
        self.state = state
        self.path = path
        self.displayName = displayName
        self.volumeUUID = volumeUUID
        self.writable = writable
    }

    /// 服務只在資料夾可用時啟動。
    public var isUsable: Bool {
        state == .ready && path != nil && writable
    }

    public static let unselected = FolderSnapshot()
}

public struct ServiceSupervisorConfiguration: Sendable {
    public var launchPlan: ServiceLaunchPlan
    public var channelLimits: ControlChannel.Limits
    public var healthInterval: TimeInterval
    public var healthTimeout: TimeInterval
    public var healthFailureThreshold: Int
    public var pauseTimeout: TimeInterval
    public var resumeTimeout: TimeInterval
    public var shutdownTimeout: TimeInterval
    public var terminateGrace: TimeInterval
    public var restartPolicy: RestartPolicy

    public init(
        launchPlan: ServiceLaunchPlan,
        channelLimits: ControlChannel.Limits = .default,
        healthInterval: TimeInterval = 1,
        healthTimeout: TimeInterval = 2,
        healthFailureThreshold: Int = 3,
        pauseTimeout: TimeInterval = 10,
        resumeTimeout: TimeInterval = 30,
        shutdownTimeout: TimeInterval = 10,
        terminateGrace: TimeInterval = 2,
        restartPolicy: RestartPolicy = .default
    ) {
        self.launchPlan = launchPlan
        self.channelLimits = channelLimits
        self.healthInterval = healthInterval
        self.healthTimeout = healthTimeout
        self.healthFailureThreshold = healthFailureThreshold
        self.pauseTimeout = pauseTimeout
        self.resumeTimeout = resumeTimeout
        self.shutdownTimeout = shutdownTimeout
        self.terminateGrace = terminateGrace
        self.restartPolicy = restartPolicy
    }
}

/// 啟動並監管主機服務。
///
/// 生命週期請求（pause／resume／shutdown）共用一個槽位：第二個在途請求直接回
/// `busy`，不排隊。生命週期在途或服務回報 maintenance 時，健康檢查暫停計次，
/// 慢速的 pause／resume／刪除不會被誤判成卡住。
public final class ServiceSupervisor: @unchecked Sendable {
    public typealias Launcher = @Sendable (ServiceLaunchPlan) throws -> any ServiceProcessHandle

    private let configuration: ServiceSupervisorConfiguration
    private let launcher: Launcher
    private let brokerHandler: @Sendable (String, JSONValue) -> BrokerReply
    private let queue = DispatchQueue(label: "com.cardiary.shell.service-supervisor")

    private var status = ServiceStatusSnapshot()
    private var folder: FolderSnapshot
    /// 使用者當初授權時記錄的磁碟 UUID。paused 關閉前要用它比對目前路徑。
    private var recordedVolumeUUID: String?
    private var handle: (any ServiceProcessHandle)?
    private var channel: ControlChannel?
    private var controlToken = ControlToken(value: "")
    private var brokerToken = ControlToken(value: "")
    /// 殼簽發給客戶端協定的 Token；只在記憶體，隨每次啟動換新。
    private var clientToken = ControlToken(value: "")
    private var generation = 0
    private var lifecycleInFlight = false
    private var intentionalStop = false
    private var launchStartedAt: Date?
    private var healthTask: Task<Void, Never>?

    public var onStatusChange: (@Sendable (ServiceStatusSnapshot) -> Void)?
    public var onLog: (@Sendable (String) -> Void)?
    /// 服務就緒後拿到客戶端 Token；殼用它建立客戶端連線，不寫進日誌或磁碟。
    public var onClientToken: (@Sendable (String) -> Void)?

    public init(
        configuration: ServiceSupervisorConfiguration,
        folder: FolderSnapshot = .unselected,
        brokerHandler: @escaping @Sendable (String, JSONValue) -> BrokerReply,
        launcher: @escaping Launcher = { try ProcessServiceHandle(plan: $0) }
    ) {
        self.configuration = configuration
        self.folder = folder
        self.brokerHandler = brokerHandler
        self.launcher = launcher
    }

    public var snapshot: ServiceStatusSnapshot {
        queue.sync { status }
    }

    public var folderSnapshot: FolderSnapshot {
        get { queue.sync { folder } }
        set { updateFolder(newValue) }
    }

    /// 每次啟動使用的控制 Token。測試用來確認 Token 不在 argv／環境變數。
    public var currentControlToken: ControlToken {
        queue.sync { controlToken }
    }

    public var currentBrokerToken: ControlToken {
        queue.sync { brokerToken }
    }

    /// 殼記錄的磁碟 UUID（`folder-authorization.json` 的值）。只讀，不改資料夾狀態。
    public var authorizedVolumeUUID: String? {
        get { queue.sync { recordedVolumeUUID } }
        set { queue.sync { recordedVolumeUUID = newValue } }
    }

    // MARK: - 啟動

    /// 資料夾可用時啟動服務；不可用時只更新狀態，不 spawn。
    public func start(folder newFolder: FolderSnapshot) async {
        updateFolder(newFolder)
        guard newFolder.isUsable else {
            log("資料夾不可用，不啟動服務。")
            setPhase(.unavailable)
            return
        }

        let alreadyActive = queue.sync {
            status.phase == .running || status.phase == .starting || status.phase == .paused
        }
        guard !alreadyActive else { return }

        queue.sync {
            intentionalStop = false
            status.consecutiveFailures = 0
        }
        launch(isRestart: false)
        startHealthLoop()
    }

    /// 只有資料夾仍可用、而且**沒有**執行中的行程時才重新啟動。
    ///
    /// `paused` 一律走 `resume`：pause 之後行程還在，若這裡再 launch 就會同時有兩個
    /// 服務碰同一個資料夾。只有 `unavailable`／`failed`／`stopped`／`idle` 且沒有
    /// handle 時才啟動新行程。
    public func restartIfFolderUsable() async {
        enum Decision {
            case launch
            case skipNoFolder
            case skipAlreadyRunning
            case skipPaused
        }

        let decision = queue.sync { () -> Decision in
            guard folder.isUsable else { return .skipNoFolder }
            if status.phase == .paused { return .skipPaused }
            guard handle == nil else { return .skipAlreadyRunning }
            switch status.phase {
            case .unavailable, .failed, .stopped, .idle:
                return .launch
            case .running, .starting, .paused, .stopping:
                return .skipAlreadyRunning
            }
        }

        switch decision {
        case .skipNoFolder:
            setPhase(.unavailable)
        case .skipPaused:
            log("服務已暫停；接回時走 control.resume，不重新啟動")
        case .skipAlreadyRunning:
            break
        case .launch:
            launch(isRestart: true)
            startHealthLoop()
        }
    }

    private func updateFolder(_ newFolder: FolderSnapshot) {
        queue.sync { folder = newFolder }
    }

    private func launch(isRestart: Bool) {
        let tokens = (ControlToken.generate(), ControlToken.generate(), ControlToken.generate())
        var launchGeneration = 0
        var plan = configuration.launchPlan
        var previous: (any ServiceProcessHandle, ControlChannel?)? = nil
        let currentFolder = queue.sync { () -> FolderSnapshot in
            // 先收掉舊的行程與通道，避免兩個服務同時碰同一個資料夾。
            if let old = handle {
                previous = (old, channel)
                handle = nil
                channel = nil
                status.pid = 0
            }
            generation += 1
            launchGeneration = generation
            controlToken = tokens.0
            brokerToken = tokens.1
            clientToken = tokens.2
            if isRestart { status.restarts += 1 }
            status.phase = .starting
            status.lastError = nil
            status.maintenanceInProgress = false
            status.lifecycle = "idle"
            launchStartedAt = Date()
            return folder
        }

        if let (oldProcess, oldChannel) = previous {
            log("終止先前的服務 pid=\(oldProcess.pid) 後才啟動新行程")
            oldChannel?.invalidate(reason: .closed)
            oldProcess.terminate()
            let deadline = Date().addingTimeInterval(0.5)
            while oldProcess.isRunning && Date() < deadline {
                usleep(20_000)
            }
            if oldProcess.isRunning {
                oldProcess.kill()
                usleep(50_000)
            }
        }

        guard let path = currentFolder.path else {
            setPhase(.unavailable)
            return
        }

        if let temporary = plan.environment["TMPDIR"], !temporary.isEmpty {
            // 由殼明確指定，不繼承殼的暫存目錄。
        } else {
            plan.environment["TMPDIR"] = URL(fileURLWithPath: path).appendingPathComponent("tmp").path
        }

        let process: any ServiceProcessHandle
        do {
            process = try launcher(plan)
        } catch {
            log("無法啟動服務：\(error)")
            queue.sync {
                status.phase = .failed
                status.lastError = "\(error)"
            }
            publishStatus()
            return
        }

        let channel = ControlChannel(
            transport: process,
            controlToken: tokens.0,
            brokerToken: tokens.1,
            clientToken: tokens.2,
            limits: configuration.channelLimits
        )
        channel.brokerHandler = brokerHandler
        channel.onLog = { [weak self] message in self?.log(message) }
        channel.onNotification = { [weak self] notification in
            self?.handleNotification(notification)
        }
        channel.onClosed = { [weak self] error in
            self?.log("控制通道結束：\(error.description)")
        }

        process.setLogHandler { [weak self] line in
            self?.log("service stderr：\(line)")
        }
        process.setExitHandler { [weak self] exit in
            self?.handleExit(exit, generation: launchGeneration)
        }

        queue.sync {
            self.handle = process
            self.channel = channel
            status.pid = process.pid
            status.epoch = nil
            status.folderId = nil
            status.clientPort = nil
        }
        publishStatus()
        log("啟動服務 pid=\(process.pid)（第 \(status.restarts + 1) 次）")

        Task { [weak self] in
            guard let self else { return }
            do {
                let ready = try await channel.handshake(folderPath: path)
                let stillCurrent = self.queue.sync { self.generation == launchGeneration }
                guard stillCurrent else { return }
                self.queue.sync {
                    self.status.phase = .running
                    self.status.epoch = ready.epoch
                    self.status.folderId = ready.folderId
                    // 0 代表這個服務沒有客戶端協定（例如開發用的替身）。
                self.status.clientPort = ready.clientPort == 0 ? nil : ready.clientPort
                }
                self.publishStatus()
                self.log(
                    "服務就緒：epoch \(ready.epoch)、clientPort \(ready.clientPort)、folderId \(ready.folderId)"
                )
                // 舊版服務沒有 clientToken 欄位；用殼送出的那一把。
                let issued = self.queue.sync { self.clientToken }
                self.onClientToken?(ready.clientToken ?? issued.value)
            } catch let error as ControlChannel.ChannelError {
                if case .unsupportedProtocol(let version) = error {
                    self.log("服務的協定版本 \(version) 與殼不符，停止重啟")
                    self.queue.sync {
                        self.intentionalStop = true
                        if self.generation == launchGeneration {
                            self.status.phase = .failed
                            self.status.lastError = "version_mismatch:\(version)"
                        }
                    }
                    self.publishStatus()
                    process.terminate()
                    self.queue.asyncAfter(deadline: .now() + self.configuration.terminateGrace, execute: {
                        if process.isRunning { process.kill() }
                    })
                    return
                }
                self.log("服務交握失敗：\(error)")
                self.queue.sync {
                    if self.generation == launchGeneration {
                        self.status.lastError = "\(error)"
                    }
                }
                process.terminate()
                self.queue.asyncAfter(deadline: .now() + self.configuration.terminateGrace, execute: {
                    if process.isRunning { process.kill() }
                })
            }
        }
    }

    // MARK: - 健康檢查

    private func startHealthLoop() {
        guard healthTask == nil else { return }
        healthTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(self.configuration.healthInterval))
                if Task.isCancelled { return }
                await self.healthTick()
            }
        }
    }

    private func healthTick() async {
        let snapshot = queue.sync { () -> (ServicePhase, Bool, Bool, ControlChannel?) in
            (status.phase, lifecycleInFlight, status.maintenanceInProgress, channel)
        }
        let (phase, lifecycleBusy, maintenance, channel) = snapshot
        guard phase == .running || phase == .paused else { return }
        guard !lifecycleBusy, !maintenance, let channel else { return }

        do {
            let payload = try await channel.request(
                route: ControlRoute.health,
                timeout: configuration.healthTimeout
            )
            let lifecycle = payload["lifecycle"]?.stringValue ?? "idle"
            queue.sync {
                status.lifecycle = lifecycle
                if lifecycle == "idle" {
                    status.consecutiveFailures = 0
                }
            }
            publishStatus()
        } catch let error as ControlChannel.ChannelError {
            switch error {
            case .busy, .timeout:
                if case .timeout = error {
                    registerHealthFailure(reason: "健康檢查逾時")
                }
            case .responseError(let payload):
                // `busy`、`unavailable` 與資料庫短暫鎖住的回應不算失敗。
                if payload.code != .busy && payload.code != .unavailable {
                    registerHealthFailure(reason: "健康檢查失敗：\(payload.code.rawValue)")
                }
            case .closed, .protocolViolation, .writeFailed:
                registerHealthFailure(reason: "控制通道失效")
            case .unsupportedRoute, .unsupportedProtocol:
                break
            }
        } catch {
            registerHealthFailure(reason: "健康檢查失敗")
        }
    }

    private func registerHealthFailure(reason: String) {
        let failures = queue.sync { () -> Int in
            status.consecutiveFailures += 1
            return status.consecutiveFailures
        }
        log("\(reason)（連續 \(failures) 次）")
        publishStatus()
        guard failures >= configuration.healthFailureThreshold else { return }
        log("健康檢查連續失敗 \(failures) 次，視為卡住並重啟服務")
        guard let process = queue.sync(execute: { handle }) else { return }
        process.terminate()
        queue.asyncAfter(deadline: .now() + configuration.terminateGrace, execute: {
            if process.isRunning {
                process.kill()
            }
        })
    }

    // MARK: - 結束與重啟

    private func handleExit(_ exit: ServiceExit, generation launchGeneration: Int) {
        let decision = queue.sync { () -> (Bool, FolderSnapshot, Int, TimeInterval, Bool) in
            guard launchGeneration == generation else {
                return (false, folder, status.consecutiveFailures, 0, false)
            }
            let wasIntentional = intentionalStop || status.phase == .stopping || status.phase == .stopped
            guard let launchStartedAt else {
                return (wasIntentional, folder, status.consecutiveFailures, 0, true)
            }
            let uptime = Date().timeIntervalSince(launchStartedAt)
            if configuration.restartPolicy.resetsFailures(uptime: uptime) {
                status.consecutiveFailures = 0
            }
            if !wasIntentional {
                status.consecutiveFailures += 1
            }
            status.pid = 0
            status.lastExit = exit.description
            status.clientPort = nil
            status.maintenanceInProgress = false
            status.lifecycle = "idle"
            handle = nil
            channel?.invalidate(reason: .closed)
            channel = nil
            return (wasIntentional, folder, status.consecutiveFailures, 0, true)
        }

        let (wasIntentional, currentFolder, failures, _, current) = decision
        guard current else { return }

        log("服務結束（\(exit.description)）")

        if wasIntentional {
            queue.sync { status.phase = .stopped }
            publishStatus()
            return
        }

        guard configuration.restartPolicy.shouldRestart(consecutiveFailures: failures) else {
            log("連續失敗 \(failures) 次，停止重啟")
            setPhase(.failed)
            return
        }

        guard currentFolder.isUsable else {
            log("資料夾不可用，不重啟服務")
            setPhase(.unavailable)
            return
        }

        let delay = configuration.restartPolicy.delay(afterFailure: failures)
        log("\(String(format: "%.2f", delay)) 秒後重啟服務")
        queue.sync { status.phase = .starting }
        publishStatus()
        // 用全域佇列排程：`launch` 內部會 `queue.sync`，不能從自己的佇列再同步進入。
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self else { return }
            let stillWanted = self.queue.sync {
                self.status.phase == .starting && self.handle == nil && !self.intentionalStop
            }
            guard stillWanted else { return }
            self.launch(isRestart: true)
        }
    }

    // MARK: - 生命週期

    private func beginLifecycle() -> Bool {
        queue.sync {
            guard !lifecycleInFlight else { return false }
            lifecycleInFlight = true
            return true
        }
    }

    private func endLifecycle() {
        queue.sync { lifecycleInFlight = false }
    }

    /// 硬碟即將卸載：先送 `control.pause`。逾時就 SIGTERM／SIGKILL。
    public func pause(reason: String) async -> LifecycleOutcome {
        guard beginLifecycle() else { return .busy }
        defer { endLifecycle() }

        let snapshot = queue.sync { (status.phase, channel) }
        if snapshot.0 == .paused { return .alreadyInState }
        guard snapshot.0 == .running, let channel = snapshot.1 else { return .unavailable }

        do {
            _ = try await channel.request(
                route: ControlRoute.pause,
                payload: .object([
                    "reason": .string(reason),
                    "deadlineMs": .number(5_000),
                ]),
                timeout: configuration.pauseTimeout
            )
            queue.sync {
                status.phase = .paused
                status.lifecycle = "idle"
            }
            publishStatus()
            log("服務已暫停（\(reason)）")
            return .completed
        } catch {
            log("暫停失敗：\(error)")
            await terminateAndWait()
            setPhase(.unavailable)
            return .failed("\(error)")
        }
    }

    /// 磁碟接回後續跑。epoch 不變；殼不用自己的判斷改 epoch。
    public func resume(volumeUUID: String?) async -> LifecycleOutcome {
        guard beginLifecycle() else { return .busy }
        defer { endLifecycle() }

        let snapshot = queue.sync { (status.phase, channel, folder) }
        if snapshot.0 == .running { return .alreadyInState }
        guard snapshot.0 == .paused, let channel = snapshot.1 else { return .unavailable }
        guard let path = snapshot.2.path else { return .unavailable }

        do {
            var payload: [String: JSONValue] = ["folder": .object(["path": .string(path)])]
            if let volumeUUID {
                payload["volumeUUID"] = .string(volumeUUID)
            }
            let response = try await channel.request(
                route: ControlRoute.resume,
                payload: .object(payload),
                timeout: configuration.resumeTimeout
            )
            let state = response["state"]?.stringValue ?? "ready"
            let epoch = response["epoch"]?.stringValue
            let reason = response["reason"]?.stringValue
            queue.sync {
                status.epoch = epoch ?? status.epoch
                status.lifecycle = "idle"
                if state == "ready" {
                    status.phase = .running
                } else {
                    status.phase = .unavailable
                    status.lastError = reason ?? state
                }
            }
            publishStatus()
            if state == "ready" {
                log("服務已恢復（epoch \(epoch ?? "?")）")
                return .completed
            }
            log("恢復後狀態是 \(state)（\(reason ?? "沒有原因")）")
            return .failed(reason ?? state)
        } catch {
            log("恢復失敗：\(error)")
            // 舊行程已經不可用：先收掉，接回時由殼重新啟動，避免留下未監管的行程。
            await terminateAndWait()
            setPhase(.unavailable)
            return .failed("\(error)")
        }
    }

    /// 正常關閉：先送 `control.shutdown`，收到回應（或逾時）才關 stdin。
    public func shutdown(reason: ShutdownReason) async -> ShutdownOutcome {
        guard beginLifecycle() else { return ShutdownOutcome(reason: "busy") }
        defer { endLifecycle() }

        let snapshot = queue.sync { (status.phase, channel, handle, folder) }
        guard let process = snapshot.2 else {
            setPhase(.stopped)
            return ShutdownOutcome(reason: "not_running")
        }

        queue.sync {
            intentionalStop = true
            status.phase = .stopping
        }
        publishStatus()

        var cleanShutdown: Bool?
        var serviceReason: String?
        var forced = false

        // paused 代表資料庫已關閉。送 shutdown 之前要用殼記錄的磁碟 UUID 比對目前
        // 路徑；同一條路徑換了另一顆磁碟時，服務可能對著別人的資料夾寫 1。
        let authorizedUUID = queue.sync { recordedVolumeUUID }
        let volumeMatches = authorizedUUID == nil
            || snapshot.3.volumeUUID == nil
            || authorizedUUID == snapshot.3.volumeUUID

        if snapshot.0 == .paused, !volumeMatches {
            log(
                "暫停中但磁碟 UUID 不符（記錄 \(authorizedUUID ?? "nil")、目前 \(snapshot.3.volumeUUID ?? "nil")），跳過 control.shutdown"
            )
            forced = true
        } else if let channel = snapshot.1, snapshot.0 == .running || snapshot.0 == .paused {
            var payload: [String: JSONValue] = ["reason": .string(reason.rawValue)]
            if let volumeUUID = snapshot.3.volumeUUID {
                payload["volumeUUID"] = .string(volumeUUID)
            }
            do {
                let response = try await channel.request(
                    route: ControlRoute.shutdown,
                    payload: .object(payload),
                    timeout: configuration.shutdownTimeout
                )
                cleanShutdown = response["cleanShutdown"]?.boolValue
                serviceReason = response["reason"]?.stringValue
                log("服務回報關閉：cleanShutdown=\(cleanShutdown.map(String.init) ?? "nil")")
            } catch {
                log("關閉請求失敗：\(error)")
                forced = true
            }
        }

        // 收到回應（或已逾時）之後才關閉 stdin；順序顛倒會讓服務走「未經確認的關閉」。
        process.closeStdin()
        if !(await awaitExit(process, timeout: configuration.terminateGrace)) {
            forced = true
            process.terminate()
            if !(await awaitExit(process, timeout: configuration.terminateGrace)) {
                process.kill()
                _ = await awaitExit(process, timeout: 1)
            }
        }

        queue.sync {
            handle = nil
            channel?.invalidate(reason: .closed)
            channel = nil
            status.pid = 0
            status.clientPort = nil
            status.phase = .stopped
            status.lifecycle = "idle"
            status.maintenanceInProgress = false
        }
        publishStatus()
        log("服務已停止（執行過強制結束：\(forced)）")
        return ShutdownOutcome(
            cleanShutdown: cleanShutdown,
            reason: serviceReason,
            forcedTermination: forced
        )
    }

    /// 生命週期忙碌時重試關閉。
    ///
    /// 慢速的 pause／resume 在途時，`shutdown` 會回 `busy`；呼叫端不能因此把
    /// supervisor 丟掉，要等第一個操作結束再重試。重試用完仍忙碌時回最後一次的結果。
    public func shutdownRetryingWhileBusy(
        reason: ShutdownReason,
        attempts: Int = 8,
        delay: Duration = .milliseconds(250)
    ) async -> ShutdownOutcome {
        var outcome = ShutdownOutcome(reason: "busy")
        for attempt in 1...max(1, attempts) {
            outcome = await shutdown(reason: reason)
            if !outcome.isBusy { return outcome }
            if attempt < attempts {
                try? await Task.sleep(for: delay)
            }
        }
        return outcome
    }

    /// App 結束時的同步備援：不等請求，直接收掉行程。
    public func stopImmediately() {
        queue.sync {
            intentionalStop = true
            status.phase = .stopping
        }
        guard let process = queue.sync(execute: { handle }) else { return }
        process.closeStdin()
        process.terminate()
        let deadline = Date().addingTimeInterval(configuration.terminateGrace)
        while process.isRunning && Date() < deadline {
            usleep(50_000)
        }
        if process.isRunning {
            process.kill()
        }
        queue.sync {
            handle = nil
            channel?.invalidate(reason: .closed)
            channel = nil
            status.pid = 0
            status.phase = .stopped
        }
        publishStatus()
    }

    private func terminateAndWait() async {
        guard let process = queue.sync(execute: { handle }) else { return }
        process.terminate()
        if !(await awaitExit(process, timeout: configuration.terminateGrace)) {
            process.kill()
            _ = await awaitExit(process, timeout: 1)
        }
    }

    private func awaitExit(_ process: any ServiceProcessHandle, timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !process.isRunning { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return !process.isRunning
    }

    // MARK: - 通知

    private func handleNotification(_ notification: ControlNotification) {
        switch notification {
        case .fatal(let reason, let detail):
            // 只記錄原因與相對路徑，payload 其他內容不進日誌。
            log("服務回報致命錯誤：\(reason)\(detail.map { "（\($0)）" } ?? "")")
            queue.sync { status.lastError = "fatal:\(reason)" }
            publishStatus()
        case .maintenance(let lifecycle, _):
            queue.sync {
                status.maintenanceInProgress = lifecycle != "idle"
                status.lifecycle = lifecycle
            }
            log("服務進入維護狀態：\(lifecycle)")
            publishStatus()
        }
    }

    // MARK: - 狀態

    private func setPhase(_ phase: ServicePhase) {
        queue.sync { status.phase = phase }
        publishStatus()
    }

    private func publishStatus() {
        let snapshot = queue.sync { status }
        onStatusChange?(snapshot)
    }

    private func log(_ message: String) {
        onLog?(message)
    }
}
