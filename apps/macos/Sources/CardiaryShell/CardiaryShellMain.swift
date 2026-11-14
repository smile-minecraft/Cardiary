import AppKit

// 殼以「只留選單列」的方式啟動：不佔 Dock，關閉視窗不等於結束服務。
@main
@MainActor
struct CardiaryShellMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}
