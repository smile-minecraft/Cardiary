import Foundation
import XCTest

@testable import CardiaryApp

@MainActor
final class UIScaleStoreTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "cardiary.tests.uiscale.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        if let suiteName {
            UserDefaults.standard.removePersistentDomain(forName: suiteName)
        }
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testZoomPresetsAndBounds() {
        let store = UIScaleStore(defaults: defaults, key: "scale")
        XCTAssertEqual(store.scale, 1.0, accuracy: 0.0001)
        XCTAssertTrue(store.isDefault)
        XCTAssertEqual(store.percentageText, "100%")
        XCTAssertTrue(store.canZoomIn)
        XCTAssertTrue(store.canZoomOut)

        store.zoomIn()
        XCTAssertEqual(store.scale, 1.10, accuracy: 0.0001)
        XCTAssertEqual(store.percentageText, "110%")
        XCTAssertFalse(store.isDefault)

        for _ in 0..<20 {
            store.zoomIn()
        }
        XCTAssertEqual(store.scale, UIScaleStore.maxScale, accuracy: 0.0001)
        XCTAssertFalse(store.canZoomIn)

        store.reset()
        XCTAssertEqual(store.scale, 1.0, accuracy: 0.0001)

        for _ in 0..<20 {
            store.zoomOut()
        }
        XCTAssertEqual(store.scale, UIScaleStore.minScale, accuracy: 0.0001)
        XCTAssertFalse(store.canZoomOut)
    }

    func testPersistsAndSanitizesInvalidValues() {
        let store = UIScaleStore(defaults: defaults, key: "scale")
        store.setScale(1.40)
        XCTAssertEqual(store.scale, 1.40, accuracy: 0.0001)

        let reloaded = UIScaleStore(defaults: defaults, key: "scale")
        XCTAssertEqual(reloaded.scale, 1.40, accuracy: 0.0001)

        // NaN、無窮大或非正數不可蓋掉有效值
        reloaded.setScale(.nan)
        XCTAssertEqual(reloaded.scale, 1.40, accuracy: 0.0001)
        reloaded.setScale(.infinity)
        XCTAssertEqual(reloaded.scale, 1.40, accuracy: 0.0001)
        reloaded.setScale(-0.5)
        XCTAssertEqual(reloaded.scale, 1.40, accuracy: 0.0001)

        // 超出範圍的值夾緊到上下界
        reloaded.setScale(5.0)
        XCTAssertEqual(reloaded.scale, UIScaleStore.maxScale, accuracy: 0.0001)
        reloaded.setScale(0.1)
        XCTAssertEqual(reloaded.scale, UIScaleStore.minScale, accuracy: 0.0001)

        // 偏好設定被外部寫壞成 0 或負數時退回 1.0
        defaults.set(-3.0, forKey: "scale")
        let fallback = UIScaleStore(defaults: defaults, key: "scale")
        XCTAssertEqual(fallback.scale, 1.0, accuracy: 0.0001)
    }

    func testThemeTypographyScalesSafely() {
        XCTAssertEqual(ThemeTypography.scaledPointSize(14, scale: 1.0), 14)
        XCTAssertEqual(ThemeTypography.scaledPointSize(14, scale: 1.5), 21)
        XCTAssertEqual(ThemeTypography.scaledPointSize(14, scale: .nan), 14)
        XCTAssertGreaterThanOrEqual(ThemeTypography.scaledPointSize(14, scale: 0.01), 6)

        let regular = ThemeTypography.nsFont(size: 14, weight: .regular)
        let italic = ThemeTypography.nsFont(size: 14, weight: .regular, italic: true)
        let mono = ThemeTypography.monospacedNSFont(size: 13)
        XCTAssertEqual(regular.pointSize, 14, accuracy: 0.5)
        XCTAssertEqual(italic.pointSize, 14, accuracy: 0.5)
        XCTAssertEqual(mono.pointSize, 13, accuracy: 0.5)
    }
}
