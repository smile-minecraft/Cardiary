import AppKit
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
    @State private var kind: AgentKind = .opencode
    @State private var directory = ""
    @State private var prompt = ""

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            startSection

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

    /// 啟動表單：選代理種類、工作目錄與任務描述。真正的核准走原生審批面板。
    private var startSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(AppL10n.text(.agentStartTitle))
                .font(.cardiary(.callout, weight: .semibold))

            Picker(AppL10n.text(.agentStartKind), selection: $kind) {
                Text(AppL10n.text(.agentKindOpencode)).tag(AgentKind.opencode)
                Text(AppL10n.text(.agentKindClaudeCode)).tag(AgentKind.claudeCode)
            }
            .pickerStyle(.segmented)

            HStack(spacing: DesignTokens.spacingS) {
                TextField(AppL10n.text(.agentStartDirectory), text: $directory)
                    .textFieldStyle(ThemeFieldStyle())
                Button {
                    chooseDirectory()
                } label: {
                    Image(systemName: "folder")
                }
                .help(AppL10n.text(.unavailableChooseFolder))
                .controlSize(.small)
            }

            TextField(AppL10n.text(.agentStartPromptPlaceholder), text: $prompt, axis: .vertical)
                .textFieldStyle(ThemeFieldStyle())
                .lineLimit(2...5)

            Text(AppL10n.text(.agentStartNeedsApproval))
                .font(.cardiary(.caption2))
                .foregroundStyle(Palette.inkSecondary)

            HStack {
                Spacer()
                Button {
                    let chosenKind = kind
                    let chosenDirectory = directory
                    let chosenPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
                    Task {
                        let started = await model.start(
                            agentKind: chosenKind,
                            workingDirectory: chosenDirectory,
                            prompt: chosenPrompt.isEmpty ? nil : chosenPrompt
                        )
                        if started {
                            directory = ""
                            prompt = ""
                        }
                    }
                } label: {
                    Label(AppL10n.text(.agentStartAction), systemImage: "play.fill")
                }
                .buttonStyle(.themePrimary)
                .controlSize(.small)
                .disabled(model.isStarting)
            }
        }
        .themeBlock(Palette.surface)
    }

    private func chooseDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = AppL10n.text(.unavailableChooseFolder)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        directory = url.path
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

            // 結束的會話不能再停；其餘隨時可緊急停止。
            if session.status != .stopped {
                HStack {
                    Spacer()
                    Button(role: .destructive) {
                        Task { await model.stop(session) }
                    } label: {
                        Label(AppL10n.text(.agentStopAction), systemImage: "stop.fill")
                    }
                    .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .red))
                    .controlSize(.small)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.sageSoft)
    }
}
