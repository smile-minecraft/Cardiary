import Combine
import Foundation
import SwiftUI

/// 全域介面縮放狀態，控制字級與排版比例並保存在本機偏好設定。
@MainActor
public final class UIScaleStore: ObservableObject {
    /// 可選的縮放檔位（75% 至 175%）。
    public nonisolated static let presets: [CGFloat] = [0.75, 0.85, 0.90, 1.0, 1.10, 1.25, 1.40, 1.50, 1.75]
    public nonisolated static let defaultScale: CGFloat = 1.0
    public nonisolated static let minScale: CGFloat = 0.75
    public nonisolated static let maxScale: CGFloat = 1.75
    public nonisolated static let defaultsKey = "cardiary.uiScale"

    /// App 執行的共用縮放設定；測試可自行建立獨立實例。
    public static let shared = UIScaleStore(defaults: .standard)

    @Published public private(set) var scale: CGFloat

    private let defaults: UserDefaults?
    private let key: String

    public init(defaults: UserDefaults? = nil, key: String = UIScaleStore.defaultsKey) {
        self.defaults = defaults
        self.key = key
        if let defaults,
            let raw = defaults.object(forKey: key) as? NSNumber
        {
            let value = CGFloat(raw.doubleValue)
            if value.isFinite, value > 0 {
                self.scale = Self.normalized(value)
                return
            }
        }
        self.scale = Self.defaultScale
    }

    public var canZoomIn: Bool {
        Self.presets.contains { $0 > scale + 0.001 }
    }

    public var canZoomOut: Bool {
        Self.presets.contains { $0 < scale - 0.001 }
    }

    public var isDefault: Bool {
        abs(scale - Self.defaultScale) < 0.001
    }

    public var percentageText: String {
        "\(Int((scale * 100).rounded()))%"
    }

    public func zoomIn() {
        guard let next = Self.presets.first(where: { $0 > scale + 0.001 }) else { return }
        apply(next)
    }

    public func zoomOut() {
        guard let previous = Self.presets.last(where: { $0 < scale - 0.001 }) else { return }
        apply(previous)
    }

    public func reset() {
        apply(Self.defaultScale)
    }

    public func setScale(_ value: CGFloat) {
        guard value.isFinite, value > 0 else { return }
        apply(Self.normalized(value))
    }

    private func apply(_ next: CGFloat) {
        let normalized = Self.normalized(next)
        guard abs(normalized - scale) >= 0.0005 else { return }
        scale = normalized
        defaults?.set(Double(normalized), forKey: key)
    }

    private static func normalized(_ value: CGFloat) -> CGFloat {
        let clamped = min(maxScale, max(minScale, value))
        if let preset = presets.first(where: { abs($0 - clamped) < 0.001 }) {
            return preset
        }
        return clamped
    }
}

private struct CardiaryScaleKey: EnvironmentKey {
    static let defaultValue: CGFloat = UIScaleStore.defaultScale
}

extension EnvironmentValues {
    /// 目前介面的縮放比例；預設為 `1.0`。
    public var cardiaryScale: CGFloat {
        get { self[CardiaryScaleKey.self] }
        set { self[CardiaryScaleKey.self] = newValue }
    }
}
