import Foundation

// 測試用的主機服務替身：實作 `docs/design/shell-control.md` 的服務端。
//
// 只用來驗證殼端的控制面行為；不會打進 App bundle，也不是產品程式。
// 環境變數（全部選用）：
//   CARDIARY_DOUBLE_PAUSE_MS           pause 回應前的延遲
//   CARDIARY_DOUBLE_RESUME_MS          resume 回應前的延遲
//   CARDIARY_DOUBLE_CLEAN_SHUTDOWN     shutdown 回報的 cleanShutdown（1／0）
//   CARDIARY_DOUBLE_MAINTENANCE_MS     啟動後送 deleting，過多久送 idle（0 = 不送）
//   CARDIARY_DOUBLE_FAIL_PROTOCOL      設成 1 時 ready 回報 protocol 2

let environment = ProcessInfo.processInfo.environment
let pauseDelay = milliseconds(environment["CARDIARY_DOUBLE_PAUSE_MS"])
let resumeDelay = milliseconds(environment["CARDIARY_DOUBLE_RESUME_MS"])
let cleanShutdown = (environment["CARDIARY_DOUBLE_CLEAN_SHUTDOWN"] ?? "1") == "1"
let maintenanceMilliseconds = milliseconds(environment["CARDIARY_DOUBLE_MAINTENANCE_MS"])
let failProtocol = (environment["CARDIARY_DOUBLE_FAIL_PROTOCOL"] ?? "0") == "1"
let badHelloToken = (environment["CARDIARY_DOUBLE_BAD_HELLO_TOKEN"] ?? "0") == "1"
let badHelloPid = (environment["CARDIARY_DOUBLE_BAD_HELLO_PID"] ?? "0") == "1"
let badReply = (environment["CARDIARY_DOUBLE_BAD_REPLY"] ?? "0") == "1"
let oversizeFrame = (environment["CARDIARY_DOUBLE_OVERSIZE"] ?? "0") == "1"
let sendFatal = (environment["CARDIARY_DOUBLE_FATAL"] ?? "0") == "1"
let brokerAccount = environment["CARDIARY_DOUBLE_BROKER_ACCOUNT"]

func milliseconds(_ raw: String?) -> Int {
    guard let raw, let value = Int(raw) else { return 0 }
    return max(0, value)
}

let stdout = FileHandle.standardOutput
let stderr = FileHandle.standardError
let reader = LineReader(handle: .standardInput)

func log(_ message: String) {
    guard let data = "\(message)\n".data(using: .utf8) else { return }
    try? stderr.write(contentsOf: data)
}

func writeFrame(_ object: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    else { return }
    data.append(0x0A)
    try? stdout.write(contentsOf: data)
}

func fail(_ code: Int32, _ reason: String) -> Never {
    log("service-double: \(reason)")
    exit(code)
}

func token(_ value: String) -> Bool {
    value.count == 43 && value.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
}

// 自己的 fd 清單：殼不應該傳任何額外的檔案描述子過來。
let ownFileDescriptors = (try? FileManager.default.contentsOfDirectory(atPath: "/dev/fd")) ?? []
// 診斷只走 stderr：stdout 從第一行起就是協定。
log("service-double: fds=\(ownFileDescriptors.sorted().joined(separator: ","))")

// 一個工具子行程的 fd 清單：只用 pipe，不繼承 stdout／stdin。
if let childReport = probeChildFileDescriptors() {
    log("service-double: child-fds=\(childReport)")
}

// MARK: - 交握

guard let initLine = reader.nextLine() else {
    fail(2, "stdin 在 init 之前就結束")
}
guard let initObject = try? JSONSerialization.jsonObject(with: initLine) as? [String: Any],
    initObject["type"] as? String == "init"
else {
    fail(2, "第一行不是 init")
}
guard let protocolVersion = initObject["protocol"] as? Int, protocolVersion == 1 else {
    fail(2, "控制面版本不符")
}
guard let controlToken = initObject["token"] as? String, token(controlToken),
    let brokerToken = initObject["brokerToken"] as? String, token(brokerToken),
    controlToken != brokerToken
