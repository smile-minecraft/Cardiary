import CardiaryKit
import CardiaryShellCore
import Foundation
import XCTest

@testable import CardiaryApp

/// 記憶體版的鑰匙圈：記下帳號與值，測試不碰系統鑰匙圈。
final class FakeKeychain: KeychainWriting, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: String] = [:]
    private var calls: [(account: String, value: String)] = []
    var storeSucceeds = true

    func store(account: String, value: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        calls.append((account, value))
        guard storeSucceeds else { return false }
        values[account] = value
        return true
    }

    func delete(account: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        values.removeValue(forKey: account)
        return true
    }

    func value(_ account: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return values[account]
    }

    var storeCalls: [(account: String, value: String)] {
        lock.lock()
        defer { lock.unlock() }
        return calls
    }
}

/// 模型分頁：載入、角色儲存、金鑰寫入與供應商新增。
///
/// 這裡斷言介面字串，固定用繁體中文，不跟著 CI runner 的系統語言。
@MainActor
final class ModelsSettingsModelTests: XCTestCase {
    private let secret = "sk-test-settings-0001"

    private func makeModel(keychain: (any KeychainWriting)? = nil) -> ModelsSettingsModel {
        ModelsSettingsModel(keychain: keychain, language: .zhHant)
    }

    private func stateWithOpenAI() -> SystemModelsState {
        let ref = ModelRef(providerId: "openai", modelId: "gpt-5")
        return SystemModelsState(
            providers: [Fixtures.modelProvider("openai", models: ["gpt-5", "gpt-5-mini"])],
            roles: [ModelRoleSelection(role: .main, mode: .model, ref: ref)],
            resolved: [ResolvedModelRole(role: .main, source: .configured, ref: ref)]
        )
    }

