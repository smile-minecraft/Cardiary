import Foundation

/// 服務異常結束後的重啟規則。
public struct RestartPolicy: Equatable, Sendable {
    public var baseDelay: TimeInterval
    public var maxDelay: TimeInterval
    public var maxConsecutiveFailures: Int
    public var stableWindow: TimeInterval

    public init(
        baseDelay: TimeInterval = 0.25,
        maxDelay: TimeInterval = 4,
        maxConsecutiveFailures: Int = 10,
        stableWindow: TimeInterval = 30
    ) {
        self.baseDelay = baseDelay
        self.maxDelay = maxDelay
        self.maxConsecutiveFailures = maxConsecutiveFailures
        self.stableWindow = stableWindow
    }

    public static let `default` = RestartPolicy()

    /// 第 1 次失敗等 baseDelay，之後加倍，最多 maxDelay。
    public func delay(afterFailure failureIndex: Int) -> TimeInterval {
        guard failureIndex > 1 else { return baseDelay }
        var delay = baseDelay
        for _ in 1..<failureIndex {
            delay *= 2
            if delay >= maxDelay { return maxDelay }
        }
        return min(delay, maxDelay)
    }

    public func shouldRestart(consecutiveFailures: Int) -> Bool {
        consecutiveFailures <= maxConsecutiveFailures
    }

    public func resetsFailures(uptime: TimeInterval) -> Bool {
        uptime >= stableWindow
    }
}
