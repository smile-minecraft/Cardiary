import SwiftUI
import XCTest

@testable import CardiaryApp

/// 匯入掛載點：預設的 `ImportUIEntry.live` 要提供開啟匯入流程的命令。
@MainActor
final class ImportUIModuleTests: XCTestCase {
    func testLiveEntryOffersOpenCommand() {
        let entry = ImportUIEntry.live(AppModel(setupCompleted: true))
        XCTAssertEqual(entry.commands.map(\.id), ["import.open"])
        XCTAssertEqual(entry.commands.first?.titleKey, .commandGroupImport)
    }
}
