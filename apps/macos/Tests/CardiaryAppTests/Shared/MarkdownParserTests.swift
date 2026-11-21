import Foundation
import SwiftUI
import XCTest

@testable import CardiaryApp

final class MarkdownParserTests: XCTestCase {
    // MARK: - 區塊解析

    func testHeadingsParagraphsAndThematicBreak() {
        let input = """
        # Title One
        ### Section Three ###

        First line
        Second line

        ---

        Tail paragraph
        """
        let blocks = MarkdownParser.parseBlocks(input)
        XCTAssertEqual(blocks, [
            .heading(level: 1, text: "Title One"),
            .heading(level: 3, text: "Section Three"),
            .paragraph("First line\nSecond line"),
            .thematicBreak,
            .paragraph("Tail paragraph"),
        ])
    }

    func testHashtagWithoutSpaceRemainsParagraph() {
        let blocks = MarkdownParser.parseBlocks("#todo remember milk")
        XCTAssertEqual(blocks, [.paragraph("#todo remember milk")])
    }

    func testFencedCodeBlockAndStreamingUnclosedFence() {
        let closed = """
        ```swift
        let answer = 42
        ```
        """
        XCTAssertEqual(MarkdownParser.parseBlocks(closed), [
            .codeBlock(language: "swift", code: "let answer = 42", isClosed: true),
        ])

        let tilde = """
        ~~~python
        print("hi")
        ~~~
        """
        XCTAssertEqual(MarkdownParser.parseBlocks(tilde), [
            .codeBlock(language: "python", code: "print(\"hi\")", isClosed: true),
        ])

        let streaming = """
        Here is code:

        ```ts
        const x = 1;
        """
        XCTAssertEqual(MarkdownParser.parseBlocks(streaming), [
            .paragraph("Here is code:"),
            .codeBlock(language: "ts", code: "const x = 1;", isClosed: false),
        ])
    }

    func testInlineTripleBackticksStayParagraph() {
        let blocks = MarkdownParser.parseBlocks("Use ```inline``` here")
        XCTAssertEqual(blocks, [.paragraph("Use ```inline``` here")])
    }

    func testBlockquotesRespectMaxNestingDepth() {
        let input = "> outer\n>> inner"
        XCTAssertEqual(MarkdownParser.parseBlocks(input), [
            .blockquote([
                .paragraph("outer"),
                .blockquote([
                    .paragraph("inner"),
                ]),
            ]),
        ])

        // 超過 maxBlockquoteDepth 時停止再往內遞迴，將剩餘的 `>` 當作純文字而不崩潰
        let deep = String(repeating: "> ", count: MarkdownParser.maxBlockquoteDepth + 3) + "deep"
        let parsed = MarkdownParser.parseBlocks(deep)
        XCTAssertEqual(parsed.count, 1)
    }

    func testListsOrderedUnorderedNestedAndTasks() {
        let input = """
        - [ ] todo item
        - [x] done item
          1. nested step
          2) second nested
            continued line
        * [X] upper x
        """
        let blocks = MarkdownParser.parseBlocks(input)
        XCTAssertEqual(blocks, [
            .list(ordered: false, items: [
                MarkdownListItem(indent: 0, number: nil, taskChecked: false, text: "todo item"),
                MarkdownListItem(indent: 0, number: nil, taskChecked: true, text: "done item"),
                MarkdownListItem(indent: 1, number: 1, taskChecked: nil, text: "nested step"),
                MarkdownListItem(indent: 1, number: 2, taskChecked: nil, text: "second nested continued line"),
                MarkdownListItem(indent: 0, number: nil, taskChecked: true, text: "upper x"),
            ]),
        ])
    }

    func testGFMTableWithAlignmentsEscapesAndCodePipes() {
        let input = """
        | Key | Desc | Count |
        | :--- | :---: | ---: |
        | `a\\|b` | literal \\| pipe | 42 |
        | short |
        """
        let blocks = MarkdownParser.parseBlocks(input)
        XCTAssertEqual(blocks, [
            .table(
                headers: ["Key", "Desc", "Count"],
                alignments: [.leading, .center, .trailing],
                rows: [
                    ["`a|b`", "literal | pipe", "42"],
                    ["short", "", ""],
                ]
            ),
        ])
    }

    // MARK: - 行內與安全性

    func testInlineFormattingAndSnakeCasePreservation() {
        let tokens = MarkdownParser.parseInline(
            "**bold** *em* ***both*** ~~gone~~ `code` snake_case_name _ok_"
        )
        XCTAssertEqual(tokens, [
            .strong([.text("bold")]),
            .text(" "),
            .emphasis([.text("em")]),
            .text(" "),
            .strong([.emphasis([.text("both")])]),
            .text(" "),
            .strikethrough([.text("gone")]),
            .text(" "),
            .code("code"),
            .text(" snake_case_name "),
            .emphasis([.text("ok")]),
        ])
    }

