import Foundation
import XCTest

@testable import CardiaryApp

/// 字串表：每個 key 都要有繁體中文與英文，而且編譯進程式的字串與 `.xcstrings` 一致。
final class LocalizationTests: XCTestCase {
    func testEveryAppStringHasTraditionalChineseAndEnglish() {
        for key in AppString.allCases {
            XCTAssertFalse(
                AppL10n.text(key, language: .zhHant).isEmpty,
                "\(key.rawValue) 缺繁體中文"
            )
            XCTAssertFalse(
                AppL10n.text(key, language: .en).isEmpty,
                "\(key.rawValue) 缺英文"
            )
        }
        for key in ShellString.allCases {
            XCTAssertFalse(AppL10n.text(key, language: .zhHant).isEmpty, "\(key.rawValue) 缺繁體中文")
            XCTAssertFalse(AppL10n.text(key, language: .en).isEmpty, "\(key.rawValue) 缺英文")
        }
    }

    func testStringCatalogsMatchCompiledTables() throws {
        try assertCatalogMatches("Localizable", keys: AppString.allCases.map(\.rawValue), tableName: .localizable)
        try assertCatalogMatches("Shell", keys: ShellString.allCases.map(\.rawValue), tableName: .shell)
    }

    func testLookupFollowsLanguage() {
        XCTAssertEqual(AppL10n.text(.conversationNew, language: .zhHant), "新對話")
        XCTAssertEqual(AppL10n.text(.conversationNew, language: .en), "New Conversation")
        XCTAssertEqual(AppL10n.text(.appTitle, language: .en), "Cardiary")
    }

    func testPlaceholdersAreReplaced() {
        XCTAssertEqual(AppL10n.count(ShellString.menuApprovalsCount, count: 2, language: .zhHant), "2 件待審批")
        XCTAssertEqual(
            AppL10n.format(.connectionDisconnected, value: "timeout", language: .en),
            "Disconnected: timeout"
        )
    }

    func testUnknownKeyFallsBackToRawValue() {
        AppL10n.useTables([:])
        defer { AppL10n.useTables(nil) }

        XCTAssertEqual(AppL10n.text(.appTitle, language: .en), "appTitle")
    }

    func testSystemDefaultLanguage() {
        XCTAssertEqual(AppLanguage.systemDefault(preferred: ["zh-Hant-TW"]), .zhHant)
        XCTAssertEqual(AppLanguage.systemDefault(preferred: ["zh-Hans-CN"]), .zhHant)
        XCTAssertEqual(AppLanguage.systemDefault(preferred: ["en-US"]), .en)
        XCTAssertEqual(AppLanguage.systemDefault(preferred: ["ja-JP"]), .en)
    }

    // MARK: - `.xcstrings` 比對

    private func assertCatalogMatches(
        _ fileName: String,
        keys: [String],
        tableName: StringCatalogName,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let catalog = try loadCatalog(fileName)
        XCTAssertEqual(
            Set(catalog.keys).subtracting(keys),
            [],
            "\(fileName).xcstrings 有程式沒用到的 key",
            file: file,
            line: line
        )
        for key in keys {
            let languages = try XCTUnwrap(catalog[key], "\(fileName).xcstrings 缺少 \(key)", file: file, line: line)
            for language in AppLanguage.allCases {
                let expected = try XCTUnwrap(
                    languages[language.rawValue],
                    "\(fileName).xcstrings 的 \(key) 缺 \(language.rawValue)",
                    file: file,
                    line: line
                )
                XCTAssertEqual(
                    AppL10n.table(tableName, language: language)[key],
                    expected,
                    "\(key) 在 \(fileName).xcstrings 與編譯進程式的字串表不一致",
                    file: file,
                    line: line
                )
            }
        }
    }

    private func loadCatalog(_ name: String) throws -> [String: [String: String]] {
        let source = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // Shared
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
