import CardiaryKit
import Combine
import Foundation

/// 卡片庫與檢視欄共用的新鮮度快取。值全部來自主機（`card.list`、`card.get`、
/// `card.refresh` 與 `card.changed`），客戶端不自己算。
@MainActor
public final class CardFreshnessStore: ObservableObject {
    @Published public private(set) var values: [String: Int] = [:]

    public init() {}

    public func update(cardId: String, freshness: Int) {
        values[cardId] = freshness
    }

    public func remove(cardId: String) {
        values.removeValue(forKey: cardId)
    }

    public func value(for cardId: String) -> Int? {
        values[cardId]
    }

    /// 主機還沒回報時使用呼叫端手上的值，只影響顯示，不回寫主機。
    public func appearance(for cardId: String, fallback: Int) -> CardFreshnessAppearance {
        CardFreshnessStyle.appearance(for: values[cardId] ?? fallback)
    }
}
