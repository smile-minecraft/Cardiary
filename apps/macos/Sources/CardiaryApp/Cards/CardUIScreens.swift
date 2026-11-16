import CardiaryKit
import SwiftUI

/// 卡片介面接上 App 的那一組：模型、畫面與檢視欄面板。
///
/// `CardUIModule.makeScreens` 回傳 `live(app:)`；`App/` 只需要改那一行。
/// `cardCommands` 與 `freshnessSettings` 先留空：選單與設定頁不在 M1 範圍，
/// 加上去會動到既有掛載點的測試斷言。
@MainActor
extension CardUIScreens {
    public static func live(app: AppModel) -> CardUIScreens {
        let freshness = CardFreshnessStore()
        let library = CardLibraryModel(
            freshness: freshness,
            mediaProvider: { app.media }
        )
        let inspector = ContextInspectorModel(freshness: freshness)
        let archive = ArchiveModel()
        let coordinator = CardContentCoordinator(
            library: library,
            inspector: inspector,
            archive: archive
        )
        return CardUIScreens(
            models: [coordinator],
            cardLibrary: { AnyView(CardLibraryView(model: library)) },
            archive: { AnyView(ArchiveView(model: archive)) },
            contextInspector: { ContextInspectorPanel(model: inspector, app: app) }
        )
    }
}

/// 把服務的生命週期與事件轉發給三個模型。`AppModel` 不認識模型的型別，
/// 只呼叫這四個方法。
@MainActor
final class CardContentCoordinator: AppContentModel {
    private let library: CardLibraryModel
    private let inspector: ContextInspectorModel
    private let archive: ArchiveModel

    init(library: CardLibraryModel, inspector: ContextInspectorModel, archive: ArchiveModel) {
        self.library = library
        self.inspector = inspector
        self.archive = archive
    }

    func attach(service: any CardiaryService) {
        library.attach(service: service)
        inspector.attach(service: service, cardService: service)
        archive.attach(management: service, sessions: service)
    }

    func detach() {
        library.attach(service: nil)
        inspector.attach(service: nil, cardService: nil)
        archive.detach()
    }

    func handle(event frame: ServerFrame) {
        inspector.handle(frame: frame)
        archive.handle(frame: frame)
        if case .cardChangedEvent(let event) = frame {
            let payload = event.payload
            Task { await library.handleCardChanged(payload) }
        }
    }

    func handleEpochChange(epoch: String) async {
        await library.reload()
        await inspector.reload()
        await archive.reload()
    }

    func refresh() async {
        await library.reload()
    }
}