else {
    fail(2, "Token 格式不合法或兩把相同")
}
guard let folder = initObject["folder"] as? [String: Any],
    let folderPath = folder["path"] as? String,
    folderPath.hasPrefix("/")
else {
    fail(2, "folder.path 不是絕對路徑")
}
var isDirectory: ObjCBool = false
guard FileManager.default.fileExists(atPath: folderPath, isDirectory: &isDirectory),
    isDirectory.boolValue
else {
    fail(2, "folder.path 不是目錄")
}

let pid = ProcessInfo.processInfo.processIdentifier
let readyProtocol = failProtocol ? 2 : 1
writeFrame([
    "type": "ready",
    "protocol": readyProtocol,
    "pid": Int(pid),
    "clientPort": 49_152,
    "folderId": "01JCX8Q3W7Z9K5V2N4M6P8R0T1",
    "epoch": "01JCX8Q3W7Z9K5V2N4M6P8R0T2",
])

writeFrame([
    "v": 1,
    "kind": "hello",
    "role": "host-service",
    "pid": Int(badHelloPid ? pid + 1 : pid),
    "auth": ["token": badHelloToken ? "not-the-broker-token" : brokerToken],
])

guard let ackLine = reader.nextLine(),
    let ack = try? JSONSerialization.jsonObject(with: ackLine) as? [String: Any],
    ack["v"] as? Int == 1,
    ack["kind"] as? String == "hello-ack",
    let ackAuth = ack["auth"] as? [String: Any],
    ackAuth["token"] as? String == controlToken
else {
    fail(3, "hello-ack 的 Token 不符")
}

log("service-double: 交握完成 pid=\(pid)")

if oversizeFrame {
    let padding = String(repeating: "x", count: 70_000)
    writeFrame(["v": 1, "kind": "notification", "route": "notify.fatal", "auth": ["token": brokerToken], "payload": ["reason": "internal", "detail": padding]])
}

if sendFatal {
    writeFrame([
        "v": 1,
        "kind": "notification",
        "route": "notify.fatal",
        "auth": ["token": brokerToken],
        "payload": ["reason": "storage_io", "detail": "state/cardiary.sqlite: SQLITE_IOERR"],
    ])
}

if let brokerAccount {
    writeFrame([
        "v": 1,
        "kind": "request",
        "id": "brk_test_1",
        "route": "broker.keychain.get",
        "auth": ["token": brokerToken],
        "payload": ["account": brokerAccount],
    ])
    if let replyLine = reader.nextLine(),
        let reply = try? JSONSerialization.jsonObject(with: replyLine) as? [String: Any]
    {
        let payload = reply["payload"] as? [String: Any]
        let found = payload?["found"] as? Bool ?? false
        let extras = (payload ?? [:]).keys.sorted().joined(separator: ",")
        log("service-double: broker-found=\(found) keys=\(extras)")
    }
}

// MARK: - 維護通知

if maintenanceMilliseconds > 0 {
    writeFrame([
        "v": 1,
        "kind": "notification",
        "route": "notify.maintenance",
        "auth": ["token": brokerToken],
        "payload": ["lifecycle": "deleting", "operationId": "op_test"],
    ])
    DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(maintenanceMilliseconds)) {
        writeFrame([
            "v": 1,
            "kind": "notification",
            "route": "notify.maintenance",
            "auth": ["token": brokerToken],
            "payload": ["lifecycle": "idle", "operationId": "op_test"],
        ])
    }
}

// MARK: - 控制請求

var lifecycle = "idle"
var shutdownRequested = false
let startedAt = Date()

