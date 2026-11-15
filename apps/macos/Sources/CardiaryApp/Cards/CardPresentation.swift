import CardiaryKit
import SwiftUI

/// 卡片新鮮度的填色。卡片庫與檢視欄都呼叫同一組方法，同一個數值得到同一個顏色。
///
/// 色相來自花色（卡片種類），深淺來自新鮮度：越新鮮越濃，快歸零時接近底色。
/// 冷封存的卡一律用黑桃灰。
enum CardFreshnessFill {
    /// 新鮮度對應的不透明度。100、50、0 三個值必須看得出差別。
    static func strength(for appearance: CardFreshnessAppearance) -> Double {
        0.22 + 0.78 * appearance.opacity
    }

    /// 列表與詳細內容的花色圖塊。
    static func block(for appearance: CardFreshnessAppearance, suit: Suit) -> Color {
        suit.color.opacity(strength(for: appearance))
    }

    /// 總覽的一格：整格都是新鮮度，對比要更明顯。
    static func overview(for appearance: CardFreshnessAppearance, suit: Suit) -> Color {
        suit.color.opacity(0.08 + 0.92 * appearance.fraction)
    }

    /// 卡片的花色；冷封存一律是黑桃。
    static func suit(kind: CardKind, lifecycle: CardLifecycle?) -> Suit {
        lifecycle == .cold ? .spade : kind.suit
    }
}

/// 檢視欄區塊的顏色。
///
/// 靜態層（基岩、人格）是固定的紅心色，對話內容是固定的黑桃灰，兩者都不褪色；
/// 卡片層依層別用方塊橘、紫、梅花粉，深淺代表新鮮度。
enum ContextBlockColor {
    struct Fill {
        let color: Color
        /// 底色夠深時，格子裡的文字改用白色。
        let prefersLightText: Bool
    }

    static func tone(for layer: ContextLayer) -> Tone {
        switch layer {
        case .bedrock, .persona: return .red
        case .coreMemory, .openingMemory: return .orange
        case .shortTermMemory: return .purple
        case .otherCards: return .pink
        case .workingContext, .volatileState: return .gray
        }
    }

    /// 圖例用的代表層：每個顏色一個。
    static let legendLayers: [ContextLayer] = [.bedrock, .coreMemory, .shortTermMemory, .otherCards, .workingContext]

    static func fill(for entry: ContextEntry, appearance: CardFreshnessAppearance?) -> Fill {
        let tone = tone(for: entry.layer)
        if entry.state == .pendingRemoval {
            return Fill(color: tone.color.opacity(0.22), prefersLightText: false)
        }
        switch entry.layer {
        case .bedrock, .persona:
            return Fill(color: tone.color, prefersLightText: true)
        case .workingContext, .volatileState:
            return Fill(color: tone.color.opacity(0.45), prefersLightText: false)
        default:
            let strength = appearance.map(CardFreshnessFill.strength(for:)) ?? 0.6
            return Fill(color: tone.color.opacity(strength), prefersLightText: strength > 0.65)
        }
    }

    /// 剩餘容量的空格。
    static let empty = Palette.sunken
}
