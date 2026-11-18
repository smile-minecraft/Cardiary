import CardiaryKit
import Foundation
import XCTest

@testable import CardiaryApp

/// 代理權限模式的視圖模型：主機狀態是唯一真相，全部允許要限定範圍，
/// 推來的變更（例如緊急全部暫停撤銷）立刻反映在倒數上。
@MainActor
final class PermissionModesModelTests: XCTestCase {
    private func attached() async -> (PermissionModesModel, FakeCardiaryService) {
        let service = FakeCardiaryService()
        let model = PermissionModesModel(language: .zhHant)
        model.attach(service: service)
        await model.load()
        return (model, service)
    }

    func testLoadStartsWithEverythingOff() async {
        let (model, _) = await attached()
        XCTAssertNotNil(model.state)
        XCTAssertNil(model.allowAllExpiry())
        for category in DelegatedCategory.allCases {
            XCTAssertFalse(model.isEnabled(category))
        }
        XCTAssertNil(model.errorMessage)
    }

    func testFolderCategoryNeedsAFolderBeforeTurningOn() async {
        let (model, service) = await attached()
        await model.setCategory(.readOnlyFiles, enabled: true)
        XCTAssertEqual(model.errorMessage, PermissionL10n.text(.permNeedsFolder, language: .zhHant))
        let calls = await service.permissionCalls
        XCTAssertEqual(calls, [], "沒有資料夾時不能送出沒有範圍的授權")

        await model.addFolder("/Users/test/Projects", to: .readOnlyFiles)
        await model.setCategory(.readOnlyFiles, enabled: true)
        XCTAssertTrue(model.isEnabled(.readOnlyFiles))
        let after = await service.permissionCalls
        XCTAssertEqual(after, ["set_category:read-only-files:true:/Users/test/Projects"])
    }

    func testRemovingTheLastFolderTurnsTheCategoryOff() async {
        let (model, service) = await attached()
        await model.addFolder("/Users/test/A", to: .gitReadonly)
        await model.setCategory(.gitReadonly, enabled: true)
        await model.removeFolder("/Users/test/A", from: .gitReadonly)
        XCTAssertFalse(model.isEnabled(.gitReadonly))
        let calls = await service.permissionCalls
        XCTAssertEqual(calls.last, "set_category:git-readonly:false:")
    }

    func testCategoriesWithoutFoldersSendNoPaths() async {
        let (model, service) = await attached()
        await model.setCategory(.createCard, enabled: true)
        XCTAssertTrue(model.isEnabled(.createCard))
        let calls = await service.permissionCalls
        XCTAssertEqual(calls, ["set_category:create-card:true:"])
    }

    func testAllowAllRequiresToolsAndFolders() async {
        let (model, service) = await attached()
        model.allowAllSelectedTools = []
        model.allowAllFolders = ["/Users/test/Projects"]
        await model.startAllowAll()
        XCTAssertEqual(model.errorMessage, PermissionL10n.text(.permAllowAllNeedsScope, language: .zhHant))

        model.allowAllSelectedTools = ["write_file"]
        model.allowAllFolders = []
        await model.startAllowAll()
        let calls = await service.permissionCalls
        XCTAssertEqual(calls, [], "沒有工具或資料夾時不能開全部允許")
    }

    func testAllowAllClampsMinutesAndShowsCountdown() async {
        let (model, service) = await attached()
        model.allowAllSelectedTools = ["write_file", "read_file"]
        model.allowAllFolders = ["/Users/test/Projects"]
        model.allowAllMinutes = 90
        await model.startAllowAll()
        let calls = await service.permissionCalls
        XCTAssertEqual(calls, ["grant:read_file,write_file:/Users/test/Projects:60"], "超過上限要壓回 60 分鐘")
        let expiry = try? XCTUnwrap(model.allowAllExpiry())
        XCTAssertNotNil(expiry)
        if let expiry {
            XCTAssertEqual(expiry.timeIntervalSinceNow, 3600, accuracy: 5)
            XCTAssertEqual(AllowAllBanner.remaining(until: expiry, now: expiry.addingTimeInterval(-75)), "1:15")
        }

        await model.endAllowAll()
        XCTAssertNil(model.allowAllExpiry())
    }

    func testPushedChangeFromEmergencyPauseClearsTheBanner() async throws {
        let (model, _) = await attached()
        model.allowAllSelectedTools = ["write_file"]
        model.allowAllFolders = ["/Users/test/Projects"]
        await model.startAllowAll()
        XCTAssertNotNil(model.allowAllExpiry())

        let event = SystemPermissionsChangedEvent(
            stream: "system",
            seq: 9,
            emittedAt: "2026-11-18T10:00:00.000Z",
            payload: FakeCardiaryService.modes()
        )
        model.handle(frame: .systemPermissionsChangedEvent(event))
        XCTAssertNil(model.allowAllExpiry(), "主機撤銷後倒數要立刻消失")
    }

    func testExpiredGrantIsNotShown() async {
        let (model, service) = await attached()
        let past = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-5))
        await service.setPermissionModesForTest(
            FakeCardiaryService.modes(
                allowAll: AllowAllGrantState(tools: ["write_file"], paths: ["/tmp"], domains: [], expiresAt: past)
            )
        )
        await model.load()
        XCTAssertNil(model.allowAllExpiry())
    }

    func testDomainsAreSplitByLinesAndCommas() async {
        let (model, service) = await attached()
        model.domainsText = "docs.example.com\n api.example.com , \n"
        await model.saveDomains()
        let calls = await service.permissionCalls
        XCTAssertEqual(calls, ["set_domains:docs.example.com,api.example.com"])
        XCTAssertEqual(model.state?.allowedDomains, ["docs.example.com", "api.example.com"])
    }
}
