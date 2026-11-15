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

    /// 各文字樣式的字級。比 macOS 預設略大，配合圓體與寬鬆的色塊。
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
        let size: CGFloat
        let weight: CGFloat
        let monospacedDigits: Bool
    }

    private static let lock = NSLock()
    private static var cache: [CacheKey: NSFont] = [:]

    /// 拉丁圓體加中文圓體遞補的字型。
    static func nsFont(size: CGFloat, weight: Font.Weight, monospacedDigits: Bool = false) -> NSFont {
        let nsWeight = weight.nsWeight
        let key = CacheKey(size: size, weight: nsWeight.rawValue, monospacedDigits: monospacedDigits)
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[key] { return cached }

        let base = NSFont.systemFont(ofSize: size, weight: nsWeight)
        var descriptor = base.fontDescriptor.withDesign(.rounded) ?? base.fontDescriptor
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
        descriptor = descriptor.addingAttributes(attributes)
        let font = NSFont(descriptor: descriptor, size: size) ?? base
        cache[key] = font
        return font
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
    /// 主題字型。取代 `.caption`、`.headline` 這些系統樣式。
    static func cardiary(
        _ style: Font.TextStyle,
        weight: Font.Weight? = nil,
        monospacedDigits: Bool = false
    ) -> Font {
        Font(ThemeTypography.nsFont(
            size: ThemeTypography.size(for: style),
            weight: weight ?? ThemeTypography.defaultWeight(for: style),
            monospacedDigits: monospacedDigits
        ) as CTFont)
    }

    /// 指定字級的主題字型，給格子裡的小字用。
    static func cardiary(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font(ThemeTypography.nsFont(size: size, weight: weight) as CTFont)
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
