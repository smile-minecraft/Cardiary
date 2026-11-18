import SwiftUI
import XCTest

@testable import CardiaryApp

/// 側欄的方向鍵導覽：上下各移一列、到頭不繞回、沒有選取時選第一列。
///
/// 無障礙按下（AXPress）在打包版用 AX API 驗證：xctest 行程裡的 NSHostingView
/// 不會產生 SwiftUI 的 AX 子樹，掛上可見視窗又會讓 xctest 異常結束。
@MainActor
final class SidebarNavigationTests: XCTestCase {
    private let items: [AppSelection] = [
        .conversation("s-1"),
        .conversation("s-2"),
        .slot("cards"),
        .slot("whiteboard"),
    ]

    func testDownMovesToNextRowAcrossSections() {
        XCTAssertEqual(SidebarView.moveTarget(in: items, from: .conversation("s-1"), direction: .down), .conversation("s-2"))
        XCTAssertEqual(SidebarView.moveTarget(in: items, from: .conversation("s-2"), direction: .down), .slot("cards"))
    }

    func testUpMovesToPreviousRowAcrossSections() {
        XCTAssertEqual(SidebarView.moveTarget(in: items, from: .slot("cards"), direction: .up), .conversation("s-2"))
    }

    func testEdgesDoNotWrap() {
        XCTAssertNil(SidebarView.moveTarget(in: items, from: .conversation("s-1"), direction: .up))
        XCTAssertNil(SidebarView.moveTarget(in: items, from: .slot("whiteboard"), direction: .down))
    }

    func testNoSelectionPicksFirstRowInEitherDirection() {
        XCTAssertEqual(SidebarView.moveTarget(in: items, from: .none, direction: .down), .conversation("s-1"))
        XCTAssertEqual(SidebarView.moveTarget(in: items, from: .none, direction: .up), .conversation("s-1"))
        // 選取指向已不在清單裡的對話（例如剛被刪掉）時也一樣。
        XCTAssertEqual(SidebarView.moveTarget(in: items, from: .conversation("gone"), direction: .down), .conversation("s-1"))
    }

    func testHorizontalKeysAndEmptyListDoNothing() {
        XCTAssertNil(SidebarView.moveTarget(in: items, from: .conversation("s-1"), direction: .left))
        XCTAssertNil(SidebarView.moveTarget(in: items, from: .conversation("s-1"), direction: .right))
        XCTAssertNil(SidebarView.moveTarget(in: [], from: .none, direction: .down))
    }
}
