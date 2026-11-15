import CardiaryKit
import SwiftUI

/// 卡片新鮮度的填色。卡片庫與檢視欄都呼叫同一組方法，同一個數值得到同一個顏色。
///
/// 色相來自花色（卡片種類），深淺來自新鮮度：越新鮮越濃，快歸零時接近底色。
/// 冷封存的卡一律用黑桃灰。
/// `block` 只給不承載文字的裝飾色塊（圖例）用；承載文字的格子走 `ContextBlockColor.fill`，兩檔之一，不用濃淡。
enum CardFreshnessFill {
    /// 新鮮度對應的不透明度。100、50、0 三個值必須看得出差別。
    static func strength(for appearance: CardFreshnessAppearance) -> Double {
        0.22 + 0.78 * appearance.opacity
    }

    /// 檢視欄圖例用的花色圖塊。不承載文字；列表的花色圖塊見 `SuitTile`。
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

/// 檢視欄區塊的顏色。花色語意表在 `Suit` 上方；這裡照表對照，不另立一套。
///
/// 靜態層（基岩、人格）是固定的紅心實色；對話工作區是固定的黑桃軟色塊；
/// 記憶與一般卡依新鮮度分兩檔：新鮮用實色配深墨字，快歸零用軟色塊配主文字。
/// 兩檔以外不使用濃淡：中間的濃度壓不住 4.5:1 的字。
enum ContextBlockColor {
    struct Fill {
        let color: Color
        /// 格子裡文字用的顏色。實色底用深墨字 `onAccent`；軟色塊或淺底用 `ink`。
        let text: Color
    }

    static func tone(for layer: ContextLayer) -> Tone {
        switch layer {
        case .bedrock, .persona: return .red
        case .coreMemory, .openingMemory, .shortTermMemory: return .orange
        case .otherCards: return .pink
        case .workingContext, .volatileState: return .gray
        }
    }

    /// 圖例用的代表層：每個花色一個。
    static let legendLayers: [ContextLayer] = [.bedrock, .coreMemory, .otherCards, .workingContext]

    static func fill(for entry: ContextEntry, appearance: CardFreshnessAppearance?) -> Fill {
        let tone = tone(for: entry.layer)
        if entry.state == .pendingRemoval {
            // 即將移除：軟色塊加虛線框，主文字。
            return Fill(color: tone.soft, text: Palette.ink)
        }
        switch entry.layer {
        case .bedrock, .persona:
            return Fill(color: tone.color, text: Palette.onAccent)
        case .workingContext, .volatileState:
            return Fill(color: tone.soft, text: Palette.ink)
        default:
            let isFresh = (appearance?.opacity ?? 0.6) >= 0.5
            return isFresh
                ? Fill(color: tone.color, text: Palette.onAccent)
                : Fill(color: tone.soft, text: Palette.ink)
        }
    }

    /// 剩餘容量的空格。
    static let empty = Palette.sunken
}
