import AppKit
import CardiaryShellCore

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: ShellController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = ShellController()
        self.controller = controller
        controller.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // 關閉視窗後服務仍在執行；結束要從選單列明確選擇。
        false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let controller else { return .terminateNow }
        return controller.beginTermination(sender)
    }

    func applicationWillTerminate(_ notification: Notification) {
        controller?.forceStopForTermination()
    }
}
