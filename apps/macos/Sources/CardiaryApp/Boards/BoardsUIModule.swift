import CardiaryKit
import SwiftUI

/// 白板介面的掛載點。位置由 `AppRegistry` 保留，這裡只換內容與模型。
@MainActor
public enum BoardsUIModule {
    public static func install(_ app: AppModel) {
        let model = BoardModel()
        model.selectedConversationId = { [weak app] in
            // 白板頁籤下 selection 不是對話，仍沿用清單最後選取的對話。
            app?.conversations.selectedId
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
        model.deleteConversation = { [weak app] conversationId in
            guard let app, let service = app.service else { return }
            do {
                let response = try await service.deleteSession(
                    sessionId: conversationId,
                    clientRequestId: ClientRequestID.next("session-delete")
                )
                for deletedId in response.deletedSessionIds + [conversationId] {
                    app.conversations.remove(id: deletedId)
                }
            } catch {
                // 刪不掉就留在清單，讓使用者自行處理；送出的錯誤訊息已經顯示。
            }
        }
        app.installBoardsUI(model)
    }
}
