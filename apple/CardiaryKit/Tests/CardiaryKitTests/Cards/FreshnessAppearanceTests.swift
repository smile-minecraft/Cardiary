import XCTest

@testable import CardiaryKit

final class FreshnessAppearanceTests: XCTestCase {
    func testFreshnessHundredFiftyZeroAreDistinct() {
        let fresh = CardFreshnessStyle.appearance(for: 100)
        let middle = CardFreshnessStyle.appearance(for: 50)
        let expired = CardFreshnessStyle.appearance(for: 0)

        XCTAssertEqual(fresh.opacity, 1, accuracy: 1e-9)
        XCTAssertGreaterThan(fresh.opacity, middle.opacity)
        XCTAssertGreaterThan(middle.opacity, expired.opacity)
        XCTAssertFalse(fresh.needsAttention)
        XCTAssertFalse(middle.needsAttention)
        XCTAssertTrue(expired.needsAttention)
        XCTAssertTrue(expired.isExpired)
    }

    func testOutOfRangeValuesAreClamped() {
        XCTAssertEqual(CardFreshnessStyle.appearance(for: 140).value, 100)
        XCTAssertEqual(CardFreshnessStyle.appearance(for: -20).value, 0)
        XCTAssertEqual(CardFreshnessStyle.appearance(for: -20).opacity, 0.18, accuracy: 1e-9)
    }

    func testAttentionStartsAtThreshold() {
        XCTAssertTrue(CardFreshnessStyle.appearance(for: 20).needsAttention)
        XCTAssertFalse(CardFreshnessStyle.appearance(for: 21).needsAttention)
    }
}
