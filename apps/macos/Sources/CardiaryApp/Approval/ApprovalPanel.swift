import CardiaryKit
import SwiftUI

/// 檢視欄的審批面板：待審批清單、三個決定與緊急全部暫停。
///
/// 面板只顯示主機送來的選項；主機沒有提供「一律允許」時就不出現那個按鈕。
public final class ApprovalInspectorPanel: InspectorPanel {
    public let id = "approvals"
    public let titleKey: AppString = .inspectorApprovalsTitle
    public var subtitleKey: AppString? { nil }

    private let model: ApprovalModel

    public init(model: ApprovalModel) {
        self.model = model
    }

    public func makeBody() -> AnyView {
        AnyView(ApprovalPanelView(model: model))
    }
}

struct ApprovalPanelView: View {
    @ObservedObject var model: ApprovalModel

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            if !model.isKnown {
                Text(AppL10n.text(.approvalServiceUnavailable))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else if model.requests.isEmpty {
                Text(AppL10n.text(.inspectorApprovalsEmpty))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.requests) { approval in
                    ApprovalCard(model: model, approval: approval)
                }
            }

            if model.isPaused {
                Label(AppL10n.text(.approvalPaused), systemImage: "pause.circle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            if let error = model.errorMessage {
                MessageBanner(text: error, systemImage: "exclamationmark.triangle", tint: .red)
            }
            if let notice = model.noticeMessage {
                MessageBanner(text: notice, systemImage: "checkmark.circle", tint: .secondary)
            }

            Divider()

            Button(role: .destructive) {
                Task { await model.pauseAll() }
            } label: {
                Label(AppL10n.text(.approvalPauseAll), systemImage: "pause.circle")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .disabled(!model.isKnown)
        }
    }
}

/// 一筆待審批：標題、工具與輸入摘要、三個決定。
private struct ApprovalCard: View {
    @ObservedObject var model: ApprovalModel
    let approval: ApprovalPresentation

    private var isDeciding: Bool {
        model.decidingIds.contains(approval.approvalId)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(approval.title)
                .font(.callout.weight(.semibold))
            if let toolName = approval.toolName {
                Text(AppL10n.format(.approvalTool, value: toolName))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let summary = approval.summary, !summary.isEmpty {
                Text(summary)
                    .font(.caption)
                    .textSelection(.enabled)
                    .foregroundStyle(.secondary)
            }

            if isDeciding {
                HStack(spacing: DesignTokens.spacingXS) {
                    ProgressView()
                        .controlSize(.small)
                    Text(AppL10n.text(.approvalDeciding))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                decisionButtons
            }
        }
        .padding(DesignTokens.spacingM)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
    }

    private var decisionButtons: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            HStack(spacing: DesignTokens.spacingS) {
                Button(AppL10n.text(.approvalApprove)) {
                    Task { await model.approve(approval) }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)

                Button(AppL10n.text(.approvalReject)) {
                    Task { await model.reject(approval) }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            if approval.supportsApproveAlways {
                Button(AppL10n.text(.approvalAlways)) {
                    Task { await model.approveAlways(approval) }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
    }
}
