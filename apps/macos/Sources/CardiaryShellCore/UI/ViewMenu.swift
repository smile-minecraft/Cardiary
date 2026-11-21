import AppKit

/// 檢視選單與視窗選單：提供介面縮放（放大、縮小、實際大小）、檢視欄切換與全螢幕。
public enum ViewMenu {
    /// 建立 `檢視` 選單。縮放與檢視欄項目透過傳入的 `target` 與 selector 執行；
    /// 測試可直接檢視標題、快速鍵與動作名稱。
    public static func make(
        target: AnyObject? = nil,
        zoomInAction: Selector,
        zoomOutAction: Selector,
        resetZoomAction: Selector,
        toggleInspectorAction: Selector,
        language: L10n.Language? = nil
    ) -> NSMenu {
        let menu = NSMenu(title: L10n.text(.menuView, language: language))

        menu.addItem(makeItem(
            .menuZoomIn,
            action: zoomInAction,
            key: "+",
            modifiers: .command,
            target: target,
            language: language
        ))
        menu.addItem(makeItem(
            .menuZoomOut,
            action: zoomOutAction,
            key: "-",
            modifiers: .command,
            target: target,
            language: language
        ))
        menu.addItem(makeItem(
            .menuActualSize,
            action: resetZoomAction,
            key: "0",
            modifiers: .command,
            target: target,
            language: language
        ))

        menu.addItem(.separator())

        menu.addItem(makeItem(
            .menuToggleInspector,
            action: toggleInspectorAction,
            key: "i",
            modifiers: [.command, .option],
            target: target,
            language: language
        ))

        menu.addItem(.separator())

        menu.addItem(makeItem(
            .menuFullScreen,
            action: #selector(NSWindow.toggleFullScreen(_:)),
            key: "f",
            modifiers: [.command, .control],
            target: nil,
            language: language
        ))

        return menu
    }

    private static func makeItem(
        _ titleKey: L10n.Key,
        action: Selector,
        key: String,
        modifiers: NSEvent.ModifierFlags,
        target: AnyObject?,
        language: L10n.Language?
    ) -> NSMenuItem {
        let item = NSMenuItem(
            title: L10n.text(titleKey, language: language),
            action: action,
            keyEquivalent: key
        )
        item.keyEquivalentModifierMask = modifiers
        item.target = target
        return item
    }
}

/// 標準 `視窗` 選單：讓使用者關閉、最小化與縮放主視窗。
public enum WindowMenu {
    public static func make(language: L10n.Language? = nil) -> NSMenu {
        let menu = NSMenu(title: L10n.text(.menuWindow, language: language))

        let closeItem = NSMenuItem(
            title: L10n.text(.menuCloseWindow, language: language),
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )
        closeItem.keyEquivalentModifierMask = .command
        closeItem.target = nil
        menu.addItem(closeItem)

        let minimizeItem = NSMenuItem(
            title: L10n.text(.menuMinimize, language: language),
            action: #selector(NSWindow.performMiniaturize(_:)),
            keyEquivalent: "m"
        )
        minimizeItem.keyEquivalentModifierMask = .command
        minimizeItem.target = nil
        menu.addItem(minimizeItem)

        let zoomItem = NSMenuItem(
            title: L10n.text(.menuWindowZoom, language: language),
            action: #selector(NSWindow.performZoom(_:)),
            keyEquivalent: ""
        )
        zoomItem.target = nil
        menu.addItem(zoomItem)

        return menu
    }
}
