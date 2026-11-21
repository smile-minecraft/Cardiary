import CardiaryKit
import SwiftUI

/// 對話流的一列：使用者訊息、助理訊息、工具呼叫或結構化資料。
struct TranscriptRow: View {
    /// 目前的深淺色配置，交給嵌入的 MCP App 作為主題。
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.cardiaryScale) private var uiScale
    let item: ConversationItem
    /// 只有最後一則使用者訊息會帶非 nil 的重送動作；`isResending` 進行中時按鈕顯示明確狀態。
    let resendAction: (() -> Void)?
    let canResend: Bool
    let isResending: Bool

    init(
        item: ConversationItem,
        resendAction: (() -> Void)? = nil,
        canResend: Bool = true,
        isResending: Bool = false
    ) {
        self.item = item
        self.resendAction = resendAction
        self.canResend = canResend
        self.isResending = isResending
    }

    var body: some View {
        switch item.kind {
        case .userText(let text):
            HStack {
                Spacer(minLength: 60)
                VStack(alignment: .trailing, spacing: DesignTokens.spacingXS) {
                    Text(text)
                        .cardiaryFont(.body)
                        .lineSpacing(3 * min(2.0, max(0.75, uiScale)))
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Palette.pinkSoft, in: RoundedRectangle(cornerRadius: DesignTokens.messageBubbleRadius, style: .continuous))
                        .accessibilityLabel(AppL10n.text(.messageRoleUser) + "：" + text)
                    if let resendAction {
                        Button {
                            resendAction()
                        } label: {
                            HStack(spacing: DesignTokens.spacingXS) {
                                if isResending {
                                    SuitLoader(size: 7)
                                    Text(AppL10n.text(.conversationResending))
                                } else {
                                    Image(systemName: "arrow.clockwise")
                                        .cardiarySymbolFont(size: 9, weight: .bold)
                                    Text(AppL10n.text(.conversationResend))
                                }
                            }
                        }
                        .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                        .controlSize(.small)
                        .disabled(!canResend || isResending)
                        .accessibilityLabel(AppL10n.text(isResending ? .conversationResending : .conversationResend))
                    }
                }
            }

        case .assistantText(let text, let status):
            AssistantBubble(text: text) {
                if status != .complete {
                    ThemeChip(
                        text: statusLabel(status),
                        tone: status == .failed ? .red : .gray,
                        systemImage: status == .failed ? "exclamationmark" : nil
                    )
                }
            }

        case .tool(let tool):
            ToolCallRow(tool: tool)
                .padding(.leading, DesignTokens.assistantIndent)

        case .ui(let block):
            UiBlockView(block: block, colorScheme: colorScheme)
                .padding(.leading, DesignTokens.assistantIndent)
        }
    }

    private func statusLabel(_ status: MessageStatus) -> String {
        switch status {
        case .streaming: return AppL10n.text(.conversationStreaming)
        case .interrupted: return AppL10n.text(.conversationInterrupt)
        case .failed: return AppL10n.text(.conversationToolFailed)
        case .complete: return AppL10n.text(.conversationToolComplete)
        }
    }
}

/// 助理的一則訊息：左邊是牌組小頭像，右邊是白色色塊。
struct AssistantBubble<Footer: View>: View {
    let text: String
    @ViewBuilder var footer: Footer

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.spacingS) {
            ZStack {
                Circle()
                    .fill(Palette.redSoft)
                    .frame(width: 32, height: 32)
                CardFanMark(size: 17)
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                MarkdownView(text: text)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.messageBubbleRadius, style: .continuous))
                    .accessibilityLabel(AppL10n.text(.messageRoleAssistant) + "：" + text)
                footer
            }
            Spacer(minLength: 40)
        }
    }
}

/// 工具呼叫與結果收在同一張卡：名稱、輸入摘要、狀態與輸出。
struct ToolCallRow: View {
    let tool: ToolCallPresentation
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Button {
                isExpanded.toggle()
            } label: {
                HStack(spacing: DesignTokens.spacingS) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(tone.soft)
                            .frame(width: 26, height: 26)
                        Image(systemName: symbol)
                            .cardiarySymbolFont(size: 11, weight: .bold)
                            .foregroundStyle(tone.ink)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(tool.title ?? tool.name)
                            .cardiaryFont(.callout, weight: .semibold)
                        Text(AppL10n.text(.conversationToolCall) + " · " + statusLabel)
                            .cardiaryFont(.caption)
                            .foregroundStyle(Palette.inkSecondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .cardiarySymbolFont(size: 10, weight: .bold)
                        .foregroundStyle(Palette.inkTertiary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                    if !tool.inputSummary.isEmpty {
                        labeledJSON(AppL10n.text(.conversationToolCall), text: tool.inputSummary)
                    }
                    if let output = tool.outputText, !output.isEmpty {
                        labeledJSON(AppL10n.text(.conversationToolResult), text: output)
                    }
                    if tool.diagnosticCount > 0 {
                        Text("\(tool.diagnosticCount) diagnostics")
                            .cardiaryFont(.caption)
                            .foregroundStyle(Palette.inkSecondary)
                    }
                }
            }
        }
        .animation(.easeOut(duration: 0.15), value: isExpanded)
        .themeBlock(Palette.surface.opacity(0.7), radius: DesignTokens.cardRadius)
    }

    private var symbol: String {
        switch tool.status {
        case .streaming: return "wrench.and.screwdriver.fill"
        case .complete: return "checkmark"
        case .failed: return "xmark"
        case .interrupted: return "pause.fill"
        }
    }

    private var tone: Tone {
        switch tool.status {
        case .streaming: return .purple
        case .complete: return .sage
        case .failed: return .red
        case .interrupted: return .orange
        }
    }

    private var statusLabel: String {
        switch tool.status {
        case .streaming: return AppL10n.text(.conversationToolRunning)
        case .complete: return AppL10n.text(.conversationToolComplete)
        case .failed: return AppL10n.text(.conversationToolFailed)
        case .interrupted: return AppL10n.text(.conversationInterrupt)
        }
    }

    private func labeledJSON(_ title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .cardiaryFont(.caption, weight: .semibold)
                .foregroundStyle(Palette.inkSecondary)
            Text(text)
                .cardiaryMonospacedFont(.caption)
                .textSelection(.enabled)
                .lineLimit(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(DesignTokens.spacingS)
                .background(Palette.sunken, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
        }
    }
}

