import Foundation

/// 啟動服務所需的資訊。Token 不在這裡：它只經 stdin 的 `init` 傳遞。
public struct ServiceLaunchPlan: Equatable, Sendable {
    public var executableURL: URL
    public var arguments: [String]
    public var environment: [String: String]
    public var workingDirectory: URL?

    public init(
        executableURL: URL,
        arguments: [String],
        environment: [String: String],
        workingDirectory: URL? = nil
    ) {
        self.executableURL = executableURL
        self.arguments = arguments
        self.environment = environment
        self.workingDirectory = workingDirectory
    }

    /// 依設計組出啟動參數與環境變數。
    ///
    /// - `TMPDIR`／`TMP`／`TEMP` 指到 `<folder>/tmp`。
    /// - `HOME` 與 `PATH` 明確指定，不繼承殼的環境。
    /// - `arguments` 只有 Node 的旗標與服務腳本路徑；Token 不進 argv。
    ///
    /// `initializeFolder` 會加上 `--initialize-folder`：空的資料夾由服務建立
    /// `state/folder.json` 與三個資料庫；已有身分的資料夾不受影響。
    public static func make(
        nodeURL: URL,
        scriptURL: URL,
        folderPath: String,
        initializeFolder: Bool = false,
        homeDirectory: String = NSHomeDirectory()
    ) -> ServiceLaunchPlan {
        let tmp = URL(fileURLWithPath: folderPath, isDirectory: true)
            .appendingPathComponent("tmp", isDirectory: true)
            .path
        return ServiceLaunchPlan(
            executableURL: nodeURL,
            arguments: ["--disable-warning=ExperimentalWarning", scriptURL.path]
                + (initializeFolder ? ["--initialize-folder"] : []),
            environment: [
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "HOME": homeDirectory,
                "TMPDIR": tmp,
                "TMP": tmp,
                "TEMP": tmp,
                "CARDIARY_SHELL": "1",
            ],
            workingDirectory: URL(fileURLWithPath: folderPath, isDirectory: true)
        )
    }
}

/// 服務行程結束的原因。
public struct ServiceExit: Equatable, Sendable {
    public let status: Int32
    public let wasSignaled: Bool

    public init(status: Int32, wasSignaled: Bool) {
        self.status = status
        self.wasSignaled = wasSignaled
    }

    public var description: String {
        wasSignaled ? "signal \(status)" : "exit \(status)"
    }

    /// 被 SIGBUS 殺掉（強制卸載）時的退出碼。
    public var isBusError: Bool {
        wasSignaled && status == SIGBUS
    }
}

/// 殼監管的一個服務行程。正式實作包住 `Process`，測試用替身。
public protocol ServiceProcessHandle: AnyObject, Sendable {
    var pid: Int32 { get }
    var isRunning: Bool { get }

    func setDataHandler(_ handler: @escaping @Sendable (Data) -> Void)
    func setLogHandler(_ handler: @escaping @Sendable (String) -> Void)
    func setExitHandler(_ handler: @escaping @Sendable (ServiceExit) -> Void)

    /// 寫入 stdin。通道已關閉時丟錯。
    func write(_ data: Data) throws
    func closeStdin()
    func terminate()
    func kill()
}

public enum ServiceLaunchError: Error, Equatable, Sendable {
    case notRunning
    case stdinClosed
    case writeFailed(Int32)
    case spawnFailed(String)
}

/// 用 Foundation 的 `Process` 啟動服務，stdin／stdout 是匿名 pipe。
///
/// 不傳任何額外的檔案描述子；`standardInput`、`standardOutput` 與
/// `standardError` 都是新建立的 pipe。
public final class ProcessServiceHandle: ServiceProcessHandle, @unchecked Sendable {
    private let process: Process
    private let stdinPipe: Pipe
    private let stdoutPipe: Pipe
    private let stderrPipe: Pipe
    private let lock = NSLock()
    private var dataHandler: (@Sendable (Data) -> Void)?
    private var logHandler: (@Sendable (String) -> Void)?
    private var exitHandler: (@Sendable (ServiceExit) -> Void)?
    private var stdinOpen = true
    private var stderrBuffer = Data()

