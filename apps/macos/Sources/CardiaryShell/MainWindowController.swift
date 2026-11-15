import AppKit
import CardiaryApp
import SwiftUI

/// 產品介面的視窗。殼只負責開關與大小，內容全部來自 `CardiaryApp`。
@MainActor
final class MainWindowController {
    private let model: AppModel
    private var window: NSWindow?

    init(model: AppModel) {
        self.model = model
    }

    func show() {
        if window == nil {
            window = makeWindow()
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    func close() {
        window?.close()
    }

    private func makeWindow() -> NSWindow {
        // 中文圓體是系統的可下載字型；沒有安裝時請系統在背景下載。
        ThemeTypography.requestCJKDownloadIfNeeded()
        let hosting = NSHostingController(rootView: CardiaryRootView(model: model))
        // 不讓 hosting controller 依 SwiftUI 根畫面的最佳尺寸縮小視窗；
        // 視窗一律用下面的預設大小，使用者再自行調整。
        hosting.sizingOptions = []
        let window = NSWindow(contentViewController: hosting)
        window.title = AppL10n.text(ShellString.mainWindowTitle)
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        // 標題列透明，讓撲克牌主題的米白底延伸到最上方。
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(Palette.canvas)
        window.setContentSize(NSSize(
            width: DesignTokens.windowDefaultWidth,
            height: DesignTokens.windowDefaultHeight
        ))
        window.minSize = NSSize(
            width: DesignTokens.windowMinWidth,
            height: DesignTokens.windowMinHeight
        )
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.center()
        return window
    }
}
