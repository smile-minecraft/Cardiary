import AppKit
import SwiftUI

/// 原生 Markdown 檢視元件：支援標題、段落、行內樣式、清單、任務框、引言、
/// 圍欄程式碼區塊（含單鍵複製）、GFM 表格與雙向連結，完全跟隨 Cardiary 主題與縮放。
public struct MarkdownView: View {
    public let text: String
    public var baseStyle: Font.TextStyle = .body
    public var textColor: Color = Palette.ink
    public var onWikiLink: ((String) -> Void)?

    @Environment(\.cardiaryScale) private var uiScale
    @Environment(\.openURL) private var parentOpenURL

    public init(
        text: String,
        baseStyle: Font.TextStyle = .body,
        textColor: Color = Palette.ink,
        onWikiLink: ((String) -> Void)? = nil
    ) {
        self.text = text
        self.baseStyle = baseStyle
        self.textColor = textColor
        self.onWikiLink = onWikiLink
    }

    public var body: some View {
        let blocks = MarkdownParser.parseBlocks(text)
        VStack(alignment: .leading, spacing: blockSpacing) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .textSelection(.enabled)
        .environment(\.openURL, OpenURLAction { url in
            if let target = MarkdownTextBuilder.wikiTarget(from: url) {
                if let onWikiLink {
                    onWikiLink(target)
                    return .handled
                }
                return .discarded
            }
            guard let scheme = url.scheme?.lowercased(),
                scheme == "http" || scheme == "https" || scheme == "mailto"
            else {
                return .discarded
            }
            parentOpenURL(url)
            return .handled
        })
    }

    private var scaleFactor: CGFloat {
        min(2.0, max(0.75, uiScale))
    }

    private var blockSpacing: CGFloat {
        8 * scaleFactor
    }

    private func blockView(_ block: MarkdownBlock) -> AnyView {
        switch block {
        case .heading(let level, let content):
            return AnyView(headingView(level: level, content: content))
        case .paragraph(let content):
            return AnyView(inlineText(content, style: baseStyle, color: textColor))
        case .codeBlock(let language, let code, _):
            return AnyView(MarkdownCodeBlockView(language: language, code: code))
        case .blockquote(let inner):
            return AnyView(blockquoteView(inner))
        case .list(_, let items):
            return AnyView(listView(items))
        case .table(let headers, let alignments, let rows):
            return AnyView(tableView(headers: headers, alignments: alignments, rows: rows))
        case .thematicBreak:
            return AnyView(
                Capsule(style: .continuous)
                    .fill(Palette.hover)
                    .frame(height: 2)
                    .padding(.vertical, 2)
            )
        }
    }

    private func headingView(level: Int, content: String) -> some View {
        let style: Font.TextStyle
        let weight: Font.Weight
        switch level {
        case 1:
            style = .title2
            weight = .bold
        case 2:
            style = .title3
            weight = .bold
        case 3:
            style = .headline
            weight = .bold
        default:
            style = .callout
            weight = .semibold
        }
        return inlineText(content, style: style, weight: weight, color: textColor)
            .padding(.top, level <= 2 ? 3 : 1)
    }

    private func inlineText(
        _ raw: String,
        style: Font.TextStyle,
        weight: Font.Weight? = nil,
        color: Color
    ) -> some View {
        Text(MarkdownTextBuilder.attributedString(
            from: raw,
            baseStyle: style,
            baseWeight: weight,
            textColor: color,
            uiScale: uiScale,
            enableWikiLinks: onWikiLink != nil
        ))
        .lineSpacing(3.5 * scaleFactor)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func blockquoteView(_ inner: [MarkdownBlock]) -> some View {
        HStack(alignment: .top, spacing: DesignTokens.spacingS) {
            Capsule(style: .continuous)
                .fill(Palette.red.opacity(0.45))
                .frame(width: 3)
            VStack(alignment: .leading, spacing: blockSpacing * 0.75) {
                ForEach(Array(inner.enumerated()), id: \.offset) { _, nested in
                    nestedBlockView(nested)
                }
            }
        }
        .padding(.horizontal, DesignTokens.spacingM)
        .padding(.vertical, DesignTokens.spacingS)
        .background(
            Palette.sunken.opacity(0.55),
            in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous)
        )
    }

    private func nestedBlockView(_ block: MarkdownBlock) -> AnyView {
        switch block {
        case .paragraph(let content):
            return AnyView(inlineText(content, style: baseStyle, color: Palette.inkSecondary))
        case .heading(let level, let content):
            return AnyView(headingView(level: level, content: content))
        case .codeBlock(let language, let code, _):
            return AnyView(MarkdownCodeBlockView(language: language, code: code))
        case .blockquote(let deep):
            return AnyView(blockquoteView(deep))
        case .list(_, let items):
            return AnyView(listView(items))
        case .table(let headers, let alignments, let rows):
            return AnyView(tableView(headers: headers, alignments: alignments, rows: rows))
        case .thematicBreak:
            return AnyView(Capsule(style: .continuous).fill(Palette.hover).frame(height: 2))
        }
    }

