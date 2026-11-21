import AppKit
import Foundation
import SwiftUI

/// 將 `MarkdownInlineToken` 轉成符合 Cardiary 暖色撲克牌主題的 `AttributedString`。
public enum MarkdownTextBuilder {
    private static let wikiScheme = "cardiary-wiki"

    /// 將單段行內語法串成可渲染、可點擊安全連結的 `AttributedString`。
    public static func attributedString(
        from text: String,
        baseStyle: Font.TextStyle = .body,
        baseWeight: Font.Weight? = nil,
        textColor: Color = Palette.ink,
        uiScale: CGFloat = 1.0,
        enableWikiLinks: Bool = false
    ) -> AttributedString {
        let tokens = MarkdownParser.parseInline(text)
        return build(
            tokens: tokens,
            baseStyle: baseStyle,
            baseWeight: baseWeight ?? ThemeTypography.defaultWeight(for: baseStyle),
            textColor: textColor,
            uiScale: uiScale,
            enableWikiLinks: enableWikiLinks
        )
    }

    /// 供單元測試與進階組合呼叫：直接將解析好的語法樹轉成 `AttributedString`。
    public static func build(
        tokens: [MarkdownInlineToken],
        baseStyle: Font.TextStyle = .body,
        baseWeight: Font.Weight = .regular,
        textColor: Color = Palette.ink,
        uiScale: CGFloat = 1.0,
        enableWikiLinks: Bool = false
    ) -> AttributedString {
        var result = AttributedString()
        let basePointSize = ThemeTypography.scaledPointSize(
            ThemeTypography.size(for: baseStyle),
            scale: uiScale
        )
        let style = TextStyle(
            pointSize: basePointSize,
            weight: baseWeight,
            italic: false,
            strikethrough: false,
            color: textColor
        )
        append(tokens, into: &result, style: style, enableWikiLinks: enableWikiLinks)
        return result
    }

    /// 若為內部產生的 `cardiary-wiki://` 連結，還原卡片目標名稱或識別碼。
    public static func wikiTarget(from url: URL) -> String? {
        guard url.scheme?.lowercased() == wikiScheme,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let raw = components.queryItems?.first(where: { $0.name == "target" })?.value
        else {
            return nil
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private struct TextStyle {
        let pointSize: CGFloat
        let weight: Font.Weight
        let italic: Bool
        let strikethrough: Bool
        let color: Color

        var resolvedFont: Font {
            Font(ThemeTypography.nsFont(
                size: pointSize,
                weight: weight,
                italic: italic
            ) as CTFont)
        }
    }

    private static func append(
        _ tokens: [MarkdownInlineToken],
        into output: inout AttributedString,
        style: TextStyle,
        enableWikiLinks: Bool
    ) {
        for token in tokens {
            switch token {
            case .text(let value):
                var segment = AttributedString(value)
                segment.font = style.resolvedFont
                segment.foregroundColor = style.color
                if style.strikethrough {
                    segment.strikethroughStyle = .single
                }
                output.append(segment)

            case .code(let value):
                var segment = AttributedString(" \(value) ")
                let codeSize = max(8, style.pointSize * 0.92)
                segment.font = Font(ThemeTypography.monospacedNSFont(
                    size: codeSize,
                    weight: style.weight
                ) as CTFont)
                segment.foregroundColor = Palette.purpleInk
                segment.backgroundColor = Palette.sunken
                if style.strikethrough {
                    segment.strikethroughStyle = .single
                }
                output.append(segment)

            case .strong(let inner):
                let nextStyle = TextStyle(
                    pointSize: style.pointSize,
                    weight: boldWeight(from: style.weight),
                    italic: style.italic,
                    strikethrough: style.strikethrough,
                    color: style.color
                )
                append(inner, into: &output, style: nextStyle, enableWikiLinks: enableWikiLinks)

            case .emphasis(let inner):
                let nextStyle = TextStyle(
                    pointSize: style.pointSize,
                    weight: style.weight,
                    italic: true,
                    strikethrough: style.strikethrough,
                    color: style.color
                )
                append(inner, into: &output, style: nextStyle, enableWikiLinks: enableWikiLinks)

            case .strikethrough(let inner):
                let nextStyle = TextStyle(
                    pointSize: style.pointSize,
                    weight: style.weight,
                    italic: style.italic,
                    strikethrough: true,
                    color: style.color
                )
                append(inner, into: &output, style: nextStyle, enableWikiLinks: enableWikiLinks)

            case .link(let label, let destination, let safeURL):
                let display = label.isEmpty ? destination : label
                var segment = AttributedString(display)
                segment.font = style.resolvedFont
                if style.strikethrough {
                    segment.strikethroughStyle = .single
                }
                if let safeURL {
                    segment.link = safeURL
                    segment.foregroundColor = Palette.redInk
                    segment.underlineStyle = .single
                } else {
                    // 不安全或無效的網址一律降為純文字，不掛 .link
                    segment.foregroundColor = style.color
                }
                output.append(segment)

            case .wikiLink(let target, let label):
                var segment = AttributedString(label)
                segment.font = Font(ThemeTypography.nsFont(
                    size: style.pointSize,
                    weight: .semibold,
                    italic: style.italic
                ) as CTFont)
                segment.foregroundColor = Palette.pinkInk
                if style.strikethrough {
                    segment.strikethroughStyle = .single
                }
                if enableWikiLinks, let url = internalWikiURL(target: target) {
                    segment.link = url
                    segment.underlineStyle = .single
                }
                output.append(segment)
            }
        }
    }

    private static func boldWeight(from current: Font.Weight) -> Font.Weight {
        switch current {
        case .heavy, .black: return current
        case .semibold: return .bold
        default: return .semibold
        }
    }

    private static func internalWikiURL(target: String) -> URL? {
        var components = URLComponents()
        components.scheme = wikiScheme
        components.host = "card"
        components.queryItems = [URLQueryItem(name: "target", value: target)]
        return components.url
    }
}
