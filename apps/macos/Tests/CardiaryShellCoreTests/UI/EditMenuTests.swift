import AppKit
import XCTest

@testable import CardiaryShellCore

/// Edit 選單的行為測試：選單項目結構、本地化，以及 nil target 是否把動作交給
/// 文字輸入框。`swift test` 是沒有 key window 的 headless 行程，AppKit 不會把 nil
/// target 送到第一回應者，所以動作測試直接把選單項目的 selector 送到欄位，並用
/// 子類別提供假貼上內容；全程不讀也不寫 NSPasteboard.general。
final class EditMenuTests: XCTestCase {
    private var windows: [NSWindow] = []

    override func tearDown() {
        for window in windows {
            window.makeFirstResponder(nil)
            window.orderOut(nil)
        }
        windows.removeAll()
        super.tearDown()
    }

    // MARK: - 選單結構

    func testMenuHasStandardItemsWithCorrectActionsAndKeys() {
        let menu = EditMenu.make(language: .en)

        XCTAssertEqual(menu.title, "Edit")
        let items = menu.items.filter { $0.action != nil }
        XCTAssertEqual(items.count, 6, "應有復原/重做/剪下/複製/貼上/全選六個動作")

        assertItem(items, action: "undo:", title: "Undo", key: "z", modifiers: .command)
        assertItem(items, action: "redo:", title: "Redo", key: "z", modifiers: [.command, .shift])
        assertItem(items, action: "cut:", title: "Cut", key: "x", modifiers: .command)
        assertItem(items, action: "copy:", title: "Copy", key: "c", modifiers: .command)
        assertItem(items, action: "paste:", title: "Paste", key: "v", modifiers: .command)
        assertItem(items, action: "selectAll:", title: "Select All", key: "a", modifiers: .command)
    }

    func testAllItemsHaveNilTargetSoActionsReachFirstResponder() {
        let menu = EditMenu.make(language: .en)
        for item in menu.items where item.action != nil {
            XCTAssertNil(item.target, "\(item.title) 的 target 必須是 nil，才能沿 responder chain 傳遞")
        }
    }

    func testMenuIsLocalizedToTraditionalChinese() {
        let menu = EditMenu.make(language: .zhHant)
        XCTAssertEqual(menu.title, "編輯")
        let titles = menu.items.filter { $0.action != nil }.map(\.title)
        XCTAssertEqual(titles, ["復原", "重做", "剪下", "複製", "貼上", "全選"])
    }

    // MARK: - 動作送到文字輸入框

    /// 真的 NSSecureTextField 收到選單的貼上 selector 後，應更新內容。子類別只把
    /// 貼上內容換成假資料，其餘都是真的 NSSecureTextField 行為。
    func testPasteActionReachesSecureTextField() {
        let field = FakePasteSecureTextField(fakeText: "fake-token-content")

        let item = actionItem("paste:", in: EditMenu.make(language: .en))
        NSApp.sendAction(item.action!, to: field, from: item)

        XCTAssertTrue(field.didPaste, "貼上動作的 selector 應送達安全輸入框")
        XCTAssertEqual(field.stringValue, "fake-token-content")
    }

    /// 真的 NSTextField 拿到鍵盤焦點後，第一回應者是它的 field editor。選單的全選
    /// selector 送達後應選取欄位內全部文字。全選不碰剪貼簿。
    func testSelectAllActionReachesTextFieldFirstResponder() {
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 200, height: 22))
        field.stringValue = "abcdef"
        let window = makeWindow()
        window.contentView?.addSubview(field)
        window.makeFirstResponder(field)

        let editor = window.firstResponder as? NSTextView
        XCTAssertNotNil(editor, "文字欄位的第一回應者應是 field editor")
        editor?.setSelectedRange(NSRange(location: 0, length: 0))

        let item = actionItem("selectAll:", in: EditMenu.make(language: .en))
        NSApp.sendAction(item.action!, to: window.firstResponder, from: item)

        XCTAssertEqual(editor?.selectedRange.location, 0)
        XCTAssertEqual(editor?.selectedRange.length, 6, "Cmd-A 應選取全部六個字元")
    }

    // MARK: - 輔助

    private func assertItem(
        _ items: [NSMenuItem],
        action: String,
        title: String,
        key: String,
        modifiers: NSEvent.ModifierFlags,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let item = items.first(where: { $0.action == Selector(action) }) else {
            XCTFail("找不到 \(action)", file: file, line: line)
            return
        }
        XCTAssertEqual(item.title, title, file: file, line: line)
        XCTAssertEqual(item.keyEquivalent, key, file: file, line: line)
        XCTAssertEqual(item.keyEquivalentModifierMask, modifiers, file: file, line: line)
        XCTAssertNil(item.target, file: file, line: line)
    }

    private func actionItem(_ action: String, in menu: NSMenu) -> NSMenuItem {
        menu.items.first { $0.action == Selector(action) }!
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 240),
            styleMask: [.titled],
            backing: .buffered,
            defer: true
        )
        window.makeKeyAndOrderFront(nil)
        windows.append(window)
        return window
    }
}

/// 只攔貼上動作、餵假內容的安全輸入框；其餘都是真的 NSSecureTextField 行為。
/// `paste:` 沒有被匯入成可 override 的 Swift 方法，但同名 @objc selector 會在
/// Objective-C 執行期覆蓋父類別的實作，仍能攔到選單送來的動作。
private final class FakePasteSecureTextField: NSSecureTextField {
    private(set) var didPaste = false
    private let fakeText: String

    init(fakeText: String) {
        self.fakeText = fakeText
        super.init(frame: NSRect(x: 0, y: 0, width: 200, height: 22))
    }

    required init?(coder: NSCoder) {
        fatalError("測試用，不從 storyboard 建立")
    }

    @objc func paste(_ sender: Any?) {
        didPaste = true
        stringValue = fakeText
    }
}