while let line = reader.nextLine() {
    guard let frame = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
        frame["v"] as? Int == 1,
        let kind = frame["kind"] as? String,
        kind == "request",
        let id = frame["id"] as? String,
        let route = frame["route"] as? String,
        let auth = frame["auth"] as? [String: Any],
        auth["token"] as? String == controlToken
    else {
        fail(4, "收到不合法或 Token 不符的 frame")
    }

    switch route {
    case "control.health":
        let uptime = Int(Date().timeIntervalSince(startedAt))
        writeFrame([
            "v": 1,
            "kind": "response",
            "id": "res_\(id)",
            "replyTo": badReply ? "reply_to_nothing" : id,
            "auth": ["token": brokerToken],
            "ok": true,
            "payload": [
                "state": "running",
                "epoch": "01JCX8Q3W7Z9K5V2N4M6P8R0T2",
                "uptimeSeconds": uptime,
                "folderId": "01JCX8Q3W7Z9K5V2N4M6P8R0T1",
                "clientPort": 49_152,
                "lifecycle": lifecycle,
            ],
        ])

    case "control.pause":
        lifecycle = "pausing"
        if pauseDelay > 0 {
            Thread.sleep(forTimeInterval: Double(pauseDelay) / 1000)
        }
        lifecycle = "idle"
        writeFrame([
            "v": 1,
            "kind": "response",
            "id": "res_\(id)",
            "replyTo": id,
            "auth": ["token": brokerToken],
            "ok": true,
            "payload": [
                "state": "paused",
                "databasesClosed": true,
                "interruptedSessionIds": [],
                "terminatedProcesses": 0,
            ],
        ])

    case "control.resume":
        lifecycle = "resuming"
        if resumeDelay > 0 {
            Thread.sleep(forTimeInterval: Double(resumeDelay) / 1000)
        }
        lifecycle = "idle"
        writeFrame([
            "v": 1,
            "kind": "response",
            "id": "res_\(id)",
            "replyTo": id,
            "auth": ["token": brokerToken],
            "ok": true,
            "payload": [
                "state": "ready",
                "epoch": "01JCX8Q3W7Z9K5V2N4M6P8R0T2",
                "folderId": "01JCX8Q3W7Z9K5V2N4M6P8R0T1",
                "engineReopened": true,
            ],
        ])

    case "control.shutdown":
        shutdownRequested = true
        writeFrame([
            "v": 1,
            "kind": "response",
            "id": "res_\(id)",
            "replyTo": id,
            "auth": ["token": brokerToken],
            "ok": true,
            "payload": [
                "state": "closed",
                "cleanShutdown": cleanShutdown,
            ],
        ])
        // 等 stdout flush 後才結束。
        try? stdout.synchronizeFile()
        log("service-double: 收到 shutdown")
        exit(0)

    default:
        writeFrame([
            "v": 1,
            "kind": "response",
            "id": "res_\(id)",
            "replyTo": id,
            "auth": ["token": brokerToken],
            "ok": false,
            "error": [
                "code": "unsupported_route",
                "message": "不支援的路由。",
                "retryable": false,
            ],
        ])
    }
}

// stdin 結束：殼不見了。關閉但不算正常關閉。
log("service-double: stdin 結束（shutdownRequested=\(shutdownRequested)）")
exit(0)

// MARK: - 輔助

func probeChildFileDescriptors() -> String? {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/sh")
    process.arguments = ["-c", "ls /dev/fd | sort | tr '\\n' ','"]
    let output = Pipe()
    process.standardOutput = output
    process.standardError = Pipe()
    process.standardInput = FileHandle.nullDevice
    do {
        try process.run()
    } catch {
        return nil
    }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return String(data: data, encoding: .utf8)?
        .trimmingCharacters(in: CharacterSet(charactersIn: ","))
}

/// 用 `read(2)` 逐段讀：`FileHandle.readData(ofLength:)` 會等到讀滿長度或 EOF，
/// 管線保持開啟時會一直卡住。
final class LineReader {
    private let fd: Int32
    private var buffer = Data()

    init(handle: FileHandle) {
        self.fd = handle.fileDescriptor
    }

    func nextLine() -> Data? {
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            if let newline = buffer.firstIndex(of: 0x0A) {
                let line = buffer.subdata(in: buffer.startIndex..<newline)
                buffer.removeSubrange(buffer.startIndex...newline)
                return line
            }
            let count = chunk.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if count > 0 {
                buffer.append(contentsOf: chunk[0..<count])
            } else if count == 0 {
                return buffer.isEmpty ? nil : buffer
            } else if errno == EINTR {
                continue
            } else {
                return nil
            }
        }
    }
}
