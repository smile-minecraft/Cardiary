import Combine
import SwiftUI

/// 對話選擇列的選取狀態。
///
/// 「加入對話」按下以後，按鈕一律回到可按狀態：成功時外層會把 sheet 關掉；
/// 失敗時 sheet 留著、按鈕恢復可按，錯誤訊息由檢視直接呈現（模型把原因
/// 放在 `errorMessage`）。先前的寫法在失敗時 `addingId` 永遠不清空，整列
/// 按鈕全部永久鎖住，使用者看不到任何提示，只能關掉重開。
@MainActor
final class ConversationPickerSession: ObservableObject {
    /// 目前正在等待結果的對話識別碼；`nil` 代表沒有進行中的加入。
    @Published private(set) var addingId: String?

    public var isAdding: Bool { addingId != nil }

    /// 先鎖住該列按鈕、執行加入、不管成敗都解鎖；回傳加入是否成功。
    @discardableResult
    public func pick(
        _ sessionId: String,
        title: String,
        _ onPick: (String, String) async -> Bool
    ) async -> Bool {
        addingId = sessionId
        let ok = await onPick(sessionId, title)
        addingId = nil
        return ok
    }
}

/// 選擇要把通知卡片加入哪一個對話。
struct NotificationConversationPicker: View {
    let item: NotificationPresentation
    @ObservedObject var model: NotificationModel
    let onPick: (String, String) async -> Bool

    @StateObject private var picker = ConversationPickerSession()

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(NotificationL10n.text(.notificationChooseConversationTitle))
                .font(.cardiary(.title3, weight: .semibold))
                .padding([.top, .horizontal], DesignTokens.spacingM)

            if model.isLoadingConversations {
                Spacer()
                SuitLoader()
                    .frame(maxWidth: .infinity)
                Spacer()
            } else if model.conversations.isEmpty {
                Spacer()
                Text(NotificationL10n.text(.notificationConversationEmpty))
                    .font(.cardiary(.callout))
                    .foregroundStyle(Palette.inkSecondary)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(DesignTokens.spacingM)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(model.conversations, id: \.id) { session in
                            Button {
                                Task {
                                    // 失敗時 sheet 留著、按鈕恢復可按；原因顯示在下方。
                                    await picker.pick(session.id, title: session.title) { id, title in
                                        await onPick(id, title)
                                    }
                                }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(session.title)
                                            .font(.cardiary(.callout))
                                            .foregroundStyle(Palette.ink)
                                        Text(session.id)
                                            .font(.cardiary(.caption))
                                            .foregroundStyle(Palette.inkTertiary)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    if picker.addingId == session.id {
                                        SuitLoader(size: 7)
                                    }
                                }
                                .padding(.vertical, DesignTokens.spacingS)
                                .padding(.horizontal, DesignTokens.spacingM)
                                .contentShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
                                .background(Palette.sunken, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
                            }
                            .buttonStyle(.plain)
                            .disabled(picker.isAdding)
                        }
                    }
                    .padding(DesignTokens.spacingM)
                }
            }

            // 錯誤訊息要放在 sheet 裡面：放在 sheet 後方的通知面板使用者看不到，
            // 會以為按鈕壞掉。
            if let message = model.errorMessage {
                Text(message)
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.red)
                    .padding(.horizontal, DesignTokens.spacingM)
                    .multilineTextAlignment(.leading)
            }
            if let message = model.noticeMessage {
                Text(message)
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.sageInk)
                    .padding(.horizontal, DesignTokens.spacingM)
                    .multilineTextAlignment(.leading)
            }
            if model.errorMessage != nil || model.noticeMessage != nil {
                Spacer().frame(height: DesignTokens.spacingXS)
            }
        }
        .frame(minWidth: 420, minHeight: 340)
        .task { await model.loadConversations() }
    }
}