/// `stream.ui` 的結構化資料。已知的 renderer 用原生元件畫，其餘顯示原始資料。
struct UiBlockView: View {
    let block: UiBlockPresentation
    let colorScheme: ColorScheme

    /// Html 內容高度：頁面回報多少就用多少，至少留一個最小高度避免閃爍。
    @State private var contentHeight: CGFloat = 120

    /// 只有內容能被解析成 MCP App、且串流完成才掛載 WebView。
    private var app: McpAppBlockContent.Parsed? {
        McpAppBlockContent.parse(renderer: block.renderer, data: block.data)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            ThemeChip(text: block.renderer, tone: .purple, systemImage: "chart.bar.fill")

            if block.isReady, let app {
                McpAppSurface(
                    html: app.html,
                    allowedHosts: app.allowedHosts,
                    theme: colorScheme == .dark ? .dark : .light,
                    height: $contentHeight
                )
            } else {
                fallback
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.surface, radius: DesignTokens.cardRadius)
    }

    /// 網頁內容還沒準備好或不是 MCP App 時，顯示原本的原生呈現。
    @ViewBuilder
    private var fallback: some View {
        if !block.isReady && app != nil {
            HStack(spacing: DesignTokens.spacingS) {
                SuitLoader(size: 7)
                Text(AppL10n.text(.conversationStreaming))
                    .cardiaryFont(.caption)
                    .foregroundStyle(Palette.inkSecondary)
            }
        } else {
            switch block.renderer {
            case "bar", "bars":
                bars
            case "table":
                table
            default:
                Text(JSONText.compact(block.data, limit: 600))
                    .cardiaryMonospacedFont(.caption)
                    .textSelection(.enabled)
            }
        }
    }

    /// `{ "items": [{ "label": "...", "value": 0.4 }] }` 或 `[{...}]`。
    private var rows: [(label: String, value: Double)] {
        let items: [JSONValue]
        if case .object(let object) = block.data, let array = object["items"]?.arrayValue {
            items = array
        } else if case .array(let array) = block.data {
            items = array
        } else {
            return []
        }
        return items.compactMap { item in
            guard case .object(let object) = item else { return nil }
            let label = object["label"]?.stringValue ?? object["name"]?.stringValue ?? ""
            guard let value = number(object["value"]) else { return nil }
            return (label, value)
        }
    }

    private func number(_ value: JSONValue?) -> Double? {
        guard let value else { return nil }
        if case .number(let number) = value { return number }
        if case .string(let text) = value { return Double(text) }
        return nil
    }

    /// 長條依序用四個花色的顏色，再接紫色。
    private static let barTones: [Tone] = [.red, .orange, .pink, .purple, .gray]

    @ViewBuilder
    private var bars: some View {
        if rows.isEmpty {
            Text(JSONText.compact(block.data, limit: 600))
                .cardiaryMonospacedFont(.caption)
        } else {
            let maximum = max(rows.map(\.value).max() ?? 1, 0.0001)
            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    HStack(spacing: DesignTokens.spacingS) {
                        Text(row.label)
                            .cardiaryFont(.caption)
                            .frame(width: 120, alignment: .leading)
                            .lineLimit(1)
                        ThemeProgressBar(value: row.value / maximum, tone: Self.barTones[index % Self.barTones.count], height: 10)
                        Text(row.value, format: .number.precision(.fractionLength(0...2)))
                            .cardiaryFont(.caption, monospacedDigits: true)
                            .foregroundStyle(Palette.inkSecondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var table: some View {
        if rows.isEmpty {
            Text(JSONText.compact(block.data, limit: 600))
                .cardiaryMonospacedFont(.caption)
        } else {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack {
                        Text(row.label).cardiaryFont(.caption)
                        Spacer()
                        Text(row.value, format: .number)
                            .cardiaryFont(.caption, monospacedDigits: true)
                            .foregroundStyle(Palette.inkSecondary)
                    }
                }
            }
        }
    }
}
