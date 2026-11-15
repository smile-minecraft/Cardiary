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
            Divider()
            transcript
            Divider()
            ComposerView(model: model, conversation: conversation)
        }
    }

    private var header: some View {
        HStack(spacing: DesignTokens.spacingS) {
            VStack(alignment: .leading, spacing: 2) {
                Text(conversation.title.isEmpty ? AppL10n.text(.conversationUntitled) : conversation.title)
                    .font(.headline)
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if conversation.isLoadingInitial {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, DesignTokens.spacingM)
        .padding(.vertical, DesignTokens.spacingS)
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

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                    historyControls

                    ForEach(conversation.items) { item in
                        TranscriptRow(item: item)
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
                .padding(DesignTokens.spacingM)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: conversation.items.count) { _, _ in
                proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
            }
            .onChange(of: conversation.streamingText) { _, _ in
                proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
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
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(AppL10n.text(conversation.isLoadingOlder ? .conversationLoadingOlder : .conversationLoadOlder))
                }
            }
            .buttonStyle(.borderless)
            .frame(maxWidth: .infinity)
        } else if !conversation.items.isEmpty {
            Text(AppL10n.text(.conversationNoMoreHistory))
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
        }
    }

    private static let bottomAnchor = "transcript-bottom"
}

/// 進行中的助理文字。
struct StreamingRow: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(AppL10n.text(.messageRoleAssistant))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(text)
                .textSelection(.enabled)
                .padding(DesignTokens.spacingM)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: DesignTokens.messageBubbleRadius))
            HStack(spacing: DesignTokens.spacingXS) {
                ProgressView()
                    .controlSize(.small)
                Text(AppL10n.text(.conversationStreaming))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// 待審批的提示。真正的核准介面由審批工作放進檢視欄。
struct PendingApprovalRow: View {
    let approval: ApprovalRequest

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Label(AppL10n.text(.inspectorApprovalsTitle), systemImage: "hand.raised")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
            Text(approval.title)
                .font(.callout)
            if let summary = approval.summary {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(DesignTokens.spacingM)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
    }
}
