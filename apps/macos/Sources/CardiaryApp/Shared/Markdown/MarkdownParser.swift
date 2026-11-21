import Foundation

/// Markdown 表格欄位的對齊方向。
public enum MarkdownTableAlignment: Equatable, Sendable {
    case leading
    case center
    case trailing
}

/// 清單的單一項目（支援縮排、編號與任務勾選框）。
public struct MarkdownListItem: Equatable, Sendable {
    public let indent: Int
    public let number: Int?
    public let taskChecked: Bool?
    public let text: String

    public init(indent: Int, number: Int?, taskChecked: Bool?, text: String) {
        self.indent = indent
        self.number = number
        self.taskChecked = taskChecked
        self.text = text
    }
}

/// Markdown 的區塊級語法節點。
public enum MarkdownBlock: Equatable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case codeBlock(language: String?, code: String, isClosed: Bool)
    case blockquote([MarkdownBlock])
    case list(ordered: Bool, items: [MarkdownListItem])
    case table(headers: [String], alignments: [MarkdownTableAlignment], rows: [[String]])
    case thematicBreak
}

/// Markdown 的行內語法節點。
public enum MarkdownInlineToken: Equatable, Sendable {
    case text(String)
    case code(String)
    case strong([MarkdownInlineToken])
    case emphasis([MarkdownInlineToken])
    case strikethrough([MarkdownInlineToken])
    case link(label: String, destination: String, safeURL: URL?)
    case wikiLink(target: String, label: String)
}

/// 輕量、線性時間的 Markdown 解析器。
///
/// 專為串流對話、記憶卡片與通知內容設計：支援未閉合的圍欄程式碼區塊與不完整標記，
/// 並對超大輸入、巢狀深度與表格欄數設上限，避免惡意或異常內容拖慢主執行緒。
public enum MarkdownParser {
    public static let maxInputCharacters = 200_000
    public static let maxBlockquoteDepth = 4
    public static let maxInlineDepth = 6
    public static let maxListIndent = 4
    public static let maxTableColumns = 32
    public static let maxTableRows = 500

    private static let allowedSchemes: Set<String> = ["http", "https", "mailto"]
    private static let trailingURLPunctuation: Set<Character> = [
        ".", ",", ";", ":", "!", "?", ")", "]", "}", "\"", "'",
        "。", "，", "；", "：", "！", "？", "）", "】", "」", "』", "》",
    ]
    private static let escapablePunctuation: Set<Character> = Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")

    // MARK: - 網址驗證

