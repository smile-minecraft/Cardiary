import CardiaryKit
import SwiftUI

/// 卡片新鮮度的填色。卡片庫與檢視欄都呼叫同一個方法，同一個數值得到同一個顏色。
enum CardFreshnessFill {
    /// 列表與檢視欄的卡片區塊。
    static func block(for appearance: CardFreshnessAppearance) -> Color {
        Color.accentColor.opacity(0.06 + 0.30 * appearance.opacity)
    }

    /// 總覽的一格：整格都是新鮮度，對比要更明顯。
    static func overview(for appearance: CardFreshnessAppearance) -> Color {
        Color.accentColor.opacity(0.05 + 0.85 * appearance.fraction)
    }
}

/// 檢視欄的靜態層與對話內容用中性色，不跟著卡片新鮮度褪色。
enum ContextBlockColor {
    static func fill(for entry: ContextEntry, appearance: CardFreshnessAppearance?) -> Color {
        if entry.state == .pendingRemoval {
            return Color.orange.opacity(0.35)
        }
        switch entry.layer {
        case .bedrock, .persona:
            return Color(nsColor: .secondaryLabelColor).opacity(0.45)
        case .workingContext:
            return Color(nsColor: .tertiaryLabelColor).opacity(0.75)
        default:
            if let appearance {
                return CardFreshnessFill.block(for: appearance)
            }
            return Color.accentColor.opacity(0.12)
        }
    }
}