    func testEscapedCharactersAndCodeSpansPreventFormatting() {
        let tokens = MarkdownParser.parseInline(#"\*literal\* `**not bold**` `` `inner` ``"#)
        XCTAssertEqual(tokens, [
            .text("*literal* "),
            .code("**not bold**"),
            .text(" "),
            .code("`inner`"),
        ])
    }

    func testLinksAllowedSchemesAndRejectUnsafeSchemes() {
        let tokens = MarkdownParser.parseInline(
            "[wiki](https://en.wikipedia.org/wiki/Foo_(bar)) [bad](javascript:alert(1)) [local](file:///etc/passwd) [data](data:text/html,<script>) [mail](mailto:hi@example.com)"
        )
        XCTAssertEqual(tokens, [
            .link(
                label: "wiki",
                destination: "https://en.wikipedia.org/wiki/Foo_(bar)",
                safeURL: URL(string: "https://en.wikipedia.org/wiki/Foo_(bar)")
            ),
            .text(" "),
            .link(label: "bad", destination: "javascript:alert(1)", safeURL: nil),
            .text(" "),
            .link(label: "local", destination: "file:///etc/passwd", safeURL: nil),
            .text(" "),
            .link(label: "data", destination: "data:text/html,<script>", safeURL: nil),
            .text(" "),
            .link(
                label: "mail",
                destination: "mailto:hi@example.com",
                safeURL: URL(string: "mailto:hi@example.com")
            ),
        ])
    }

    func testBareURLAndWikiLinks() {
        let tokens = MarkdownParser.parseInline(
            "看 [[核心記憶|Core]] 或 https://example.com/a_(b)。還有 <mailto:test@example.com>"
        )
        XCTAssertEqual(tokens, [
            .text("看 "),
            .wikiLink(target: "核心記憶", label: "Core"),
            .text(" 或 "),
            .link(
                label: "https://example.com/a_(b)",
                destination: "https://example.com/a_(b)",
                safeURL: URL(string: "https://example.com/a_(b)")
            ),
            .text("。還有 "),
            .link(
                label: "test@example.com",
                destination: "mailto:test@example.com",
                safeURL: URL(string: "mailto:test@example.com")
            ),
        ])
    }

    func testStreamingPartialDelimitersAndOversizedFallback() {
        XCTAssertEqual(MarkdownParser.parseInline("Hello **unclosed"), [.text("Hello **unclosed")])
        XCTAssertEqual(MarkdownParser.parseInline("See [pending](https://example.com"), [.text("See [pending](https://example.com")])

        let huge = String(repeating: "* ", count: (MarkdownParser.maxInputCharacters / 2) + 50)
        XCTAssertGreaterThan(huge.count, MarkdownParser.maxInputCharacters)
        XCTAssertEqual(MarkdownParser.parseBlocks(huge), [.paragraph(huge)])
        XCTAssertEqual(MarkdownParser.parseInline(huge), [.text(huge)])
    }

    func testAdversarialRepeatedUnclosedDelimitersFinishFast() {
        let pathological = String(repeating: "**", count: 5_000)
        let tokens = MarkdownParser.parseInline(pathological)
        // 成對時是強強調或未配對純文字，重點是線性時間內安全結束
        XCTAssertFalse(tokens.isEmpty)
    }

    // MARK: - AttributedString 建構

    func testAttributedStringOnlyAttachesSafeAndEnabledWikiLinks() {
        let source = "[ok](https://example.com) [evil](javascript:alert(1)) [[Note A]]"

        let withoutWiki = MarkdownTextBuilder.attributedString(from: source, enableWikiLinks: false)
        let withoutLinks = withoutWiki.runs.compactMap(\.link)
        XCTAssertEqual(withoutLinks, [URL(string: "https://example.com")!])

        let withWiki = MarkdownTextBuilder.attributedString(from: source, enableWikiLinks: true)
        let withLinks = withWiki.runs.compactMap(\.link)
        XCTAssertEqual(withLinks.count, 2)
        XCTAssertEqual(withLinks[0], URL(string: "https://example.com")!)
        XCTAssertEqual(MarkdownTextBuilder.wikiTarget(from: withLinks[1]), "Note A")
        XCTAssertNil(MarkdownTextBuilder.wikiTarget(from: URL(string: "https://example.com")!))
    }
}