    /// 只放行 `http`、`https`（必須含有效主機名稱）與非空的 `mailto` 連結，
    /// 封鎖 `javascript:`、`file:`、`data:` 與其他不明協定。
    public static func safeURL(from raw: String) -> URL? {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("<"), trimmed.hasSuffix(">"), trimmed.count >= 2 {
            trimmed = String(trimmed.dropFirst().dropLast())
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard !trimmed.isEmpty,
            trimmed.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7F }),
            let url = URL(string: trimmed),
            let scheme = url.scheme?.lowercased(),
            allowedSchemes.contains(scheme)
        else {
            return nil
        }
        if scheme == "http" || scheme == "https" {
            guard let host = url.host, !host.isEmpty else { return nil }
            return url
        }
        // mailto: 必須帶收件地址或查詢參數，不能只有 `mailto:`
        let remainder = trimmed.dropFirst("mailto:".count)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !remainder.isEmpty else { return nil }
        return url
    }

    // MARK: - 區塊解析

    /// 將 Markdown 原文拆為區塊清單；超過字元上限時退回純文字段落。
    public static func parseBlocks(_ source: String) -> [MarkdownBlock] {
        guard !source.isEmpty else { return [] }
        guard source.count <= maxInputCharacters else {
            return [.paragraph(source)]
        }
        let normalized = source
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false)
        return parseLines(lines, depth: 0)
    }

    private static func parseLines(_ lines: [Substring], depth: Int) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]

            if isBlank(line) {
                index += 1
                continue
            }

            if let fence = parseFenceOpening(line) {
                let result = consumeFencedCodeBlock(lines, start: index, fence: fence)
                blocks.append(result.block)
                index = result.nextIndex
                continue
            }

            if let heading = parseATXHeading(line) {
                blocks.append(heading)
                index += 1
                continue
            }

            if isThematicBreak(line) {
                blocks.append(.thematicBreak)
                index += 1
                continue
            }

            if depth < maxBlockquoteDepth, isBlockquoteLine(line) {
                let result = consumeBlockquote(lines, start: index, depth: depth)
                blocks.append(result.block)
                index = result.nextIndex
                continue
            }

            if let tableResult = consumeTableIfPresent(lines, start: index) {
                blocks.append(tableResult.block)
                index = tableResult.nextIndex
                continue
            }

            if parseListLine(line) != nil {
                let result = consumeList(lines, start: index, depth: depth)
                blocks.append(result.block)
                index = result.nextIndex
                continue
            }

            let result = consumeParagraph(lines, start: index, depth: depth)
            blocks.append(result.block)
            index = result.nextIndex
        }

        return blocks
    }

    // MARK: - 圍欄程式碼

    private struct FenceOpening {
        let character: Character
        let length: Int
        let language: String?
    }

    private static func parseFenceOpening(_ line: Substring) -> FenceOpening? {
        let trimmedLead = dropUpToThreeSpaces(line)
        guard let first = trimmedLead.first, first == "`" || first == "~" else { return nil }
        let fenceCount = trimmedLead.prefix { $0 == first }.count
        guard fenceCount >= 3 else { return nil }
        let rest = trimmedLead.dropFirst(fenceCount)
        if first == "`", rest.contains("`") {
            return nil
        }
        let infoToken = rest
            .trimmingCharacters(in: .whitespaces)
            .split(whereSeparator: { $0.isWhitespace })
            .first
            .map(String.init)
        return FenceOpening(character: first, length: fenceCount, language: infoToken)
    }

    private static func isFenceClosing(_ line: Substring, fence: FenceOpening) -> Bool {
        let trimmedLead = dropUpToThreeSpaces(line)
        guard trimmedLead.first == fence.character else { return false }
        let count = trimmedLead.prefix { $0 == fence.character }.count
        guard count >= fence.length else { return false }
        return trimmedLead.dropFirst(count).allSatisfy(\.isWhitespace)
    }

    private static func consumeFencedCodeBlock(
        _ lines: [Substring],
        start: Int,
        fence: FenceOpening
    ) -> (block: MarkdownBlock, nextIndex: Int) {
        var bodyLines: [Substring] = []
        var index = start + 1
        var isClosed = false

        while index < lines.count {
            if isFenceClosing(lines[index], fence: fence) {
                isClosed = true
                index += 1
                break
            }
            bodyLines.append(lines[index])
            index += 1
        }

        let code = bodyLines.joined(separator: "\n")
        return (.codeBlock(language: fence.language, code: code, isClosed: isClosed), index)
    }

    // MARK: - 標題與分隔線

    private static func parseATXHeading(_ line: Substring) -> MarkdownBlock? {
        let rest = dropUpToThreeSpaces(line)
        let level = rest.prefix { $0 == "#" }.count
        guard (1...6).contains(level) else { return nil }
        let afterHashes = rest.dropFirst(level)
        guard let firstAfter = afterHashes.first, firstAfter == " " || firstAfter == "\t" else {
            return nil
        }
        var content = afterHashes.drop { $0 == " " || $0 == "\t" }
        while let last = content.last, last == " " || last == "\t" {
            content = content.dropLast()
        }
        // 去掉結尾裝飾用且前面帶空白的 `#`
        let trimmedTrailing = content.reversed().drop { $0 == "#" }
        if trimmedTrailing.count < content.count {
            if trimmedTrailing.isEmpty {
                content = ""
            } else if let beforeHashes = trimmedTrailing.first, beforeHashes == " " || beforeHashes == "\t" {
                content = Substring(trimmedTrailing.reversed())
                    .trimmingCharacters(in: .whitespaces)[...]
            }
        }
        return .heading(level: level, text: String(content))
    }

    private static func isThematicBreak(_ line: Substring) -> Bool {
        let rest = dropUpToThreeSpaces(line)
        var symbol: Character?
        var count = 0
        for ch in rest {
            if ch == " " || ch == "\t" { continue }
            guard ch == "-" || ch == "*" || ch == "_" else { return false }
            if let existing = symbol, existing != ch { return false }
            symbol = ch
            count += 1
        }
        return count >= 3
    }

    // MARK: - 引言

    private static func isBlockquoteLine(_ line: Substring) -> Bool {
        dropUpToThreeSpaces(line).first == ">"
    }

    private static func stripBlockquoteMarker(_ line: Substring) -> Substring {
        let rest = dropUpToThreeSpaces(line)
        guard rest.first == ">" else { return line }
        let after = rest.dropFirst()
        if after.first == " " || after.first == "\t" {
            return after.dropFirst()
        }
        return after
    }

    private static func consumeBlockquote(
        _ lines: [Substring],
        start: Int,
        depth: Int
    ) -> (block: MarkdownBlock, nextIndex: Int) {
        var inner: [Substring] = []
        var index = start
        while index < lines.count, isBlockquoteLine(lines[index]) {
            inner.append(stripBlockquoteMarker(lines[index]))
            index += 1
        }
        let children = parseLines(inner, depth: depth + 1)
        return (.blockquote(children), index)
    }

    // MARK: - 表格

    private static func consumeTableIfPresent(
        _ lines: [Substring],
        start: Int
    ) -> (block: MarkdownBlock, nextIndex: Int)? {
        guard start + 1 < lines.count else { return nil }
        let headerLine = lines[start]
        let separatorLine = lines[start + 1]
        guard headerLine.contains("|"),
            let alignments = parseTableSeparator(separatorLine)
        else {
            return nil
        }

        let rawHeaders = splitTableCells(headerLine)
        guard rawHeaders.count == alignments.count,
            (1...maxTableColumns).contains(rawHeaders.count)
        else {
            return nil
        }

        var rows: [[String]] = []
        var index = start + 2
        while index < lines.count, rows.count < maxTableRows {
            let candidate = lines[index]
            if isBlank(candidate) || !candidate.contains("|") { break }
            if parseFenceOpening(candidate) != nil || parseATXHeading(candidate) != nil { break }
            var cells = splitTableCells(candidate)
            if cells.count < alignments.count {
                cells.append(contentsOf: Array(repeating: "", count: alignments.count - cells.count))
            } else if cells.count > alignments.count {
                cells = Array(cells.prefix(alignments.count))
            }
            rows.append(cells)
            index += 1
        }

        return (.table(headers: rawHeaders, alignments: alignments, rows: rows), index)
    }

    private static func parseTableSeparator(_ line: Substring) -> [MarkdownTableAlignment]? {
        guard line.contains("|") else { return nil }
        let cells = splitTableCells(line)
        guard (1...maxTableColumns).contains(cells.count) else { return nil }

        var alignments: [MarkdownTableAlignment] = []
        alignments.reserveCapacity(cells.count)
        for cell in cells {
            let trimmed = cell.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { return nil }
            let startsColon = trimmed.hasPrefix(":")
            let endsColon = trimmed.hasSuffix(":")
            var core = Substring(trimmed)
            if startsColon { core = core.dropFirst() }
            if endsColon, !core.isEmpty { core = core.dropLast() }
            guard !core.isEmpty, core.allSatisfy({ $0 == "-" }) else { return nil }
            if startsColon && endsColon {
                alignments.append(.center)
            } else if endsColon {
                alignments.append(.trailing)
            } else {
                alignments.append(.leading)
            }
        }
        return alignments
    }

    static func splitTableCells(_ line: Substring) -> [String] {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let chars = Array(trimmed)
        var cells: [String] = []
        var current = ""
        var index = 0
        var inCode = false
        var tickRun = 0

        while index < chars.count {
            let ch = chars[index]
            if ch == "\\", index + 1 < chars.count, chars[index + 1] == "|" {
                current.append("|")
                index += 2
                continue
            }
            if ch == "`" {
                var count = 0
                while index + count < chars.count, chars[index + count] == "`" {
                    count += 1
                }
                if !inCode {
                    inCode = true
                    tickRun = count
                } else if count == tickRun {
                    inCode = false
                    tickRun = 0
                }
                current.append(String(repeating: "`", count: count))
                index += count
                continue
            }
            if ch == "|", !inCode {
                cells.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
                index += 1
                continue
            }
            current.append(ch)
            index += 1
        }
        cells.append(current.trimmingCharacters(in: .whitespaces))

        if trimmed.hasPrefix("|"), !cells.isEmpty {
            cells.removeFirst()
        }
        if trimmed.hasSuffix("|"), !trimmed.hasSuffix("\\|"), !cells.isEmpty {
            cells.removeLast()
        }
        return cells
    }

    // MARK: - 清單

    private struct ParsedListLine {
        let indent: Int
        let number: Int?
        let taskChecked: Bool?
        let text: String
    }

    private static func parseListLine(_ line: Substring) -> ParsedListLine? {
        var spaces = 0
        var rest = line
        while let ch = rest.first, ch == " " || ch == "\t" {
            spaces += (ch == "\t" ? 2 : 1)
            rest = rest.dropFirst()
        }
        let indent = min(maxListIndent, spaces / 2)

        var number: Int?
        var afterMarker: Substring

        if let first = rest.first, first == "-" || first == "*" || first == "+" {
            let tail = rest.dropFirst()
            guard let next = tail.first, next == " " || next == "\t" else { return nil }
            afterMarker = tail.dropFirst()
        } else {
            let digits = rest.prefix { $0.isASCII && $0.isNumber }
            guard !digits.isEmpty, digits.count <= 9 else { return nil }
            let afterDigits = rest.dropFirst(digits.count)
            guard let delim = afterDigits.first, delim == "." || delim == ")" else { return nil }
            let tail = afterDigits.dropFirst()
            guard let next = tail.first, next == " " || next == "\t" else { return nil }
            number = Int(digits)
            afterMarker = tail.dropFirst()
        }

        while let ch = afterMarker.first, ch == " " || ch == "\t" {
            afterMarker = afterMarker.dropFirst()
        }

        var taskChecked: Bool?
        var body = String(afterMarker)
        if body.hasPrefix("[ ] ") {
            taskChecked = false
            body = String(body.dropFirst(4))
        } else if body.hasPrefix("[x] ") || body.hasPrefix("[X] ") {
            taskChecked = true
            body = String(body.dropFirst(4))
        } else if body == "[ ]" {
            taskChecked = false
            body = ""
        } else if body == "[x]" || body == "[X]" {
            taskChecked = true
            body = ""
        }

        return ParsedListLine(indent: indent, number: number, taskChecked: taskChecked, text: body)
    }

    private static func consumeList(
        _ lines: [Substring],
        start: Int,
        depth: Int
    ) -> (block: MarkdownBlock, nextIndex: Int) {
        guard let firstItem = parseListLine(lines[start]) else {
            return (.paragraph(String(lines[start])), start + 1)
        }
        let isOrderedRoot = firstItem.number != nil
        var items: [MarkdownListItem] = []
        var index = start

        while index < lines.count {
            let current = lines[index]
            if isBlank(current) {
                if index + 1 < lines.count, parseListLine(lines[index + 1]) != nil {
                    index += 1
                    continue
                }
                break
            }

            if let parsed = parseListLine(current) {
                items.append(MarkdownListItem(
                    indent: parsed.indent,
                    number: parsed.number,
                    taskChecked: parsed.taskChecked,
                    text: parsed.text
                ))
                index += 1
                continue
            }

            // 縮排續行併入上一個項目（但遇到明確區塊起手式則結束清單）
            let hasIndent = current.first == " " || current.first == "\t"
            if hasIndent,
                !items.isEmpty,
                parseFenceOpening(current) == nil,
                parseATXHeading(current) == nil,
                !isThematicBreak(current),
                !(depth < maxBlockquoteDepth && isBlockquoteLine(current))
            {
                let last = items.removeLast()
                let trimmed = current.trimmingCharacters(in: .whitespaces)
                let combined = last.text.isEmpty ? trimmed : "\(last.text) \(trimmed)"
                items.append(MarkdownListItem(
                    indent: last.indent,
                    number: last.number,
                    taskChecked: last.taskChecked,
                    text: combined
                ))
                index += 1
                continue
            }

            break
        }

        return (.list(ordered: isOrderedRoot, items: items), index)
    }

    // MARK: - 段落

    private static func consumeParagraph(
        _ lines: [Substring],
        start: Int,
        depth: Int
    ) -> (block: MarkdownBlock, nextIndex: Int) {
        var collected: [Substring] = [lines[start]]
        var index = start + 1

        while index < lines.count {
            let candidate = lines[index]
            if isBlank(candidate) ||
                parseFenceOpening(candidate) != nil ||
                parseATXHeading(candidate) != nil ||
                isThematicBreak(candidate) ||
                (depth < maxBlockquoteDepth && isBlockquoteLine(candidate)) ||
                parseListLine(candidate) != nil ||
                consumeTableIfPresent(lines, start: index) != nil
            {
                break
            }
            collected.append(candidate)
            index += 1
        }

        return (.paragraph(collected.joined(separator: "\n")), index)
    }

    // MARK: - 行內解析

    /// 將行內文字解析成樣式節點，保證線性掃描與安全網址檢查。
    public static func parseInline(_ text: String, depth: Int = 0) -> [MarkdownInlineToken] {
        guard !text.isEmpty else { return [] }
        guard text.count <= maxInputCharacters else { return [.text(text)] }
        let chars = Array(text)
        var exhausted = Set<String>()
        return parseInline(chars, range: 0..<chars.count, depth: depth, exhausted: &exhausted)
    }

    private static func parseInline(
        _ chars: [Character],
        range: Range<Int>,
        depth: Int,
        exhausted: inout Set<String>
    ) -> [MarkdownInlineToken] {
        var tokens: [MarkdownInlineToken] = []
        var plain = ""
        var i = range.lowerBound

        func flushPlain() {
            if !plain.isEmpty {
                tokens.append(.text(plain))
                plain = ""
            }
        }

        while i < range.upperBound {
            let ch = chars[i]

            // 1. 反斜線跳脫
            if ch == "\\", i + 1 < range.upperBound, escapablePunctuation.contains(chars[i + 1]) {
                plain.append(chars[i + 1])
                i += 2
                continue
            }

            // 2. 行內程式碼
            if ch == "`" {
                if let span = parseCodeSpan(chars, from: i, limit: range.upperBound) {
                    flushPlain()
                    tokens.append(.code(span.content))
                    i = span.nextIndex
                } else {
                    let runLen = countRepeated("`", in: chars, from: i, limit: range.upperBound)
                    plain.append(contentsOf: chars[i..<(i + runLen)])
                    i += runLen
                }
                continue
            }

            // 3. Wikilink [[target]] / [[target|label]] 與 Markdown 連結 [label](url)
            if ch == "[" {
                if i + 1 < range.upperBound, chars[i + 1] == "[",
                    !exhausted.contains("[["),
                    let wiki = parseWikiLink(chars, from: i, limit: range.upperBound)
                {
                    flushPlain()
                    tokens.append(.wikiLink(target: wiki.target, label: wiki.label))
                    i = wiki.nextIndex
                    continue
                }
                if !exhausted.contains("[]("),
                    let link = parseMarkdownLink(chars, from: i, limit: range.upperBound, exhausted: &exhausted)
                {
                    flushPlain()
                    tokens.append(.link(label: link.label, destination: link.destination, safeURL: link.safeURL))
                    i = link.nextIndex
                    continue
                }
            }

            // 4. 尖括號自動連結 <https://...> / <mailto:...>
            if ch == "<", let auto = parseAngleAutolink(chars, from: i, limit: range.upperBound) {
                flushPlain()
                tokens.append(.link(label: auto.label, destination: auto.destination, safeURL: auto.safeURL))
                i = auto.nextIndex
                continue
            }

            // 5. 裸網址 https://... / http://...
            if ch == "h",
                isBareURLBoundary(chars, at: i, rangeStart: range.lowerBound),
                let bare = parseBareURL(chars, from: i, limit: range.upperBound)
            {
                flushPlain()
                tokens.append(.link(label: bare.urlString, destination: bare.urlString, safeURL: bare.safeURL))
                i = bare.nextIndex
                continue
            }

            // 6. 刪除線 ~~text~~
            if depth < maxInlineDepth,
                ch == "~", i + 1 < range.upperBound, chars[i + 1] == "~",
                !exhausted.contains("~~")
            {
                if let matchEnd = findSymmetricClose(
                    chars, delim: "~", count: 2,
                    openIndex: i, limit: range.upperBound,
                    requireBoundary: false, exhausted: &exhausted
                ) {
                    flushPlain()
                    let inner = parseInline(chars, range: (i + 2)..<matchEnd, depth: depth + 1, exhausted: &exhausted)
                    tokens.append(.strikethrough(inner))
                    i = matchEnd + 2
                    continue
                }
                plain.append("~~")
                i += 2
                continue
            }

            // 7. 粗體與斜體（*** / ** / * 與 ___ / __ / _）
            if depth < maxInlineDepth, (ch == "*" || ch == "_") {
                let runCount = min(3, countRepeated(ch, in: chars, from: i, limit: range.upperBound))
                let requireBoundary = (ch == "_")
                var matched = false

                // 優先從最長分隔符（3 → 2 → 1）嘗試，避免 `**bold**` 被單個 `*` 誤吞
                for len in stride(from: runCount, through: 1, by: -1) {
                    let delimKey = String(repeating: ch, count: len)
                    if exhausted.contains(delimKey) { continue }
                    if let matchEnd = findSymmetricClose(
                        chars, delim: ch, count: len,
                        openIndex: i, limit: range.upperBound,
                        requireBoundary: requireBoundary, exhausted: &exhausted
                    ) {
                        flushPlain()
                        let inner = parseInline(
                            chars,
                            range: (i + len)..<matchEnd,
                            depth: depth + 1,
                            exhausted: &exhausted
                        )
                        switch len {
                        case 3: tokens.append(.strong([.emphasis(inner)]))
                        case 2: tokens.append(.strong(inner))
                        default: tokens.append(.emphasis(inner))
                        }
                        i = matchEnd + len
                        matched = true
                        break
                    }
                }
                if matched { continue }
                plain.append(contentsOf: chars[i..<(i + runCount)])
                i += runCount
                continue
            }

            plain.append(ch)
            i += 1
        }

        flushPlain()
        return tokens
    }

    // MARK: - 行內輔助

    private static func parseCodeSpan(
        _ chars: [Character],
        from start: Int,
        limit: Int
    ) -> (content: String, nextIndex: Int)? {
        let ticks = countRepeated("`", in: chars, from: start, limit: limit)
        guard ticks > 0 else { return nil }
        var i = start + ticks
        while i < limit {
            if chars[i] == "`" {
                let closeTicks = countRepeated("`", in: chars, from: i, limit: limit)
                if closeTicks == ticks {
                    var content = String(chars[(start + ticks)..<i])
                    if content.count >= 2,
                        content.first == " ",
                        content.last == " ",
                        content.contains(where: { $0 != " " })
                    {
                        content = String(content.dropFirst().dropLast())
                    }
                    return (content, i + ticks)
                }
                i += closeTicks
            } else {
                i += 1
            }
        }
        return nil
    }

    private static func parseWikiLink(
        _ chars: [Character],
        from start: Int,
        limit: Int
    ) -> (target: String, label: String, nextIndex: Int)? {
        var i = start + 2
        while i + 1 < limit {
            let ch = chars[i]
            if ch == "\n" || ch == "[" { return nil }
            if ch == "]", chars[i + 1] == "]" {
                let raw = String(chars[(start + 2)..<i])
                let parts = raw.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false)
                let target = String(parts[0]).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !target.isEmpty else { return nil }
                let label: String
                if parts.count == 2 {
                    let custom = String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines)
                    label = custom.isEmpty ? target : custom
                } else {
                    label = target
                }
                return (target, label, i + 2)
            }
            i += 1
        }
        return nil
    }

    private static func parseMarkdownLink(
        _ chars: [Character],
        from start: Int,
        limit: Int,
        exhausted: inout Set<String>
    ) -> (label: String, destination: String, safeURL: URL?, nextIndex: Int)? {
        var i = start + 1
        var closeBracket: Int?

        while i < limit {
            let ch = chars[i]
            if ch == "\n" { return nil }
            if ch == "\\", i + 1 < limit {
                i += 2
                continue
            }
            if ch == "`", let span = parseCodeSpan(chars, from: i, limit: limit) {
                i = span.nextIndex
                continue
            }
            if ch == "[" {
                // 不允許巢狀未轉義的 `[` 跨入連結標題
                return nil
            }
            if ch == "]" {
                closeBracket = i
                break
            }
            i += 1
        }

        guard let bracketIndex = closeBracket else {
            exhausted.insert("[](")
            return nil
        }
        guard bracketIndex + 1 < limit, chars[bracketIndex + 1] == "(" else { return nil }

        let label = String(chars[(start + 1)..<bracketIndex])
        var destStart = bracketIndex + 2
        while destStart < limit, chars[destStart] == " " || chars[destStart] == "\t" {
            destStart += 1
        }

        var parenDepth = 0
        var j = destStart
        var closeParen: Int?
        while j < limit {
            let ch = chars[j]
            if ch == "\n" { return nil }
            if ch == "\\", j + 1 < limit {
                j += 2
                continue
            }
            if ch == "(" {
                parenDepth += 1
                if parenDepth > 4 { return nil }
            } else if ch == ")" {
                if parenDepth == 0 {
                    closeParen = j
                    break
                }
                parenDepth -= 1
            }
            j += 1
        }

        guard let parenIndex = closeParen else { return nil }
        let rawDestination = String(chars[destStart..<parenIndex])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rawDestination.isEmpty else { return nil }

        let url = safeURL(from: rawDestination)
        let displayLabel = label.isEmpty ? rawDestination : label
        return (displayLabel, rawDestination, url, parenIndex + 1)
    }

    private static func parseAngleAutolink(
        _ chars: [Character],
        from start: Int,
        limit: Int
    ) -> (label: String, destination: String, safeURL: URL, nextIndex: Int)? {
        var i = start + 1
        while i < limit {
            let ch = chars[i]
            if ch == "\n" || ch.isWhitespace || ch == "<" { return nil }
            if ch == ">" {
                let raw = String(chars[(start + 1)..<i])
                guard let url = safeURL(from: raw) else { return nil }
                let label = raw.hasPrefix("mailto:") ? String(raw.dropFirst("mailto:".count)) : raw
                return (label, raw, url, i + 1)
            }
            i += 1
        }
        return nil
    }

    private static func isBareURLBoundary(_ chars: [Character], at index: Int, rangeStart: Int) -> Bool {
        if index == rangeStart { return true }
        let prev = chars[index - 1]
        if prev == "(", index - 2 >= rangeStart, chars[index - 2] == "]" {
            // 未閉合的 Markdown 連結 `[text](url` 期間不要先把網址當成裸連結，避免串流閃爍
            return false
        }
        return prev.isWhitespace || prev == "(" || prev == "[" || prev == "（" || prev == "：" || prev == ":"
    }

    private static func parseBareURL(
        _ chars: [Character],
        from start: Int,
        limit: Int
    ) -> (urlString: String, safeURL: URL, nextIndex: Int)? {
        let restCount = limit - start
        guard restCount >= 8 else { return nil }
        let prefix = String(chars[start..<min(limit, start + 8)]).lowercased()
        guard prefix.hasPrefix("https://") || prefix.hasPrefix("http://") else { return nil }

        var end = start
        while end < limit {
            let ch = chars[end]
            guard let scalar = ch.unicodeScalars.first,
                ch.unicodeScalars.count == 1,
                scalar.value >= 0x21,
                scalar.value <= 0x7E
            else {
                break
            }
            if ch == "<" || ch == ">" || ch == "\"" || ch == "`" || ch == "{" || ch == "}" {
                break
            }
            end += 1
        }

        // 修剪句尾標點，但保留成對括號（例如 Wikipedia 連結）
        while end > start {
            let last = chars[end - 1]
            if last == ")" {
                let slice = chars[start..<end]
                let openCount = slice.filter { $0 == "(" }.count
                let closeCount = slice.filter { $0 == ")" }.count
                if closeCount <= openCount { break }
            }
            if trailingURLPunctuation.contains(last) {
                end -= 1
            } else {
                break
            }
        }

        let raw = String(chars[start..<end])
        guard let url = safeURL(from: raw) else { return nil }
        return (raw, url, end)
    }

    private static func findSymmetricClose(
        _ chars: [Character],
        delim: Character,
        count: Int,
        openIndex: Int,
        limit: Int,
        requireBoundary: Bool,
        exhausted: inout Set<String>
    ) -> Int? {
        let contentStart = openIndex + count
        guard contentStart < limit else { return nil }

        // 左界：緊鄰起手符號不可為空白或換行；底線型還要求左側不是 ASCII 英數字
        let firstInside = chars[contentStart]
        if firstInside.isWhitespace || firstInside == "\n" { return nil }
        if requireBoundary, openIndex > 0, isASCIIAlphaNum(chars[openIndex - 1]) { return nil }

        let delimKey = String(repeating: delim, count: count)
        var i = contentStart
        var sawCandidate = false

        while i + count <= limit {
            let ch = chars[i]
            if ch == "\n" { break }
            if ch == "\\", i + 1 < limit {
                i += 2
                continue
            }
            if ch == "`", let span = parseCodeSpan(chars, from: i, limit: limit) {
                i = span.nextIndex
                continue
            }
            if ch == delim {
                let run = countRepeated(delim, in: chars, from: i, limit: limit)
                if run >= count {
                    sawCandidate = true
                    let closeStart = (run == count) ? i : (i + run - count)
                    let beforeClose = chars[closeStart - 1]
                    let afterClose = closeStart + count
                    let rightBoundaryOK = !requireBoundary || afterClose >= limit || !isASCIIAlphaNum(chars[afterClose])
                    if closeStart > contentStart,
                        !beforeClose.isWhitespace,
                        rightBoundaryOK
                    {
                        return closeStart
                    }
                }
                i += run
                continue
            }
            i += 1
        }

        if !sawCandidate && !requireBoundary {
            exhausted.insert(delimKey)
        }
        return nil
    }

    // MARK: - 字元工具

    private static func dropUpToThreeSpaces(_ line: Substring) -> Substring {
        var rest = line
        var dropped = 0
        while dropped < 3, rest.first == " " {
            rest = rest.dropFirst()
            dropped += 1
        }
        return rest
    }

    private static func isBlank(_ line: Substring) -> Bool {
        line.allSatisfy { $0 == " " || $0 == "\t" }
    }

    private static func countRepeated(
        _ target: Character,
        in chars: [Character],
        from start: Int,
        limit: Int
    ) -> Int {
        var idx = start
        while idx < limit, chars[idx] == target {
            idx += 1
        }
        return idx - start
    }

    private static func isASCIIAlphaNum(_ ch: Character) -> Bool {
        ch.isASCII && (ch.isLetter || ch.isNumber)
    }
}
