import CardiaryKit
import SwiftUI

/// 白板介面的掛載點。位置由 `AppRegistry` 保留，這裡只換內容與模型。
@MainActor
public enum BoardsUIModule {
    public static func install(_ app: AppModel) {
        let model = BoardModel()
        model.selectedConversationId = { [weak app] in
            guard let app else { return nil }
            if case .conversation(let id) = app.selection {
                return id
            }
            return nil
        }
        model.conversationTargets = { [weak app] in
            guard let app else { return [] }
            return app.conversations.sessions.map {
                BoardModel.ConversationTarget(id: $0.id, title: $0.title)
            }
        }
        model.createConversation = { [weak app] in
            guard let app else { return nil }
            return await app.createConversation()
        }
        app.installBoardsUI(model)
    }
}
