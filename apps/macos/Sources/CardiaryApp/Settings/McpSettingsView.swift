import CardiaryKit
import SwiftUI

/// MCP 分頁：伺服器清單與新增表單。
public final class McpSettingsTab: SettingsTab {
    public let id = "mcp"
    public let titleKey: AppString = .settingsMcpTab
    private let model: McpSettingsModel

    public init(model: McpSettingsModel) {
        self.model = model
    }

    public func makeBody() -> AnyView {
        AnyView(McpSettingsView(model: model))
    }
}

struct McpSettingsView: View {
    @ObservedObject var model: McpSettingsModel

    @State private var name = ""
    @State private var transport: McpTransport = .stdio
    @State private var command = ""
    @State private var arguments = ""
    @State private var url = ""
    @State private var allowedHosts = ""
    @State private var persistentData = false
    @State private var hostDrafts: [String: String] = [:]
    @State private var serverToRemove: McpServerInfo?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                serversSection
                addSection
                banners
            }
            .padding(.horizontal, DesignTokens.spacingL)
            .padding(.bottom, DesignTokens.spacingL)
        }
        .scrollIndicators(.never)
        .task {
            if model.servers.isEmpty {
                await model.load()
            }
        }
        .alert(
            McpL10n.format(.mcpRemoveConfirmTitle, name: serverToRemove?.name ?? ""),
            isPresented: Binding(
                get: { serverToRemove != nil },
                set: { if !$0 { serverToRemove = nil } }
            ),
            presenting: serverToRemove
        ) { server in
            Button(McpL10n.text(.mcpRemove), role: .destructive) {
                serverToRemove = nil
                Task { await model.remove(server) }
            }
            Button(McpL10n.text(.mcpCancel), role: .cancel) {
                serverToRemove = nil
            }
        } message: { _ in
            Text(McpL10n.text(.mcpRemoveConfirmBody))
        }
    }

    private var serversSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            SuitHeading(title: McpL10n.text(.mcpServersTitle), suit: .heart)
            Text(McpL10n.text(.mcpServersHint))
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.inkSecondary)
            if model.isLoading && model.servers.isEmpty {
                LoadingSettingsView()
            } else if model.servers.isEmpty {
                Text(McpL10n.text(.mcpEmpty))
                    .font(.cardiary(.callout))
                    .foregroundStyle(Palette.inkSecondary)
            } else {
                ForEach(model.servers, id: \.serverId) { server in
                    serverRow(server)
                }
            }
            if model.awaitingApproval {
                HStack(spacing: DesignTokens.spacingS) {
                    ThemeChip(text: McpL10n.text(.mcpWaitingApproval), tone: .orange)
                    Text(McpL10n.text(.mcpApprovalSubmitted))
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.surface, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingL)
    }

    private func serverRow(_ server: McpServerInfo) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            HStack(spacing: DesignTokens.spacingS) {
                Text(server.name)
                    .font(.cardiary(.callout, weight: .semibold))
                ThemeChip(
                    text: McpL10n.text(transportKey(server.transport)),
                    tone: .gray
                )
                ThemeChip(
                    text: McpL10n.text(McpSettingsModel.stateKey(server.state)),
                    tone: stateTone(server.state)
                )
                Spacer()
                Toggle("", isOn: Binding(
                    get: { server.enabled },
                    set: { value in Task { await model.setEnabled(server, enabled: value) } }
                ))
                .labelsHidden()
                .toggleStyle(ThemeSwitchStyle())
                .disabled(model.updatingIds.contains(server.serverId))
                Button(McpL10n.text(.mcpRemove)) {
                    serverToRemove = server
                }
                .buttonStyle(ThemeButtonStyle(kind: .danger))
                .disabled(model.updatingIds.contains(server.serverId))
            }

            if server.transport == .http, let url = server.url, !url.isEmpty {
                Text(url)
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
                    .textSelection(.enabled)
            }
            if server.transport == .stdio {
                if let command = server.command, !command.isEmpty {
                    Text(stdioDescription(command: command, arguments: server.args ?? []))
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                        .textSelection(.enabled)
                    Text(McpL10n.text(.mcpStdioSecretNote))
                        .font(.cardiary(.caption2))
                        .foregroundStyle(Palette.inkSecondary)
                }
                if let summary = McpSettingsModel.persistentDataSummary(server.persistentData) {
                    Text(McpL10n.text(.mcpPersistentDataTitle))
                        .font(.cardiary(.caption, weight: .semibold))
                    Text(summary)
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
            if let failure = server.failure, !failure.isEmpty {
                Text(McpL10n.format(.mcpFailure, value: failure))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.redInk)
            }
            if server.transport == .http {
                allowedHostsEditor(server)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.surface, radius: DesignTokens.cardRadius, padding: DesignTokens.spacingL)
    }

    private func allowedHostsEditor(_ server: McpServerInfo) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(McpL10n.text(.mcpAllowedHosts))
                .font(.cardiary(.caption, weight: .semibold))
            if server.allowedHosts.isEmpty {
                Text(McpL10n.text(.mcpHostsEmpty))
                    .font(.cardiary(.caption2))
                    .foregroundStyle(Palette.inkSecondary)
            } else {
                ScrollView(.horizontal) {
                    HStack(spacing: DesignTokens.spacingXS) {
                        ForEach(server.allowedHosts, id: \.self) { host in
                            Button {
                                Task { await model.removeAllowedHost(host, from: server) }
                            } label: {
                                HStack(spacing: 3) {
                                    Text(host)
                                    Image(systemName: "xmark")
                                        .font(.system(size: 8, weight: .bold))
                                }
                            }
                            .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                            .accessibilityLabel(McpL10n.format(.mcpHostRemove, name: host))
                            .disabled(model.updatingIds.contains(server.serverId))
                        }
                    }
                }
                .scrollIndicators(.never)
            }
            HStack(spacing: DesignTokens.spacingS) {
                TextField(McpL10n.text(.mcpHostPlaceholder), text: hostDraft(server))
                Button(McpL10n.text(.mcpHostAdd)) {
                    let host = hostDrafts[server.serverId] ?? ""
                    hostDrafts[server.serverId] = ""
                    Task { await model.addAllowedHost(host, to: server) }
                }
                .disabled((hostDrafts[server.serverId] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
                .disabled(model.updatingIds.contains(server.serverId))
            }
        }
    }

    private var addSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            SuitHeading(title: McpL10n.text(.mcpAddTitle), suit: .spade)
            Picker(McpL10n.text(.mcpTransport), selection: $transport) {
                Text(McpL10n.text(.mcpTransportStdio)).tag(McpTransport.stdio)
                Text(McpL10n.text(.mcpTransportHTTP)).tag(McpTransport.http)
            }
            .pickerStyle(.segmented)
            TextField(McpL10n.text(.mcpName), text: $name)
            switch transport {
            case .stdio:
                TextField(McpL10n.text(.mcpCommand), text: $command)
                TextField(McpL10n.text(.mcpArguments), text: $arguments)
                Text(McpL10n.text(.mcpStdioSecretNote))
                    .font(.cardiary(.caption2))
                    .foregroundStyle(Palette.inkSecondary)
                Toggle(isOn: $persistentData) {
                    Text(McpL10n.text(.mcpPersistentDataToggle))
                        .font(.cardiary(.callout))
                }
                .toggleStyle(ThemeSwitchStyle())
                Text(McpL10n.text(.mcpPersistentDataHint))
                    .font(.cardiary(.caption2))
                    .foregroundStyle(Palette.inkSecondary)
            case .http:
                TextField(McpL10n.text(.mcpURL), text: $url)
                TextField(McpL10n.text(.mcpAllowedHosts), text: $allowedHosts)
                Text(McpL10n.text(.mcpAllowedHostsHint))
                    .font(.cardiary(.caption2))
                    .foregroundStyle(Palette.inkSecondary)
            }
            Text(McpL10n.text(.mcpApprovalNote))
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.inkSecondary)
            Button(McpL10n.text(.mcpCreate)) {
                Task {
                    let added = await model.add(
                        name: name,
                        transport: transport,
                        command: transport == .stdio ? command : nil,
                        arguments: transport == .stdio ? arguments : "",
                        url: transport == .http ? url : nil,
                        allowedHosts: transport == .http ? allowedHosts : "",
                        persistentData: persistentData
                    )
                    if added {
                        clearForm()
                    }
                }
            }
            .buttonStyle(ThemeButtonStyle(kind: .primary))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.surface, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingL)
    }

    private var banners: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            if let error = model.errorMessage {
                MessageBanner(text: error, systemImage: "exclamationmark.triangle", tone: .red)
            }
            if let notice = model.noticeMessage {
                MessageBanner(text: notice, systemImage: "checkmark.circle", tone: .sage)
            }
        }
    }

    private func clearForm() {
        name = ""
        command = ""
        arguments = ""
        url = ""
        allowedHosts = ""
        persistentData = false
    }

    private func hostDraft(_ server: McpServerInfo) -> Binding<String> {
        Binding(
            get: { hostDrafts[server.serverId] ?? "" },
            set: { hostDrafts[server.serverId] = $0 }
        )
    }

    private func transportKey(_ transport: McpTransport) -> McpString {
        switch transport {
        case .stdio: return .mcpTransportStdio
        case .http: return .mcpTransportHTTP
        }
    }

    private func stateTone(_ state: McpServerState) -> Tone {
        switch state {
        case .ready: return .sage
        case .disabled: return .gray
        case .failed: return .red
        }
    }

    private func stdioDescription(command: String, arguments: [String]) -> String {
        ([command] + arguments).joined(separator: " ")
    }
}
