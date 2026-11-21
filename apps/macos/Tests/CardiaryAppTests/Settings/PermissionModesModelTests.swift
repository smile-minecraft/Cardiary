import CardiaryKit
import Foundation
import XCTest

@testable import CardiaryApp

/// 代理權限模式的視圖模型：主機狀態是唯一真相，全部允許要限定範圍且重啟保留，
/// 推來的變更（例如緊急全部暫停撤銷）立刻反映在狀態上。
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
        XCTAssertNil(model.activeAllowAll)
        XCTAssertFalse(model.isAllowAllActive)
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

    func testAllowAllGrantsWithoutExpiryAndPersistsAcrossReload() async {
        let (model, service) = await attached()
        model.allowAllSelectedTools = ["write_file", "read_file"]
        model.allowAllFolders = ["/Users/test/Projects"]
        await model.startAllowAll()
        let calls = await service.permissionCalls
        XCTAssertEqual(calls, ["grant:read_file,write_file:/Users/test/Projects"])
        XCTAssertTrue(model.isAllowAllActive)
        XCTAssertEqual(model.activeAllowAll?.tools, ["read_file", "write_file"])
        XCTAssertEqual(model.activeAllowAll?.paths, ["/Users/test/Projects"])

        // 模擬重新開啟或重連後載入主機狀態，授權依然有效。
        let reloaded = PermissionModesModel(language: .zhHant)
        reloaded.attach(service: service)
        await reloaded.load()
        XCTAssertTrue(reloaded.isAllowAllActive)
        XCTAssertEqual(reloaded.activeAllowAll, model.activeAllowAll)

        await model.endAllowAll()
        XCTAssertFalse(model.isAllowAllActive)
        XCTAssertNil(model.activeAllowAll)
    }

    func testPushedChangeFromEmergencyPauseClearsActiveAllowAll() async throws {
        let (model, _) = await attached()
        model.allowAllSelectedTools = ["write_file"]
        model.allowAllFolders = ["/Users/test/Projects"]
        await model.startAllowAll()
        XCTAssertTrue(model.isAllowAllActive)

        let event = SystemPermissionsChangedEvent(
            stream: "system",
            seq: 9,
            emittedAt: "2026-11-18T10:00:00.000Z",
            payload: FakeCardiaryService.modes()
        )
        model.handle(frame: .systemPermissionsChangedEvent(event))
        XCTAssertFalse(model.isAllowAllActive, "主機撤銷後全部允許狀態要立刻清空")
        XCTAssertNil(model.activeAllowAll)
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
