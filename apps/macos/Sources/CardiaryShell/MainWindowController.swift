import AppKit
import CardiaryApp
import SwiftUI

/// 產品介面的視窗。殼只負責開關、尺寸限制、全螢幕與介面縮放快捷鍵，內容全部來自 `CardiaryApp`。
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
        // 視窗一律用下面的預設大小與使用者調整後的尺寸。
        hosting.sizingOptions = []

        let scaleStore = model.uiScale
        let window = CardiaryMainWindow(
            contentRect: NSRect(
                x: 0,
                y: 0,
                width: DesignTokens.windowDefaultWidth,
                height: DesignTokens.windowDefaultHeight
            ),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.contentViewController = hosting
        window.onZoomIn = { [weak scaleStore] in scaleStore?.zoomIn() }
        window.onZoomOut = { [weak scaleStore] in scaleStore?.zoomOut() }
        window.onResetZoom = { [weak scaleStore] in scaleStore?.reset() }

        window.title = AppL10n.text(ShellString.mainWindowTitle)
        window.collectionBehavior.insert(.fullScreenPrimary)
        // 標題列透明，讓撲克牌主題的米白底延伸到最上方。
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(Palette.canvas)
        let minSize = NSSize(
            width: DesignTokens.windowMinWidth,
            height: DesignTokens.windowMinHeight
        )
        window.contentMinSize = minSize
        window.setContentSize(NSSize(
            width: DesignTokens.windowDefaultWidth,
            height: DesignTokens.windowDefaultHeight
        ))
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        // 記住上次的視窗大小；第一次開啟才用預設大小並置中。
        if window.setFrameAutosaveName("CardiaryMainWindow") == false {
            window.center()
        }
        // 避免早期自動儲存的小視窗大小低於目前最小尺寸限制。
        let current = window.contentLayoutRect.size
        if current.width < minSize.width || current.height < minSize.height {
            window.setContentSize(NSSize(
                width: max(current.width, minSize.width),
                height: max(current.height, minSize.height)
            ))
        }
        return window
    }
}

/// 攔截 `⌘=` / `⌘+` / `⌘-` / `⌘0`（含數字鍵盤），讓介面縮放即使在焦點於文字輸入框
/// 或非美式鍵盤排列下也能即時響應，不會被文字元件吃掉或發出嗶聲。
private final class CardiaryMainWindow: NSWindow {
    var onZoomIn: (@MainActor () -> Void)?
    var onZoomOut: (@MainActor () -> Void)?
    var onResetZoom: (@MainActor () -> Void)?

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags.contains(.command),
            !flags.contains(.control),
            !flags.contains(.option),
            let chars = event.charactersIgnoringModifiers
        {
            switch chars {
            case "=", "+":
                onZoomIn?()
                return true
            case "-", "_":
                onZoomOut?()
                return true
            case "0":
                onResetZoom?()
                return true
            default:
                break
            }
        }
        return super.performKeyEquivalent(with: event)
    }
}
