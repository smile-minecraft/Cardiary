import CardiaryKit
import CardiaryShellCore
import Combine
import Foundation

/// 首次設定：選資料夾、設定主力模型、開第一場對話。
///
/// 只有第一次啟動（殼沒有任何資料夾授權紀錄）會走這個流程。模型步驟與設定頁
/// 共用 `ModelsSettingsModel`：供應商、金鑰與角色都走同一條協定與同一個
/// 鑰匙圈介面，不在這裡另寫一份。主力模型可以跳過，之後在設定頁補；
/// 跳過不影響開對話。
@MainActor
public final class FirstRunModel: ObservableObject {
    public enum Step: Int, Equatable, Sendable {
        case folder
        case model
        case conversation
        case done
    }

    @Published public private(set) var step: Step = .folder
    @Published public private(set) var isSaving = false
    @Published public private(set) var savedMainModel = false
    @Published public private(set) var message: String?
    @Published public var selectedProviderId: String?
    @Published public var selectedModelId: String?

    /// 供應商、金鑰與角色選擇。與設定頁的模型分頁共用同一套行為。
    public let modelSettings: ModelsSettingsModel

    private var service: ModelSettingsService?

    public init(keychain: (any KeychainWriting)? = nil) {
        self.modelSettings = ModelsSettingsModel(keychain: keychain)
    }

    public func attach(service: ModelSettingsService) {
        self.service = service
        modelSettings.attach(service: service)
    }

    public func detach() {
        service = nil
        modelSettings.detach()
    }

    public var providers: [ModelProviderInfo] {
        modelSettings.providers
    }

    public var isLoadingModels: Bool {
        modelSettings.isLoading
    }

    public var selectedProvider: ModelProviderInfo? {
        providers.first { $0.providerId == selectedProviderId }
    }

    public var models: [ModelInfo] {
        selectedProvider?.models ?? []
    }

    public var canSave: Bool {
        guard let selectedProviderId, let selectedModelId else { return false }
        return !selectedProviderId.isEmpty && !selectedModelId.isEmpty
    }

    /// 資料夾可用之後才能設定模型。
    public func folderDidBecomeReady() {
        guard step == .folder else { return }
        step = .model
    }

    /// 讀取供應商與角色；連線一好就呼叫，失敗時畫面顯示主機給的原因。
    public func loadModels() async {
        guard service != nil else { return }
        await modelSettings.load()
        applySelection()
    }

    /// 新增供應商，成功後自動選第一個可用的模型。
    ///
    /// 首次設定沒有其他地方可以新增供應商，這一步是設定主力模型的前置。
    public func addProvider() async {
        await modelSettings.addProvider()
        applySelection()
    }

    /// 儲存主力模型。成功後進到「開對話」這一步。
    public func saveMainModel() async {
        guard let service, canSave, let providerId = selectedProviderId, let modelId = selectedModelId else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            _ = try await service.setModels(
                providers: nil,
                roles: [
                    ModelRoleSelection(
                        role: .main,
                        mode: .model,
                        ref: ModelRef(providerId: providerId, modelId: modelId)
                    )
                ],
                clientRequestId: ClientRequestID.next("models")
            )
            savedMainModel = true
            message = AppL10n.text(.firstRunModelSaved)
            step = .conversation
        } catch {
            message = errorText(error)
        }
    }

    public func skipModel() {
        step = .conversation
    }

    /// 首場對話建立好了：首次設定完成，之後啟動不再顯示這個流程。
    public func markComplete() {
        step = .done
    }

    public var isComplete: Bool { step == .done }

    /// 回到設定模型這一步（使用者從對話步驟按返回）。
    public func editModel() {
        step = .model
    }

    /// 主機已有主力模型就用它；否則選第一個供應商的第一個模型。
    /// 選到的模型可能已經不在清單裡（例如供應商被移除），換成第一個可用的組合。
    private func applySelection() {
        if let choice = modelSettings.choices[.main], choice.kind == .model,
            let providerId = choice.providerId, let modelId = choice.modelId
        {
            selectedProviderId = providerId
            selectedModelId = modelId
        } else if selectedProvider == nil {
            selectedProviderId = providers.first?.providerId
            selectedModelId = providers.first?.models.first?.modelId
        }
        if selectedProvider?.models.contains(where: { $0.modelId == selectedModelId }) != true {
            let provider = providers.first { $0.providerId == selectedProviderId } ?? providers.first
            selectedProviderId = provider?.providerId
            selectedModelId = provider?.models.first?.modelId
        }
    }

    private func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}
