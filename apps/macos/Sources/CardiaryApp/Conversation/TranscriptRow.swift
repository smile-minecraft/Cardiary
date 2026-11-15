import CardiaryKit
import SwiftUI

/// 對話流的一列：使用者訊息、助理訊息、工具呼叫或結構化資料。
struct TranscriptRow: View {
    let item: ConversationItem

    var body: some View {
        switch item.kind {
        case .userText(let text):
            VStack(alignment: .trailing, spacing: DesignTokens.spacingXS) {
                Text(AppL10n.text(.messageRoleUser))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(text)
                    .textSelection(.enabled)
                    .padding(DesignTokens.spacingM)
                    .background(.tint.opacity(0.15), in: RoundedRectangle(cornerRadius: DesignTokens.messageBubbleRadius))
            }
            .frame(maxWidth: .infinity, alignment: .trailing)

        case .assistantText(let text, let status):
            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                Text(AppL10n.text(.messageRoleAssistant))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(text)
                    .textSelection(.enabled)
                    .padding(DesignTokens.spacingM)
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: DesignTokens.messageBubbleRadius))
                if status != .complete {
                    Text(statusLabel(status))
                        .font(.caption)
                        .foregroundStyle(status == .failed ? Color.red : Color.secondary)
                }
            }

        case .tool(let tool):
            ToolCallRow(tool: tool)

        case .ui(let block):
            UiBlockView(block: block)
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

/// 工具呼叫與結果收在同一張卡：名稱、輸入摘要、狀態與輸出。
struct ToolCallRow: View {
    let tool: ToolCallPresentation
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Button {
                isExpanded.toggle()
            } label: {
                HStack(spacing: DesignTokens.spacingS) {
                    Image(systemName: symbol)
                        .foregroundStyle(tint)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(tool.title ?? tool.name)
                            .font(.callout.weight(.medium))
                        Text(AppL10n.text(.conversationToolCall) + " · " + statusLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
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
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.leading, DesignTokens.spacingL)
            }
        }
        .padding(DesignTokens.spacingM)
        .background(.quaternary.opacity(0.2), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
    }

    private var symbol: String {
        switch tool.status {
        case .streaming: return "wrench.and.screwdriver"
        case .complete: return "checkmark.circle"
        case .failed: return "xmark.circle"
        case .interrupted: return "pause.circle"
        }
    }

    private var tint: Color {
        switch tool.status {
        case .streaming: return .accentColor
        case .complete: return .green
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
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption.weight(.semibold))
            Text(text)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .lineLimit(12)
        }
    }
}

/// `stream.ui` 的結構化資料。已知的 renderer 用原生元件畫，其餘顯示原始資料。
struct UiBlockView: View {
    let block: UiBlockPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(block.renderer)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            switch block.renderer {
            case "bar", "bars":
                bars
            case "table":
                table
            default:
                Text(JSONText.compact(block.data, limit: 600))
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }
        }
        .padding(DesignTokens.spacingM)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.2), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
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

    @ViewBuilder
    private var bars: some View {
        if rows.isEmpty {
            Text(JSONText.compact(block.data, limit: 600))
                .font(.system(.caption, design: .monospaced))
        } else {
            let maximum = max(rows.map(\.value).max() ?? 1, 0.0001)
            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: DesignTokens.spacingS) {
                        Text(row.label)
                            .font(.caption)
                            .frame(width: 120, alignment: .leading)
                            .lineLimit(1)
                        GeometryReader { geometry in
                            RoundedRectangle(cornerRadius: 3)
                                .fill(.tint.opacity(0.7))
                                .frame(width: max(2, geometry.size.width * row.value / maximum))
                        }
                        .frame(height: 10)
                        Text(row.value, format: .number.precision(.fractionLength(0...2)))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var table: some View {
        if rows.isEmpty {
            Text(JSONText.compact(block.data, limit: 600))
                .font(.system(.caption, design: .monospaced))
        } else {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack {
                        Text(row.label).font(.caption)
                        Spacer()
                        Text(row.value, format: .number)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
