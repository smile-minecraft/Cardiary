import CardiaryKit
import SwiftUI

/// 檢視欄的外部代理面板：會話狀態卡、進度、待核准與結果未知的提示。
public final class AgentsInspectorPanel: InspectorPanel {
    public let id = "agents"
    public let titleKey: AppString = .inspectorAgentsTitle
    public var subtitleKey: AppString? { nil }

    private let model: AgentModel

    public init(model: AgentModel) {
        self.model = model
    }

    public func makeBody() -> AnyView {
        AnyView(AgentsPanelView(model: model))
    }
}

struct AgentsPanelView: View {
    @ObservedObject var model: AgentModel

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            if !model.isKnown && model.sessions.isEmpty {
                emptyLine(AppL10n.text(.agentsUnavailable), systemImage: "bolt.horizontal.fill")
            } else if model.sessions.isEmpty {
                emptyLine(AppL10n.text(.inspectorAgentsEmpty), systemImage: "rectangle.stack")
            } else {
                ForEach(model.sessions) { session in
                    AgentCard(model: model, session: session)
                }
            }

            if let error = model.errorMessage {
                MessageBanner(text: error, systemImage: "exclamationmark.triangle", tone: .red)
            }
            if let notice = model.noticeMessage {
                MessageBanner(text: notice, systemImage: "checkmark.circle", tone: .sage)
            }
        }
    }

    private func emptyLine(_ text: String, systemImage: String) -> some View {
        HStack(spacing: DesignTokens.spacingS) {
            Image(systemName: systemImage)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Palette.sageInk)
                .frame(width: 22, height: 22)
                .background(Palette.sageSoft, in: Circle())
            Text(text)
                .font(.cardiary(.callout))
                .foregroundStyle(Palette.inkSecondary)
        }
    }
}

/// 一場代理會話：種類、狀態、進度，以及需要人決定的權限。
private struct AgentCard: View {
    @ObservedObject var model: AgentModel
    let session: AgentSessionPresentation

    private var isDeciding: Bool {
        model.decidingIds.contains(session.agentSessionId)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            HStack(alignment: .top, spacing: DesignTokens.spacingS) {
                Image(systemName: "cpu")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(width: 24, height: 24)
                    .background(Palette.sage, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.kindText())
                        .font(.cardiary(.callout, weight: .semibold))
                    Text(session.statusText())
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
            }

            if !session.workingDirectory.isEmpty {
                Text(AppL10n.format(.agentWorkingDirectory, value: session.workingDirectory))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            if let progress = session.progress {
                VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                    HStack {
                        Text(progress.label)
                            .font(.cardiary(.caption))
                        Spacer()
                        if let text = session.progressText() {
                            Text(text)
                                .font(.cardiary(.caption))
                                .foregroundStyle(Palette.inkSecondary)
                        }
                    }
                    if let fraction = session.progressFraction {
                        ProgressView(value: fraction)
                            .tint(Palette.sage)
                    }
                }
            }

            if let message = session.message, !message.isEmpty {
                Text(message)
                    .font(.cardiary(.caption))
                    .textSelection(.enabled)
                    .foregroundStyle(Palette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(DesignTokens.spacingS)
                    .background(Palette.surface.opacity(0.7), in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
            }

            // 代理在回報結果前結束時，說清楚結果無法確認，而不是留白讓人以為成功。
            if session.resultUnknown {
                VStack(alignment: .leading, spacing: 2) {
                    Label(AppL10n.text(.agentResultUnknown), systemImage: "questionmark.circle")
                        .font(.cardiary(.caption, weight: .semibold))
                    Text(AppL10n.text(.agentResultUnknownHelp))
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
                .foregroundStyle(Palette.orange)
            }

            if let permission = session.pendingPermission {
                VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                    Text(AppL10n.format(.agentPermissionTitle, value: permission.toolName))
                        .font(.cardiary(.caption, weight: .semibold))
                    if let description = permission.description, !description.isEmpty {
                        Text(description)
                            .font(.cardiary(.caption))
                            .textSelection(.enabled)
                            .foregroundStyle(Palette.ink)
                    }
                    if isDeciding {
                        HStack(spacing: DesignTokens.spacingS) {
                            SuitLoader(size: 7)
                            Text(AppL10n.text(.approvalDeciding))
                                .font(.cardiary(.caption))
                                .foregroundStyle(Palette.inkSecondary)
                        }
                    } else {
                        HStack(spacing: DesignTokens.spacingS) {
                            Button(AppL10n.text(.approvalApprove)) {
                                Task { await model.approve(session) }
                            }
                            .buttonStyle(.themePrimary)

                            Button(AppL10n.text(.approvalReject)) {
                                Task { await model.reject(session) }
                            }
                            .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                        }
                        .controlSize(.small)
                    }
                }
                .padding(DesignTokens.spacingS)
                .background(Palette.orangeSoft, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.sageSoft)
    }
}
