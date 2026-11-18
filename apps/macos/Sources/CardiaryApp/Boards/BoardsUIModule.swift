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
        // 建立新對話會把主區域切到那場對話；記下原本的送出目標，送出失敗收回時還原。
        let previousTarget = PreviousSendTarget()
        model.createConversation = { [weak app] in
            guard let app else { return nil }
            previousTarget.conversationId = app.conversations.selectedId
            previousTarget.leftBoard = true
            return await app.createConversation()
        }
        // 只在「送到新對話」失敗時呼叫：收回剛建立的對話，並回到白板，
        // 讓白板上的錯誤訊息看得到。不回來的話主區域會停在已刪除的對話。
        model.deleteConversation = { [weak app] conversationId in
            guard let app else { return }
            defer { returnToBoard(app, restoring: previousTarget) }
            guard let service = app.service else { return }
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

    /// 主機的 session.deleted 事件可能比刪除的回應先到，那時 `AppModel` 已經把
    /// selection 改成清單第一場，所以不能只比對剛建立的那一場：只要仍停在某場對話
    /// （使用者沒有自己切到別的入口），就回到白板。
    private static func returnToBoard(_ app: AppModel, restoring previousTarget: PreviousSendTarget) {
        defer {
            previousTarget.conversationId = nil
            previousTarget.leftBoard = false
        }
        guard previousTarget.leftBoard, case .conversation = app.selection else { return }
        if let previous = previousTarget.conversationId,
           app.conversations.sessions.contains(where: { $0.id == previous }) {
            app.conversations.select(previous)
        }
        app.selectSlot(AppRegistry.boardsSlotId)
    }
}

/// 「送到新對話」之前選取的對話。只在主執行緒讀寫。
@MainActor
private final class PreviousSendTarget {
    var conversationId: String?
    /// 為了送出而建立對話、主區域因此離開白板。
    var leftBoard = false
}
