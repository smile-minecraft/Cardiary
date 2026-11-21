import AppKit
import XCTest

@testable import CardiaryShellCore

final class ViewMenuTests: XCTestCase {
    @objc private func zoomInDummy() {}
    @objc private func zoomOutDummy() {}
    @objc private func resetZoomDummy() {}
    @objc private func toggleInspectorDummy() {}

    func testViewMenuItemsAndShortcutsInEnglish() {
        let menu = ViewMenu.make(
            target: self,
            zoomInAction: #selector(zoomInDummy),
            zoomOutAction: #selector(zoomOutDummy),
            resetZoomAction: #selector(resetZoomDummy),
            toggleInspectorAction: #selector(toggleInspectorDummy),
            language: .en
        )

        XCTAssertEqual(menu.title, "View")
        let actionable = menu.items.filter { $0.action != nil }
        XCTAssertEqual(actionable.count, 5)

        XCTAssertEqual(actionable[0].title, "Zoom In")
        XCTAssertEqual(actionable[0].keyEquivalent, "+")
        XCTAssertEqual(actionable[0].keyEquivalentModifierMask, .command)
        XCTAssertTrue(actionable[0].target === self)

        XCTAssertEqual(actionable[1].title, "Zoom Out")
        XCTAssertEqual(actionable[1].keyEquivalent, "-")
        XCTAssertEqual(actionable[1].keyEquivalentModifierMask, .command)

        XCTAssertEqual(actionable[2].title, "Actual Size")
        XCTAssertEqual(actionable[2].keyEquivalent, "0")
        XCTAssertEqual(actionable[2].keyEquivalentModifierMask, .command)

        XCTAssertEqual(actionable[3].title, "Show or Hide Inspector")
        XCTAssertEqual(actionable[3].keyEquivalent, "i")
        XCTAssertEqual(actionable[3].keyEquivalentModifierMask, [.command, .option])

        XCTAssertEqual(actionable[4].title, "Enter Full Screen")
        XCTAssertEqual(actionable[4].keyEquivalent, "f")
        XCTAssertEqual(actionable[4].keyEquivalentModifierMask, [.command, .control])
        XCTAssertEqual(actionable[4].action, #selector(NSWindow.toggleFullScreen(_:)))
        XCTAssertNil(actionable[4].target)
    }

    func testViewAndWindowMenusInTraditionalChinese() {
        let viewMenu = ViewMenu.make(
            target: self,
            zoomInAction: #selector(zoomInDummy),
            zoomOutAction: #selector(zoomOutDummy),
            resetZoomAction: #selector(resetZoomDummy),
            toggleInspectorAction: #selector(toggleInspectorDummy),
            language: .zhHant
        )
        XCTAssertEqual(viewMenu.title, "檢視")
        XCTAssertEqual(
            viewMenu.items.compactMap { $0.action != nil ? $0.title : nil },
            ["放大", "縮小", "實際大小", "顯示或收合檢視欄", "進入全螢幕"]
        )

        let windowMenu = WindowMenu.make(language: .zhHant)
        XCTAssertEqual(windowMenu.title, "視窗")
        XCTAssertEqual(
            windowMenu.items.map(\.title),
            ["關閉視窗", "縮到最小", "縮放"]
        )
        for item in windowMenu.items {
            XCTAssertNil(item.target)
        }
    }
}
