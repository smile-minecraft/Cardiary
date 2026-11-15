import AppKit
import CardiaryKit
import SwiftUI

/// 撲克牌主題的配色。米白底、低飽和暖色、扁平色塊；深色模式換成暖色調的深底。
///
/// 畫面只用這裡的顏色，不直接寫 `.red`、`.orange` 或系統的 `controlBackgroundColor`。
public enum Palette {
    // MARK: 底色與文字

    /// 主內容的米白底。
    public static let canvas = dynamic(light: 0xF8F1EA, dark: 0x2A2225)
    /// 左側欄與檢視欄的底，比主內容略帶粉。
    public static let sidebar = dynamic(light: 0xF3E6E1, dark: 0x241D20)
    /// 卡片、面板等浮在底上的色塊。
    public static let surface = dynamic(light: 0xFFFBF7, dark: 0x362C30)
    /// 輸入框與色塊內的凹陷區。
    public static let sunken = dynamic(light: 0xF0E5DE, dark: 0x30272B)
    /// 懸停時疊上的一層。
    public static let hover = dynamic(light: 0xEADCD5, dark: 0x40353A)

    /// 主要文字：帶紫的暖深棕，不用純黑。
    public static let ink = dynamic(light: 0x4B3B3E, dark: 0xF3E7E3)
    public static let inkSecondary = dynamic(light: 0x8C7B7D, dark: 0xBBA9A9)
    public static let inkTertiary = dynamic(light: 0xB7A8A8, dark: 0x85777A)
    /// 實色色塊上的文字。
    public static let onAccent = dynamic(light: 0xFFFFFF, dark: 0xFFF8F5)

    // MARK: 主題色（低飽和）

    /// 紅心：主色。
    public static let red = dynamic(light: 0xC9625F, dark: 0xD8746F)
    public static let redSoft = dynamic(light: 0xF4DCD8, dark: 0x563337)
    /// 黑桃：灰。
    public static let gray = dynamic(light: 0x8F8587, dark: 0xA0959A)
    public static let graySoft = dynamic(light: 0xE9E1DF, dark: 0x3E3538)
    /// 方塊：橘。
    public static let orange = dynamic(light: 0xE3A06D, dark: 0xE8A673)
    public static let orangeSoft = dynamic(light: 0xF8E4D2, dark: 0x54402F)
    /// 梅花：粉。
    public static let pink = dynamic(light: 0xDE9FA7, dark: 0xD99AA3)
    public static let pinkSoft = dynamic(light: 0xF7DEE1, dark: 0x52363C)
    /// 紫：輔助色，不屬於任何花色。
    public static let purple = dynamic(light: 0xA88BAE, dark: 0xB49ABA)
    public static let purpleSoft = dynamic(light: 0xECE0EE, dark: 0x45384A)
    /// 鼠尾草綠：只用在「成功」。
    public static let sage = dynamic(light: 0x8FA886, dark: 0x9BB592)
    public static let sageSoft = dynamic(light: 0xE3EBDD, dark: 0x34402F)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(rgb: isDark ? dark : light)
        })
    }
}

private extension NSColor {
    convenience init(rgb: UInt32) {
        self.init(
            srgbRed: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}

/// 一組實色加淺色。色塊、標籤、按鈕都從這裡挑。
public enum Tone: CaseIterable, Sendable {
    case red, gray, orange, pink, purple, sage

    public var color: Color {
        switch self {
        case .red: return Palette.red
        case .gray: return Palette.gray
        case .orange: return Palette.orange
        case .pink: return Palette.pink
        case .purple: return Palette.purple
        case .sage: return Palette.sage
        }
    }

    public var soft: Color {
        switch self {
        case .red: return Palette.redSoft
        case .gray: return Palette.graySoft
        case .orange: return Palette.orangeSoft
        case .pink: return Palette.pinkSoft
        case .purple: return Palette.purpleSoft
        case .sage: return Palette.sageSoft
        }
    }
}

/// 四種花色，顏色固定：紅心紅、黑桃灰、方塊橘、梅花粉。
///
/// 意義沿用設計稿：紅心是基礎與核心，黑桃是摘要與結論，方塊是長期與結構，梅花是一般與日常。
public enum Suit: CaseIterable, Sendable {
    case heart, spade, diamond, club

    public var tone: Tone {
        switch self {
        case .heart: return .red
        case .spade: return .gray
        case .diamond: return .orange
        case .club: return .pink
        }
    }

    public var symbol: String {
        switch self {
        case .heart: return "suit.heart.fill"
        case .spade: return "suit.spade.fill"
        case .diamond: return "suit.diamond.fill"
        case .club: return "suit.club.fill"
        }
    }

    public var color: Color { tone.color }
    public var soft: Color { tone.soft }
}

extension CardKind {
    /// 卡片種類對應的花色。卡片庫、總覽與詳細內容都用這一個對照。
    var suit: Suit {
        switch self {
        case .bedrock, .persona: return .heart
        case .summary: return .spade
        case .memory: return .diamond
        case .note, .image, .audio: return .club
        }
    }
}
