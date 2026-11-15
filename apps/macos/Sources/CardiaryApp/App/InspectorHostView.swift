import SwiftUI

/// 右側檢視欄。內容由 `InspectorRegistry` 決定，主視窗只負責寬度與收合。
struct InspectorHostView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                HStack {
                    Text(AppL10n.text(.inspectorTitle))
                        .font(.headline)
                    Spacer()
                    if let count = model.bridge.approvalCount, count > 0 {
                        Text("\(count)")
                            .font(.caption.bold())
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(.orange.opacity(0.2), in: Capsule())
                    }
                }

                ForEach(Array(model.inspector.all.enumerated()), id: \.offset) { _, panel in
                    VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                        Text(AppL10n.text(panel.titleKey))
                            .font(.subheadline.weight(.semibold))
                        if let subtitleKey = panel.subtitleKey {
                            Text(AppL10n.text(subtitleKey))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        panel.makeBody()
                    }
                    .padding(DesignTokens.spacingM)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
                }
            }
            .padding(DesignTokens.spacingM)
        }
        .background(Color(nsColor: .controlBackgroundColor))
    }
}

/// 設定頁：分頁由 `SettingsRegistry` 決定；模型與一般設定由主視窗補上。
struct SettingsView: View {
    @ObservedObject var model: AppModel
    @State private var selectedTabId: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(AppL10n.text(.settingsTitle))
                    .font(.title2.bold())
                Spacer()
            }
            .padding(DesignTokens.spacingL)

            TabView(selection: Binding(
                get: { selectedTabId ?? model.settings.all.first?.id ?? "" },
                set: { selectedTabId = $0 }
            )) {
                ForEach(Array(model.settings.all.enumerated()), id: \.offset) { _, tab in
                    tab.makeBody()
                        .tabItem { Text(AppL10n.text(tab.titleKey)) }
                        .tag(tab.id)
                }
            }
            .padding(.horizontal, DesignTokens.spacingL)
        }
        .frame(maxWidth: DesignTokens.settingsMaxWidth)
    }
}
