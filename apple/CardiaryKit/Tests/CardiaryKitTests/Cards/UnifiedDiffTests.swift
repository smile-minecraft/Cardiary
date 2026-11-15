import XCTest

@testable import CardiaryKit

final class UnifiedDiffTests: XCTestCase {
    func testReplacementKeepsContext() {
        let diff = UnifiedDiff.make(original: "a\nb\nc", updated: "a\nB\nc")
        XCTAssertEqual(diff, """
        @@ -1,3 +1,3 @@
         a
        -b
        +B
         c
        """)
    }

    func testEmptyBodyToTextConsumesTheEmptyLine() {
        let diff = UnifiedDiff.make(original: "", updated: "hello")
        XCTAssertEqual(diff, """
        @@ -1,1 +1,1 @@
        -
        +hello
        """)
    }

    func testTextToEmptyBodyProducesAnEmptyReplacementLine() {
        let diff = UnifiedDiff.make(original: "hello", updated: "")
        XCTAssertEqual(diff, """
        @@ -1,1 +1,1 @@
        -hello
        +
        """)
    }

    func testAppendingAtEndOnlyAddsLines() {
        let diff = UnifiedDiff.make(original: "a", updated: "a\nb")
        XCTAssertEqual(diff, """
        @@ -1,1 +1,2 @@
         a
        +b
        """)
    }

    func testTrailingNewlineIsKeptInTheDiff() {
        let diff = UnifiedDiff.make(original: "a\n", updated: "a\nb\n")
        XCTAssertEqual(diff, """
        @@ -1,2 +1,3 @@
         a
        +b
         
        """)
    }

    func testContextIsLimitedToThreeLines() {
        let original = (1...10).map { "line\($0)" }.joined(separator: "\n")
        var changed = (1...10).map { "line\($0)" }
        changed[4] = "changed"
        let diff = UnifiedDiff.make(original: original, updated: changed.joined(separator: "\n"))
        let lines = diff.components(separatedBy: "\n")
        XCTAssertEqual(lines.first, "@@ -2,7 +2,7 @@")
        XCTAssertTrue(lines.contains("-line5"))
        XCTAssertTrue(lines.contains("+changed"))
        XCTAssertFalse(lines.contains(" line1"), "只留三行前文")
        XCTAssertFalse(lines.contains(" line10"), "只留三行後文")
    }

    func testCarriageReturnsStayOnTheirLines() {
        let diff = UnifiedDiff.make(original: "a\r\nb\r\nc", updated: "a\r\nB\r\nc")
        XCTAssertEqual(diff, """
        @@ -1,3 +1,3 @@
         a\r
        -b\r
        +B\r
         c
        """)
    }

    func testUnchangedTextProducesNoPatch() {
        XCTAssertEqual(UnifiedDiff.make(original: "same", updated: "same"), "")
    }
}
