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
                emptyLine(AppL10n.text(.approvalServiceUnavailable), systemImage: "bolt.horizontal.fill")
            } else if model.requests.isEmpty {
                emptyLine(AppL10n.text(.inspectorApprovalsEmpty), systemImage: "checkmark")
            } else {
                ForEach(model.requests) { approval in
                    ApprovalCard(model: model, approval: approval)
                }
            }

            if model.isPaused {
                MessageBanner(text: AppL10n.text(.approvalPaused), systemImage: "pause.fill", tone: .orange)
            }
            if let error = model.errorMessage {
                MessageBanner(text: error, systemImage: "exclamationmark.triangle", tone: .red)
            }
            if let notice = model.noticeMessage {
                MessageBanner(text: notice, systemImage: "checkmark.circle", tone: .sage)
            }

            Button(role: .destructive) {
                Task { await model.pauseAll() }
            } label: {
                Label(AppL10n.text(.approvalPauseAll), systemImage: "pause.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.themeDanger)
            .disabled(!model.isKnown)
        }
    }

    private func emptyLine(_ text: String, systemImage: String) -> some View {
        HStack(spacing: DesignTokens.spacingS) {
            Image(systemName: systemImage)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Palette.sage)
                .frame(width: 22, height: 22)
                .background(Palette.sageSoft, in: Circle())
            Text(text)
                .font(.cardiary(.callout))
                .foregroundStyle(Palette.inkSecondary)
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
            HStack(alignment: .top, spacing: DesignTokens.spacingS) {
                Image(systemName: "hand.raised.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(width: 24, height: 24)
                    .background(Palette.orange, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(approval.title)
                        .font(.cardiary(.callout, weight: .semibold))
                    if let toolName = approval.toolName {
                        Text(AppL10n.format(.approvalTool, value: toolName))
                            .font(.cardiary(.caption))
                            .foregroundStyle(Palette.inkSecondary)
                    }
                }
            }
            if let summary = approval.summary, !summary.isEmpty {
                Text(summary)
                    .font(.cardiary(.caption))
                    .textSelection(.enabled)
                    .foregroundStyle(Palette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(DesignTokens.spacingS)
                    .background(Palette.surface.opacity(0.7), in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
            }

            if isDeciding {
                HStack(spacing: DesignTokens.spacingS) {
                    SuitLoader(size: 7)
                    Text(AppL10n.text(.approvalDeciding))
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
            } else {
                decisionButtons
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.orangeSoft)
    }

    private var decisionButtons: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            HStack(spacing: DesignTokens.spacingS) {
                Button(AppL10n.text(.approvalApprove)) {
                    Task { await model.approve(approval) }
                }
                .buttonStyle(.themePrimary)

                Button(AppL10n.text(.approvalReject)) {
                    Task { await model.reject(approval) }
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
            }
            if approval.supportsApproveAlways {
                Button(AppL10n.text(.approvalAlways)) {
                    Task { await model.approveAlways(approval) }
                }
                .buttonStyle(.themeLink)
            }
        }
        .controlSize(.small)
    }
}
