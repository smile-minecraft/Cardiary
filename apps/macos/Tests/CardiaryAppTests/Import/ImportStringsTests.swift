import Foundation
import XCTest

@testable import CardiaryApp

/// 匯入字串表：每個 key 都要有繁體中文與英文，而且與 `Import.xcstrings` 一致。
final class ImportStringsTests: XCTestCase {
    func testEveryKeyHasBothLanguages() {
        for key in ImportString.allCases {
            XCTAssertFalse(
                ImportL10n.text(key, language: .zhHant).isEmpty,
                "\(key.rawValue) 缺繁體中文"
            )
            XCTAssertFalse(ImportL10n.text(key, language: .en).isEmpty, "\(key.rawValue) 缺英文")
            XCTAssertNotEqual(
                ImportL10n.text(key, language: .zhHant),
                key.rawValue,
                "\(key.rawValue) 沒有翻譯"
            )
        }
    }

    func testCatalogMatchesCompiledTable() throws {
        let catalog = try loadCatalog()
        XCTAssertEqual(
            Set(catalog.keys).subtracting(ImportString.allCases.map(\.rawValue)),
            [],
            "Import.xcstrings 有程式沒用到的 key"
        )
        for key in ImportString.allCases {
            let languages = try XCTUnwrap(catalog[key.rawValue], "Import.xcstrings 缺少 \(key.rawValue)")
            for language in AppLanguage.allCases {
                XCTAssertEqual(
                    ImportStrings.table[language]?[key.rawValue],
                    languages[language.rawValue],
                    "\(key.rawValue) 在 Import.xcstrings 與編譯進程式的字串表不一致"
                )
            }
        }
    }

    func testPlaceholdersAreReplaced() {
        XCTAssertEqual(
            ImportL10n.count(.importWrite, count: 3, language: .zhHant),
            "寫入 3 張卡"
        )
        XCTAssertEqual(
            ImportL10n.format(.importSourceUnverified, value: "state.db", language: .en),
            "Unverified: state.db"
        )
    }

    func testCategoryTitlesExist() {
        for category in ImportCategory.allCases {
            XCTAssertFalse(ImportL10n.text(category.titleKey, language: .zhHant).isEmpty)
            XCTAssertFalse(ImportL10n.text(category.titleKey, language: .en).isEmpty)
        }
    }

    private func loadCatalog() throws -> [String: [String: String]] {
        let source = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // Import
            .deletingLastPathComponent()  // CardiaryAppTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // macos
            .appendingPathComponent("Sources/CardiaryApp/Resources/Import.xcstrings")
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