    public init(plan: ServiceLaunchPlan) throws {
        process = Process()
        process.executableURL = plan.executableURL
        process.arguments = plan.arguments
        process.environment = plan.environment
        process.currentDirectoryURL = plan.workingDirectory
        stdinPipe = Pipe()
        stdoutPipe = Pipe()
        stderrPipe = Pipe()
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        do {
            try process.run()
        } catch {
            throw ServiceLaunchError.spawnFailed("\(error)")
        }

        process.terminationHandler = { [weak self] finished in
            let exit = ServiceExit(
                status: finished.terminationStatus,
                wasSignaled: finished.terminationReason == .uncaughtSignal
            )
            self?.exitHandler?(exit)
        }

        // 用阻塞的 read(2) 而不是 readabilityHandler：不需要 run loop，行為固定。
        startReading(fd: stdoutPipe.fileHandleForReading.fileDescriptor) { [weak self] data in
            self?.dataHandler?(data)
        }
        startReading(fd: stderrPipe.fileHandleForReading.fileDescriptor) { [weak self] data in
            self?.consumeStderr(data)
        }
    }

    private func startReading(fd: Int32, onData: @escaping @Sendable (Data) -> Void) {
        let queue = DispatchQueue(label: "com.cardiary.shell.service-read.\\(fd)")
        queue.async {
            var buffer = [UInt8](repeating: 0, count: 65_536)
            while true {
                let count = buffer.withUnsafeMutableBytes { pointer in
                    read(fd, pointer.baseAddress, pointer.count)
                }
                if count > 0 {
                    onData(Data(buffer[0..<count]))
                } else if count == 0 {
                    return
                } else if errno == EINTR {
                    continue
                } else {
                    return
                }
            }
        }
    }

    public var pid: Int32 { process.processIdentifier }
    public var isRunning: Bool { process.isRunning }

    public func setDataHandler(_ handler: @escaping @Sendable (Data) -> Void) {
        lock.lock()
        dataHandler = handler
        lock.unlock()
    }

    public func setLogHandler(_ handler: @escaping @Sendable (String) -> Void) {
        lock.lock()
        logHandler = handler
        lock.unlock()
    }

    public func setExitHandler(_ handler: @escaping @Sendable (ServiceExit) -> Void) {
        lock.lock()
        exitHandler = handler
        lock.unlock()
    }

    public func write(_ data: Data) throws {
        lock.lock()
        guard stdinOpen else {
            lock.unlock()
            throw ServiceLaunchError.stdinClosed
        }
        let fd = stdinPipe.fileHandleForWriting.fileDescriptor
        lock.unlock()

        try data.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) in
            guard let base = buffer.baseAddress else { return }
            var offset = 0
            while offset < buffer.count {
                let written = Foundation.write(fd, base.advanced(by: offset), buffer.count - offset)
                if written < 0 {
                    if errno == EINTR { continue }
                    throw ServiceLaunchError.writeFailed(errno)
                }
                offset += written
            }
        }
    }

    public func closeStdin() {
        lock.lock()
        let alreadyClosed = !stdinOpen
        stdinOpen = false
        lock.unlock()
        guard !alreadyClosed else { return }
        // 關閉寫端，服務會看到 stdin 的 EOF（租約結束）。
        try? stdinPipe.fileHandleForWriting.close()
    }

    public func terminate() {
        guard process.isRunning else { return }
        Darwin.kill(process.processIdentifier, SIGTERM)
    }

    public func kill() {
        guard process.isRunning else { return }
        Darwin.kill(process.processIdentifier, SIGKILL)
    }

    private func consumeStderr(_ data: Data) {
        lock.lock()
        stderrBuffer.append(data)
        var lines: [String] = []
        while let newline = stderrBuffer.firstIndex(of: 0x0A) {
            let line = stderrBuffer.subdata(in: stderrBuffer.startIndex..<newline)
            if let text = String(data: line, encoding: .utf8), !text.isEmpty {
                lines.append(text)
            }
            stderrBuffer.removeSubrange(stderrBuffer.startIndex...newline)
        }
        let handler = logHandler
        lock.unlock()
        for line in lines {
            handler?(line)
        }
    }
}
