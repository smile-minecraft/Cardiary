import AppKit
import CoreText
import SwiftUI

/// 圓體字型：拉丁字母用 SF Pro Rounded，中文接 macOS 內建的「圓體-繁」（Yuanti TC）。
///
/// 圓體-繁是系統的可下載字型，沒有安裝時 Core Text 會照原本的遞補規則改用蘋方，
/// 畫面不會缺字。`requestCJKDownloadIfNeeded()` 會請系統在背景下載；下載的字型由
/// macOS 管理，不落在 Cardiary 的資料夾。
public enum ThemeTypography {
    /// 中文圓體的 PostScript 名稱，依字重由細到粗。
    static let cjkLight = "STYuanti-TC-Light"
    static let cjkRegular = "STYuanti-TC-Regular"
    static let cjkBold = "STYuanti-TC-Bold"

    /// 各文字樣式的基準字級（100% 縮放時）。比 macOS 預設略大，配合圓體與寬鬆的色塊。
    static func size(for style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: return 28
        case .title: return 22
        case .title2: return 19
        case .title3: return 16
        case .headline: return 14
        case .subheadline: return 12.5
        case .body: return 14
        case .callout: return 13
        case .footnote: return 11.5
        case .caption: return 11.5
        case .caption2: return 10.5
        @unknown default: return 14
        }
    }

    static func defaultWeight(for style: Font.TextStyle) -> Font.Weight {
        switch style {
        case .headline: return .semibold
        case .largeTitle, .title: return .bold
        default: return .regular
        }
    }

    private struct CacheKey: Hashable {
        let halfPoints: Int
        let weight: CGFloat
        let italic: Bool
        let monospaced: Bool
        let monospacedDigits: Bool
    }

    private static let lock = NSLock()
    private static var cache: [CacheKey: NSFont] = [:]

    /// 依環境縮放夾緊字級並以 0.5 pt 粒度取整，讓快取保持有界且文字清晰。
    static func scaledPointSize(_ baseSize: CGFloat, scale: CGFloat) -> CGFloat {
        let safeScale = scale.isFinite ? min(2.5, max(0.5, scale)) : 1.0
        let raw = (baseSize.isFinite ? baseSize : 14) * safeScale
        let clamped = min(96, max(6, raw))
        return (clamped * 2).rounded() / 2
    }

    /// 拉丁圓體加中文圓體遞補的字型。
    static func nsFont(
        size: CGFloat,
        weight: Font.Weight,
        italic: Bool = false,
        monospacedDigits: Bool = false
    ) -> NSFont {
        let normalizedSize = scaledPointSize(size, scale: 1.0)
        let halfPoints = Int((normalizedSize * 2).rounded())
        let nsWeight = weight.nsWeight
        let key = CacheKey(
            halfPoints: halfPoints,
            weight: nsWeight.rawValue,
            italic: italic,
            monospaced: false,
            monospacedDigits: monospacedDigits
        )
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[key] { return cached }

        let base = NSFont.systemFont(ofSize: normalizedSize, weight: nsWeight)
        var descriptor = base.fontDescriptor.withDesign(.rounded) ?? base.fontDescriptor
        if italic {
            descriptor = descriptor.withSymbolicTraits(descriptor.symbolicTraits.union(.italic))
        }
        let attributes = cascadeAttributes(
            size: normalizedSize,
            nsWeight: nsWeight,
            monospacedDigits: monospacedDigits
        )
        descriptor = descriptor.addingAttributes(attributes)
        var font = NSFont(descriptor: descriptor, size: normalizedSize) ?? base
        if italic && !font.fontDescriptor.symbolicTraits.contains(.italic) {
            let converted = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask)
            if converted.fontDescriptor.symbolicTraits.contains(.italic) {
                let italicDescriptor = converted.fontDescriptor.addingAttributes(attributes)
                font = NSFont(descriptor: italicDescriptor, size: normalizedSize) ?? converted
            }
        }
        cache[key] = font
        return font
    }

    /// 等寬字型加中文遞補，供行內程式碼與程式碼區塊使用。
    static func monospacedNSFont(size: CGFloat, weight: Font.Weight = .regular) -> NSFont {
        let normalizedSize = scaledPointSize(size, scale: 1.0)
        let halfPoints = Int((normalizedSize * 2).rounded())
        let nsWeight = weight.nsWeight
        let key = CacheKey(
            halfPoints: halfPoints,
            weight: nsWeight.rawValue,
            italic: false,
            monospaced: true,
            monospacedDigits: false
        )
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[key] { return cached }

        let base = NSFont.monospacedSystemFont(ofSize: normalizedSize, weight: nsWeight)
        let attributes = cascadeAttributes(size: normalizedSize, nsWeight: nsWeight, monospacedDigits: false)
        let descriptor = base.fontDescriptor.addingAttributes(attributes)
        let font = NSFont(descriptor: descriptor, size: normalizedSize) ?? base
        cache[key] = font
        return font
    }

    private static func cascadeAttributes(
        size: CGFloat,
        nsWeight: NSFont.Weight,
        monospacedDigits: Bool
    ) -> [NSFontDescriptor.AttributeName: Any] {
        let cjkName: String
        if nsWeight.rawValue >= NSFont.Weight.semibold.rawValue {
            cjkName = cjkBold
        } else if nsWeight.rawValue <= NSFont.Weight.light.rawValue {
            cjkName = cjkLight
        } else {
            cjkName = cjkRegular
        }
        var attributes: [NSFontDescriptor.AttributeName: Any] = [
            .cascadeList: [NSFontDescriptor(name: cjkName, size: size)],
        ]
        if monospacedDigits {
            attributes[.featureSettings] = [[
                NSFontDescriptor.FeatureKey.typeIdentifier: kNumberSpacingType,
                NSFontDescriptor.FeatureKey.selectorIdentifier: kMonospacedNumbersSelector,
            ]]
        }
        return attributes
    }

    /// 圓體-繁沒有安裝時，請系統下載。只在 App 啟動時呼叫一次。
    public static func requestCJKDownloadIfNeeded() {
        guard NSFont(name: cjkRegular, size: 12) == nil else { return }
        let descriptors = [cjkLight, cjkRegular, cjkBold].map {
            CTFontDescriptorCreateWithNameAndSize($0 as CFString, 12)
        }
        CTFontDescriptorMatchFontDescriptorsWithProgressHandler(descriptors as CFArray, nil) { _, _ in
            true
        }
    }
}

