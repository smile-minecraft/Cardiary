import Foundation

/// 新鮮度在畫面上的呈現。卡片庫與檢視欄共用同一個換算，顏色才會一致。
///
/// 數值一律來自主機；這裡只把 0 到 100 換成填色的濃淡與提示旗標，不重新計算新鮮度。
public struct CardFreshnessAppearance: Equatable, Sendable {
    /// 換算後的新鮮度，超出範圍的值會夾在 0 到 100。
    public let value: Int
    /// 0 到 1 的新鮮度比例。
    public let fraction: Double
    /// 卡片填色的不透明度；新鮮度越高越濃。
    public let opacity: Double
    /// 是否已進入「即將歸零」的提示範圍。
    public let needsAttention: Bool
    /// 是否已經歸零。
    public let isExpired: Bool

    public init(value: Int, fraction: Double, opacity: Double, needsAttention: Bool, isExpired: Bool) {
        self.value = value
        self.fraction = fraction
        self.opacity = opacity
        self.needsAttention = needsAttention
        self.isExpired = isExpired
    }
}

/// 新鮮度換算。低於 `attentionThreshold` 的卡顯示提示與「保鮮」。
public enum CardFreshnessStyle {
    public static let attentionThreshold = 20

    /// 輸入未夾限的新鮮度，回傳畫面上使用的呈現。100、50、0 必須得到三個可分辨的值。
    public static func appearance(for freshness: Int) -> CardFreshnessAppearance {
        let value = min(100, max(0, freshness))
        let fraction = Double(value) / 100
        return CardFreshnessAppearance(
            value: value,
            fraction: fraction,
            opacity: 0.18 + 0.82 * fraction,
            needsAttention: value <= attentionThreshold,
            isExpired: value == 0
        )
    }
}