    private func listView(_ items: [MarkdownListItem]) -> some View {
        var counters: [Int: Int] = [:]
        let prepared: [(item: MarkdownListItem, labelNumber: Int?)] = items.map { item in
            for level in counters.keys where level > item.indent {
                counters.removeValue(forKey: level)
            }
            if let explicit = item.number {
                let next = counters[item.indent].map { $0 + 1 } ?? explicit
                counters[item.indent] = next
                return (item, next)
            }
            return (item, nil)
        }

        return VStack(alignment: .leading, spacing: 4 * scaleFactor) {
            ForEach(Array(prepared.enumerated()), id: \.offset) { _, entry in
                listRow(entry.item, number: entry.labelNumber)
            }
        }
    }

    private func listRow(_ item: MarkdownListItem, number: Int?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6 * scaleFactor) {
            if let checked = item.taskChecked {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .cardiarySymbolFont(size: 11, weight: .semibold)
                    .foregroundStyle(checked ? Palette.sageInk : Palette.inkTertiary)
            } else if let number {
                Text("\(number).")
                    .cardiaryFont(baseStyle, weight: .semibold, monospacedDigits: true)
                    .foregroundStyle(Palette.redInk)
            } else {
                Text(bulletGlyph(for: item.indent))
                    .cardiaryFont(baseStyle, weight: .bold)
                    .foregroundStyle(Palette.redInk)
            }

            inlineText(item.text, style: baseStyle, color: textColor)
        }
        .padding(.leading, CGFloat(item.indent) * 16 * scaleFactor)
    }

    private func bulletGlyph(for indent: Int) -> String {
        switch indent % 3 {
        case 0: return "•"
        case 1: return "◦"
        default: return "▪"
        }
    }

    private func tableView(
        headers: [String],
        alignments: [MarkdownTableAlignment],
        rows: [[String]]
    ) -> some View {
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(headers.enumerated()), id: \.offset) { col, header in
                        tableCell(
                            header,
                            alignment: alignments[safe: col] ?? .leading,
                            isHeader: true
                        )
                    }
                }
                .background(Palette.hover.opacity(0.75))

                ForEach(Array(rows.enumerated()), id: \.offset) { rowIdx, row in
                    GridRow {
                        ForEach(Array(headers.indices), id: \.self) { col in
                            tableCell(
                                row[safe: col] ?? "",
                                alignment: alignments[safe: col] ?? .leading,
                                isHeader: false
                            )
                        }
                    }
                    .background(rowIdx.isMultiple(of: 2) ? Palette.surface.opacity(0.55) : Color.clear)
                }
            }
            .background(Palette.sunken)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
        }
    }

    private func tableCell(
        _ content: String,
        alignment: MarkdownTableAlignment,
        isHeader: Bool
    ) -> some View {
        Text(MarkdownTextBuilder.attributedString(
            from: content,
            baseStyle: .callout,
            baseWeight: isHeader ? .semibold : .regular,
            textColor: textColor,
            uiScale: uiScale,
            enableWikiLinks: onWikiLink != nil
        ))
        .multilineTextAlignment(textAlignment(alignment))
        .frame(maxWidth: .infinity, alignment: frameAlignment(alignment))
        .padding(.horizontal, 10 * scaleFactor)
        .padding(.vertical, 6 * scaleFactor)
    }

    private func frameAlignment(_ alignment: MarkdownTableAlignment) -> Alignment {
        switch alignment {
        case .leading: return .leading
        case .center: return .center
        case .trailing: return .trailing
        }
    }

    private func textAlignment(_ alignment: MarkdownTableAlignment) -> TextAlignment {
        switch alignment {
        case .leading: return .leading
        case .center: return .center
        case .trailing: return .trailing
        }
    }
}

/// 圍欄程式碼區塊：暖色凹陷色塊、語言標籤與單鍵複製按鈕。
private struct MarkdownCodeBlockView: View {
    let language: String?
    let code: String

    @State private var copied = false
    @Environment(\.cardiaryScale) private var uiScale

    var body: some View {
        let paddingScale = min(1.3, max(0.85, uiScale))
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: DesignTokens.spacingS) {
                Text(language?.isEmpty == false ? language! : AppL10n.text(.markdownCodeBlock))
                    .cardiaryFont(.caption2, weight: .semibold)
                    .foregroundStyle(Palette.inkSecondary)
                Spacer(minLength: 8)
                Button {
                    copyCode()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .cardiarySymbolFont(size: 9, weight: .bold)
                        Text(AppL10n.text(copied ? .markdownCopied : .markdownCopyCode))
                    }
                }
                .buttonStyle(ThemeButtonStyle(kind: copied ? .soft : .quiet, tone: copied ? .sage : .gray))
                .controlSize(.mini)
            }
            .padding(.horizontal, 10 * paddingScale)
            .padding(.vertical, 6 * paddingScale)
            .background(Palette.hover.opacity(0.6))

            ScrollView(.horizontal, showsIndicators: true) {
                Text(code.isEmpty ? " " : code)
                    .cardiaryMonospacedFont(.callout)
                    .foregroundStyle(Palette.ink)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10 * paddingScale)
            }
        }
        .background(
            Palette.sunken,
            in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous)
        )
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
    }

    private func copyCode() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(code, forType: .string)
        copied = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
