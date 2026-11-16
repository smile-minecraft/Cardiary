import AppKit

// 一般 App 保留 Dock 圖示與選單列；關閉視窗不等於結束服務。
@main
@MainActor
struct CardiaryShellMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }
}
