import SwiftUI

/// 把側欄的一個對話列變成通知的放置目標。
///
/// 拖曳經過時把 `isTargeted` 交給外層畫高亮；放下後由 `NotificationDropTarget`
/// 先選取對話、再加入通知。
struct NotificationDropRow<Content: View>: View {
    let conversationId: String
    let conversationTitle: String?
    let displayTitle: String
    let target: NotificationDropTarget
    private let content: (_ isTargeted: Bool) -> Content

    @State private var isTargeted = false

    init(
        conversationId: String,
        conversationTitle: String?,
        displayTitle: String,
        target: NotificationDropTarget,
        @ViewBuilder content: @escaping (_ isTargeted: Bool) -> Content
    ) {
        self.conversationId = conversationId
        self.conversationTitle = conversationTitle
        self.displayTitle = displayTitle
        self.target = target
        self.content = content
    }

    var body: some View {
        content(isTargeted)
            .dropDestination(for: NotificationDrag.self) { drags, _ in
                guard !drags.isEmpty else { return false }
                Task {
                    await target.performDrop(
                        drags,
                        conversationId: conversationId,
                        conversationTitle: conversationTitle,
                        displayTitle: displayTitle
                    )
                }
                return true
            } isTargeted: { targeted in
                isTargeted = targeted
            }
    }
}
