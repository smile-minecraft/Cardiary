import Foundation
import XCTest

@testable import CardiaryApp

/// 遠端與通知介面的兩份字串表：每個 key 都要有繁中與英文，
/// 而且編譯進程式的內容與 `.xcstrings` 一致。比對方式跟 `LocalizationTests` 相同。
final class FeatureStringCatalogTests: XCTestCase {
    func testEveryKeyHasBothLanguages() {
        for key in RemoteString.allCases {
            XCTAssertFalse(
                RemoteL10n.text(key, language: .zhHant).isEmpty,
                "\(key.rawValue) 缺繁體中文"
            )
            XCTAssertFalse(RemoteL10n.text(key, language: .en).isEmpty, "\(key.rawValue) 缺英文")
        }
        for key in NotificationString.allCases {
            XCTAssertFalse(
                NotificationL10n.text(key, language: .zhHant).isEmpty,
                "\(key.rawValue) 缺繁體中文"
            )
            XCTAssertFalse(
                NotificationL10n.text(key, language: .en).isEmpty,
                "\(key.rawValue) 缺英文"
            )
        }
    }

    func testRemoteCatalogMatchesSource() throws {
        try assertCatalogMatches("Remote", keys: RemoteL10n.catalogKeys()) { key, language in
            RemoteL10n.table(language)[key]
        }
    }

    func testNotificationsCatalogMatchesSource() throws {
        try assertCatalogMatches("Notifications", keys: NotificationL10n.catalogKeys()) { key, language in
            NotificationL10n.table(language)[key]
        }
    }

    func testLookupAndPlaceholders() {
        XCTAssertEqual(RemoteL10n.text(.remotePairingApprove, language: .zhHant), "核准")
        XCTAssertEqual(RemoteL10n.format(.remotePairingCode, value: "123", language: .en), "Code: 123")
        XCTAssertEqual(NotificationL10n.count(.notificationUnread, count: 3, language: .zhHant), "3 則未讀")
        XCTAssertEqual(NotificationL10n.text(.notificationTitle, language: .en), "Notifications")
    }

    // MARK: - .xcstrings 比對

    private func assertCatalogMatches(
        _ fileName: String,
        keys: [String],
        table: (String, AppLanguage) -> String?,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let catalog = try loadCatalog(fileName, file: file, line: line)
        XCTAssertEqual(
            Set(catalog.keys).subtracting(keys), [],
            "\(fileName).xcstrings 有程式沒用到的 key",
            file: file, line: line
        )
        for key in keys {
            let languages = try XCTUnwrap(catalog[key], "\(fileName).xcstrings 缺少 \(key)", file: file, line: line)
            for language in AppLanguage.allCases {
                let expected = try XCTUnwrap(
                    languages[language.rawValue],
                    "\(fileName).xcstrings 的 \(key) 缺 \(language.rawValue)",
                    file: file, line: line
                )
                XCTAssertEqual(
                    table(key, language), expected,
                    "\(key) 在 \(fileName).xcstrings 與編譯進程式的字串表不一致",
                    file: file, line: line
                )
            }
        }
    }

    private func loadCatalog(
        _ name: String,
        file: StaticString,
        line: UInt
    ) throws -> [String: [String: String]] {
        let source = URL(fileURLWithPath: "\(file)")
            .deletingLastPathComponent()  // Notifications
            .deletingLastPathComponent()  // CardiaryAppTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // macos
            .appendingPathComponent("Sources/CardiaryApp/Resources/\(name).xcstrings")
        let data = try Data(contentsOf: source)
        let document = try JSONDecoder().decode(CatalogDocument.self, from: data)
        var result: [String: [String: String]] = [:]
        for (key, entry) in document.strings {
            var languages: [String: String] = [:]
            for (code, localization) in entry.localizations ?? [:] {
                if let value = localization.stringUnit?.value { languages[code] = value }
            }
            result[key] = languages
        }
        return result
    }
}

private struct CatalogDocument: Decodable {
    struct Entry: Decodable {
        struct Localization: Decodable {
            struct StringUnit: Decodable {
                let value: String
            }
            let stringUnit: StringUnit?
        }
        let localizations: [String: Localization]?
    }
    let strings: [String: Entry]
}
