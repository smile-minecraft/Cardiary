import AppKit

/// 標準 Edit 選單，讓文字與安全輸入框能透過 responder chain 使用原生剪貼操作。
///
/// 每個項目的 `target` 留 `nil`，AppKit 才會把動作送到 currently key window 的
/// 第一回應者（`NSTextField` / `NSSecureTextField`）。選單本身不碰 `NSPasteboard`，
/// 貼上與剪下的讀寫完全交給第一回應者。
public enum EditMenu {
    /// 建立選單。`language` 傳入時固定語言，便於測試；不傳則跟隨全域語言設定。
    public static func make(language: L10n.Language? = nil) -> NSMenu {
        let menu = NSMenu(title: L10n.text(.menuEdit, language: language))
        menu.addItem(item(.menuUndo, action: "undo:", key: "z", modifiers: .command, language: language))
        menu.addItem(item(.menuRedo, action: "redo:", key: "z", modifiers: [.command, .shift], language: language))
        menu.addItem(.separator())
        menu.addItem(item(.menuCut, action: "cut:", key: "x", modifiers: .command, language: language))
        menu.addItem(item(.menuCopy, action: "copy:", key: "c", modifiers: .command, language: language))
        menu.addItem(item(.menuPaste, action: "paste:", key: "v", modifiers: .command, language: language))
        menu.addItem(.separator())
        menu.addItem(item(.menuSelectAll, action: "selectAll:", key: "a", modifiers: .command, language: language))
        return menu
    }

    private static func item(
        _ titleKey: L10n.Key,
        action: String,
        key: String,
        modifiers: NSEvent.ModifierFlags,
        language: L10n.Language?
    ) -> NSMenuItem {
        let item = NSMenuItem(
            title: L10n.text(titleKey, language: language),
            action: Selector(action),
            keyEquivalent: key
        )
        item.keyEquivalentModifierMask = modifiers
        // nil 是刻意：讓動作沿 responder chain 送到第一回應者。
        item.target = nil
        return item
    }
}