extension Font {
    /// 主題字型。取代 `.caption`、`.headline` 這些系統樣式，支援縮放倍率。
    static func cardiary(
        _ style: Font.TextStyle,
        weight: Font.Weight? = nil,
        monospacedDigits: Bool = false,
        scale: CGFloat = 1.0
    ) -> Font {
        let scaled = ThemeTypography.scaledPointSize(ThemeTypography.size(for: style), scale: scale)
        return Font(ThemeTypography.nsFont(
            size: scaled,
            weight: weight ?? ThemeTypography.defaultWeight(for: style),
            monospacedDigits: monospacedDigits
        ) as CTFont)
    }

    /// 指定字級的主題字型，給格子與標題字標使用。
    static func cardiary(
        size: CGFloat,
        weight: Font.Weight = .regular,
        scale: CGFloat = 1.0
    ) -> Font {
        let scaled = ThemeTypography.scaledPointSize(size, scale: scale)
        return Font(ThemeTypography.nsFont(size: scaled, weight: weight) as CTFont)
    }

    /// 等寬主題字型，隨縮放倍率調整。
    static func cardiaryMonospaced(
        _ style: Font.TextStyle,
        weight: Font.Weight = .regular,
        scale: CGFloat = 1.0
    ) -> Font {
        let scaled = ThemeTypography.scaledPointSize(ThemeTypography.size(for: style), scale: scale)
        return Font(ThemeTypography.monospacedNSFont(size: scaled, weight: weight) as CTFont)
    }
}

private struct CardiaryFontStyleModifier: ViewModifier {
    let style: Font.TextStyle
    let weight: Font.Weight?
    let monospacedDigits: Bool
    @Environment(\.cardiaryScale) private var scale

    func body(content: Content) -> some View {
        content.font(.cardiary(style, weight: weight, monospacedDigits: monospacedDigits, scale: scale))
    }
}

private struct CardiaryFontSizeModifier: ViewModifier {
    let size: CGFloat
    let weight: Font.Weight
    @Environment(\.cardiaryScale) private var scale

    func body(content: Content) -> some View {
        content.font(.cardiary(size: size, weight: weight, scale: scale))
    }
}

private struct CardiaryMonospacedFontModifier: ViewModifier {
    let style: Font.TextStyle
    let weight: Font.Weight
    @Environment(\.cardiaryScale) private var scale

    func body(content: Content) -> some View {
        content.font(.cardiaryMonospaced(style, weight: weight, scale: scale))
    }
}

private struct CardiarySymbolFontModifier: ViewModifier {
    let size: CGFloat
    let weight: Font.Weight
    @Environment(\.cardiaryScale) private var scale

    func body(content: Content) -> some View {
        content.font(.system(size: ThemeTypography.scaledPointSize(size, scale: scale), weight: weight))
    }
}

extension View {
    /// 會跟隨 `EnvironmentValues.cardiaryScale` 即時縮放的主題字型。
    func cardiaryFont(
        _ style: Font.TextStyle,
        weight: Font.Weight? = nil,
        monospacedDigits: Bool = false
    ) -> some View {
        modifier(CardiaryFontStyleModifier(
            style: style,
            weight: weight,
            monospacedDigits: monospacedDigits
        ))
    }

    /// 指定基準字級並隨介面縮放的字型。
    func cardiaryFont(size: CGFloat, weight: Font.Weight = .regular) -> some View {
        modifier(CardiaryFontSizeModifier(size: size, weight: weight))
    }

    /// 會跟隨 `EnvironmentValues.cardiaryScale` 即時縮放的等寬字型。
    func cardiaryMonospacedFont(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> some View {
        modifier(CardiaryMonospacedFontModifier(style: style, weight: weight))
    }

    /// 會跟隨 `EnvironmentValues.cardiaryScale` 調整大小的符號字型。
    func cardiarySymbolFont(size: CGFloat, weight: Font.Weight = .regular) -> some View {
        modifier(CardiarySymbolFontModifier(size: size, weight: weight))
    }
}

private extension Font.Weight {
    var nsWeight: NSFont.Weight {
        switch self {
        case .ultraLight: return .ultraLight
        case .thin: return .thin
        case .light: return .light
        case .medium: return .medium
        case .semibold: return .semibold
        case .bold: return .bold
        case .heavy: return .heavy
        case .black: return .black
        default: return .regular
        }
    }
}
