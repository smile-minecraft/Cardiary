import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 首次設定：選資料夾、設定主力模型、開第一場對話。
@MainActor
final class FirstRunModelTests: XCTestCase {
    private func makeModelsState() -> SystemModelsState {
        let provider = Fixtures.modelProvider("local", models: ["small", "big"])
        return SystemModelsState(
            providers: [provider],
            roles: [ModelRoleSelection(role: .main, mode: .unset, ref: nil)],
            resolved: []
        )
    }

    func testStepsAdvanceThroughFolderModelConversation() {
        let firstRun = FirstRunModel()
        XCTAssertEqual(firstRun.step, .folder)

        firstRun.folderDidBecomeReady()
        XCTAssertEqual(firstRun.step, .model)

        firstRun.folderDidBecomeReady()
        XCTAssertEqual(firstRun.step, .model, "資料夾狀態重複回報時不應往前跳")
    }

    func testLoadModelsPreselectsFirstProviderAndModel() async {
        let fake = FakeCardiaryService(modelsState: makeModelsState())
        let firstRun = FirstRunModel()
        firstRun.attach(service: fake)

        await firstRun.loadModels()

        XCTAssertEqual(firstRun.providers.map(\.providerId), ["local"])
        XCTAssertEqual(firstRun.selectedProviderId, "local")
        XCTAssertEqual(firstRun.selectedModelId, "small")
    }

    func testAddProviderSelectsFirstModelWhenNoProviderExists() async {
        let keychain = FakeKeychain()
        let fake = FakeCardiaryService(modelsState: SystemModelsState(
            providers: [],
            roles: [],
            resolved: []
        ))
        let firstRun = FirstRunModel(keychain: keychain)
        firstRun.attach(service: fake)
        firstRun.folderDidBecomeReady()
        await firstRun.loadModels()
        XCTAssertTrue(firstRun.providers.isEmpty)
        XCTAssertFalse(firstRun.canSave, "沒有供應商時不能儲存主力模型")

        firstRun.modelSettings.newProviderId = "local"
        firstRun.modelSettings.newProviderModels = "llama"
        await firstRun.addProvider()

        XCTAssertEqual(firstRun.providers.map(\.providerId), ["local"])
        XCTAssertEqual(firstRun.selectedProviderId, "local")
        XCTAssertEqual(firstRun.selectedModelId, "llama")
        XCTAssertTrue(firstRun.canSave)
        XCTAssertNil(firstRun.modelSettings.errorMessage)
    }

    func testStoreCredentialInFirstRunUsesShellKeychain() async {
        let keychain = FakeKeychain()
        let fake = FakeCardiaryService(modelsState: makeModelsState())
        let firstRun = FirstRunModel(keychain: keychain)
        firstRun.attach(service: fake)
        await firstRun.loadModels()

        firstRun.modelSettings.beginCredentialEntry(for: "local")
        firstRun.modelSettings.credentialInput = "first-run-test-key"
        await firstRun.modelSettings.storeCredential(for: "local")

        XCTAssertEqual(keychain.value("cardiary/provider/local"), "first-run-test-key")
        let providers = await fake.modelSetCalls.last?.providers
        XCTAssertEqual(providers?.first?.credentialRef, "cardiary/provider/local")
    }

    func testLoadModelsReusesConfiguredMainModel() async {
        let provider = Fixtures.modelProvider("local", models: ["small", "big"])
        let state = SystemModelsState(
            providers: [provider],
            roles: [ModelRoleSelection(role: .main, mode: .model, ref: ModelRef(providerId: "local", modelId: "big"))],
            resolved: []
        )
        let fake = FakeCardiaryService(modelsState: state)
        let firstRun = FirstRunModel()
        firstRun.attach(service: fake)

        await firstRun.loadModels()

        XCTAssertEqual(firstRun.selectedModelId, "big")
    }

    func testSaveMainModelSendsOnlyMainRole() async {
        let fake = FakeCardiaryService(modelsState: makeModelsState())
        let firstRun = FirstRunModel()
        firstRun.attach(service: fake)
        firstRun.folderDidBecomeReady()
        await firstRun.loadModels()
        firstRun.selectedModelId = "big"

        await firstRun.saveMainModel()

        let calls = await fake.modelSetCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertNil(calls[0].providers, "設定主力模型不應覆寫供應商設定")
        let roles = try! XCTUnwrap(calls[0].roles)
        XCTAssertEqual(roles.count, 1)
        XCTAssertEqual(roles[0].role, .main)
        XCTAssertEqual(roles[0].mode, .model)
        XCTAssertEqual(roles[0].ref, ModelRef(providerId: "local", modelId: "big"))
        XCTAssertTrue(firstRun.savedMainModel)
        XCTAssertEqual(firstRun.step, .conversation)
        XCTAssertNotNil(firstRun.message)
    }

    func testSkipModelGoesToConversationAndCanGoBack() {
        let firstRun = FirstRunModel()
        firstRun.folderDidBecomeReady()
        firstRun.skipModel()
        XCTAssertEqual(firstRun.step, .conversation)

        firstRun.editModel()
        XCTAssertEqual(firstRun.step, .model)
    }

    func testMarkCompleteFinishesSetup() {
        let firstRun = FirstRunModel()
        firstRun.folderDidBecomeReady()
        firstRun.markComplete()
        XCTAssertTrue(firstRun.isComplete)
    }
}