    func testLoadUsesHostProvidersAndRoles() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(modelsState: stateWithOpenAI()))

        await model.load()

        XCTAssertEqual(model.providers.map(\.providerId), ["openai"])
        XCTAssertEqual(model.choices[.main], .model(providerId: "openai", modelId: "gpt-5"))
        XCTAssertEqual(model.choices[.small], .unset, "主機沒有的角色保持未設定")
        XCTAssertEqual(
            ModelsSettingsModel.resolvedLabel(model.resolved(for: .main)),
            "openai / gpt-5"
        )
        XCTAssertEqual(model.availableChoices.count, 4, "未設定、無，加上兩個模型")
    }

    func testSaveRolesSendsAllFourRoles() async {
        let fake = FakeCardiaryService(modelsState: stateWithOpenAI())
        let model = makeModel()
        model.attach(service: fake)
        await model.load()

        model.choices[.small] = RoleChoice.none
        model.choices[.writing] = .model(providerId: "openai", modelId: "gpt-5-mini")
        await model.saveRoles()

        let call = await fake.modelSetCalls.last
        let roles = try? XCTUnwrap(call?.roles)
        XCTAssertEqual(roles?.count, 4)
        XCTAssertEqual(roles?.first { $0.role == .small }?.mode, ModelRoleMode.none)
        XCTAssertEqual(roles?.first { $0.role == .writing }?.ref?.modelId, "gpt-5-mini")
        XCTAssertEqual(roles?.first { $0.role == .systemOne }?.mode, ModelRoleMode.unset)
        XCTAssertEqual(model.noticeMessage, "已儲存角色設定；只影響新對話。")
    }

    func testStoreCredentialWritesKeychainAndSendsOnlyAccountName() async {
        let keychain = FakeKeychain()
        let fake = FakeCardiaryService(modelsState: stateWithOpenAI())
        let model = makeModel(keychain: keychain)
        model.attach(service: fake)
        await model.load()

        model.beginCredentialEntry(for: "openai")
        model.credentialInput = secret
        await model.storeCredential(for: "openai")

        XCTAssertEqual(keychain.value("cardiary/provider/openai"), secret)
        XCTAssertTrue(model.credentialInput.isEmpty, "寫入後輸入框立刻清空")
        XCTAssertNil(model.credentialProviderId)
        XCTAssertEqual(model.noticeMessage, "已寫入鑰匙圈，不會出現在其他畫面或日誌。")

        // 協定只帶帳號名；供應商清單裡沒有金鑰值。
        let providers = await fake.modelSetCalls.last?.providers
        XCTAssertEqual(providers?.first?.credentialRef, "cardiary/provider/openai")
        let encoded = try? JSONEncoder().encode(providers)
        XCTAssertFalse(
            String(data: encoded ?? Data(), encoding: .utf8)?.contains(secret) ?? true,
            "供應商設定不能含金鑰"
        )
    }

    func testStoreCredentialKeepsUnsavedRoleEdits() async {
        let keychain = FakeKeychain()
        let model = makeModel(keychain: keychain)
        model.attach(service: FakeCardiaryService(modelsState: stateWithOpenAI()))
        await model.load()
        model.choices[.small] = .model(providerId: "openai", modelId: "gpt-5-mini")

        model.beginCredentialEntry(for: "openai")
        model.credentialInput = secret
        await model.storeCredential(for: "openai")

        XCTAssertEqual(
            model.choices[.small],
            .model(providerId: "openai", modelId: "gpt-5-mini"),
            "只輸入金鑰不該丟掉還沒儲存的角色選擇"
        )
    }

    func testCredentialDoesNotRemainInAnyPublishedText() async {
        let keychain = FakeKeychain()
        let model = makeModel(keychain: keychain)
        model.attach(service: FakeCardiaryService(modelsState: stateWithOpenAI()))
        await model.load()
        model.beginCredentialEntry(for: "openai")
        model.credentialInput = secret
        await model.storeCredential(for: "openai")

        let published = [
            model.errorMessage ?? "",
            model.noticeMessage ?? "",
            String(describing: model.providers),
            String(describing: model.resolved),
            String(describing: model.choices),
            String(describing: model.newProviderId),
            String(describing: model.newProviderName),
            String(describing: model.newProviderBaseURL),
            String(describing: model.newProviderModels),
            model.credentialInput,
        ]
        for text in published {
            XCTAssertFalse(text.contains(secret), "介面狀態不能留下金鑰：\(text)")
        }

        let defaults = UserDefaults.standard.dictionaryRepresentation()
        XCTAssertFalse(
            String(describing: defaults).contains(secret),
            "金鑰不能進 UserDefaults"
        )
    }

    func testStoreCredentialWithoutKeychainFails() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(modelsState: stateWithOpenAI()))
        await model.load()
        model.credentialInput = secret

        await model.storeCredential(for: "openai")

        XCTAssertEqual(model.errorMessage, "無法寫入鑰匙圈。")
        XCTAssertEqual(model.credentialInput, secret, "寫入失敗時保留輸入，讓使用者重試")
    }

    func testStoreCredentialRequiresValue() async {
        let keychain = FakeKeychain()
        let model = makeModel(keychain: keychain)
        model.attach(service: FakeCardiaryService(modelsState: stateWithOpenAI()))
        await model.load()
        model.beginCredentialEntry(for: "openai")
        model.credentialInput = "   "

        await model.storeCredential(for: "openai")

        XCTAssertEqual(model.errorMessage, "先貼上金鑰。")
        XCTAssertTrue(keychain.storeCalls.isEmpty)
    }

    func testAddProviderParsesModelsAndRejectsInvalidInput() async {
        let fake = FakeCardiaryService(modelsState: stateWithOpenAI())
        let model = makeModel()
        model.attach(service: fake)
        await model.load()

        model.newProviderId = "Local"
        model.newProviderModels = "llama"
        await model.addProvider()
        XCTAssertEqual(model.errorMessage, "識別碼只能用英文小寫、數字、句點、底線與連字號，最多 64 個字元。")

        model.newProviderId = "openai"
        await model.addProvider()
        XCTAssertEqual(model.errorMessage, "已經有同一個識別碼的供應商。")

        model.newProviderId = "local"
        model.newProviderName = "本機"
        model.newProviderKind = .local
        model.newProviderBaseURL = "http://127.0.0.1:11434/v1"
        model.newProviderModels = "llama\nllama, mistral"
        await model.addProvider()

        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.providers.map(\.providerId), ["openai", "local"])
        let local = model.providers.last
        XCTAssertEqual(local?.models.map(\.modelId), ["llama", "mistral"], "重複的模型只留一個")
        XCTAssertEqual(local?.baseUrl, "http://127.0.0.1:11434/v1")
        XCTAssertTrue(model.newProviderId.isEmpty, "新增成功後清空表單")
    }

    func testSaveRolesWithoutServiceShowsError() async {
        let model = makeModel()
        await model.saveRoles()
        XCTAssertEqual(model.errorMessage, "還沒連上服務，設定需要連線。")
    }

    func testMessagesFollowInjectedLanguage() async {
        let english = ModelsSettingsModel(language: .en)
        await english.saveRoles()
        XCTAssertEqual(english.errorMessage, "Settings need a service connection.")

        let chinese = ModelsSettingsModel(language: .zhHant)
        await chinese.saveRoles()
        XCTAssertEqual(chinese.errorMessage, "還沒連上服務，設定需要連線。")
    }
}
