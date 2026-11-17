import CardiaryKit
import SwiftUI

/// 對話畫面：標題、可見範圍的訊息、進行中的回覆與輸入框。
struct ConversationView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var conversation: ConversationModel

    init(model: AppModel) {
        self.model = model
        self.conversation = model.conversation
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            transcript
            ComposerView(model: model, conversation: conversation)
        }
        .background(Palette.canvas)
    }

    private var header: some View {
        HStack(spacing: DesignTokens.spacingM) {
            ZStack {
                RoundedRectangle(cornerRadius: DesignTokens.tileRadius, style: .continuous)
                    .fill(Palette.graySoft)
                    .frame(width: 34, height: 34)
                Image(systemName: Suit.spade.symbol)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Palette.grayInk)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(conversation.title.isEmpty ? AppL10n.text(.conversationUntitled) : conversation.title)
                    .font(.cardiary(.title3, weight: .bold))
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Circle()
                        .fill(statusTone.ink)
                        .frame(width: 6, height: 6)
                    Text(statusText)
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
            Spacer()
            if conversation.isLoadingInitial {
                SuitLoader()
            }
        }
        .padding(.horizontal, DesignTokens.spacingL)
        .padding(.vertical, DesignTokens.spacingM)
    }

    private var statusText: String {
        switch conversation.activeTurn?.state {
        case .some(.waitingApproval):
            return AppL10n.text(.statusWaitingApproval)
        case .some(.queued), .some(.running):
            return AppL10n.text(.statusRunning)
        default:
            return AppL10n.text(.statusIdle)
        }
    }

    private var statusTone: Tone {
        switch conversation.activeTurn?.state {
        case .some(.waitingApproval): return .orange
        case .some(.queued), .some(.running): return .red
        default: return .sage
        }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                    historyControls

                    ForEach(conversation.items) { item in
                        TranscriptRow(
                            item: item,
                            resendAction: item.id == conversation.lastUserMessageId
                                ? { Task { await conversation.resendLastUserMessage() } }
                                : nil,
                            canResend: conversation.canResendLastUserMessage,
                            isResending: conversation.isResending
                        )
                        .id(item.id)
                    }

                    if let streaming = conversation.streamingText {
                        StreamingRow(text: streaming)
                    }

                    if let approval = conversation.pendingApproval {
                        PendingApprovalRow(approval: approval)
                    }

                    Color.clear
                        .frame(height: 1)
                        .id(Self.bottomAnchor)
                }
                .frame(maxWidth: DesignTokens.transcriptMaxWidth, alignment: .leading)
                .padding(.horizontal, DesignTokens.spacingL)
                .padding(.vertical, DesignTokens.spacingS)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: conversation.items.count) { _, _ in
                proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
            }
            .onChange(of: conversation.streamingText) { _, _ in
                proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
            }
            .dropDestination(for: NotificationDrag.self) { items, _ in
                guard !items.isEmpty, let sessionId = conversation.sessionId else { return false }
                let title = conversation.title.isEmpty ? nil : conversation.title
                Task {
                    await model.notifications.addToConversation(
                        drags: items,
                        sessionId: sessionId,
                        conversationTitle: title
                    )
                }
                return true
            }
        }
    }

    @ViewBuilder
    private var historyControls: some View {
        if conversation.hasMoreHistory {
            Button {
                Task { await conversation.loadOlder() }
            } label: {
                HStack(spacing: DesignTokens.spacingXS) {
                    if conversation.isLoadingOlder {
                        SuitLoader(size: 7)
                    }
                    Text(AppL10n.text(conversation.isLoadingOlder ? .conversationLoadingOlder : .conversationLoadOlder))
                }
            }
            .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
            .controlSize(.small)
            .frame(maxWidth: .infinity)
        } else if !conversation.items.isEmpty {
            HStack(spacing: DesignTokens.spacingS) {
                Rectangle().fill(Palette.inkSecondary).frame(width: 24, height: 1)
                Text(AppL10n.text(.conversationNoMoreHistory))
                    .font(.cardiary(.caption2))
                    .foregroundStyle(Palette.inkSecondary)
                Rectangle().fill(Palette.inkSecondary).frame(width: 24, height: 1)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private static let bottomAnchor = "transcript-bottom"
}

/// 進行中的助理文字。
struct StreamingRow: View {
    let text: String

    var body: some View {
        AssistantBubble(text: text) {
            HStack(spacing: DesignTokens.spacingS) {
                SuitLoader(size: 7)
                Text(AppL10n.text(.conversationStreaming))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
            }
        }
    }
}

/// 待審批的提示。真正的核准介面由審批工作放進檢視欄。
struct PendingApprovalRow: View {
    let approval: ApprovalRequest

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.spacingM) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Palette.orange)
                    .frame(width: 30, height: 30)
                Image(systemName: "hand.raised.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Palette.onAccent)
            }
            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                Text(AppL10n.text(.inspectorApprovalsTitle))
                    .font(.cardiary(.caption, weight: .semibold))
                    .foregroundStyle(Palette.orangeInk)
                Text(approval.title)
                    .font(.cardiary(.callout, weight: .semibold))
                if let summary = approval.summary {
                    Text(summary)
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.orangeSoft)
    }
}
