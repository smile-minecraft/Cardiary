import SwiftUI

/// 右側檢視欄。內容由 `InspectorRegistry` 決定，主視窗只負責寬度與收合。
struct InspectorHostView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var bridge: ShellBridge

    init(model: AppModel) {
        self.model = model
        self.bridge = model.bridge
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                ForEach(Array(model.inspector.all.enumerated()), id: \.offset) { index, panel in
                    VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                SuitHeading(
                                    title: AppL10n.text(panel.titleKey),
                                    suit: Self.panelSuits[index % Self.panelSuits.count],
                                    font: .cardiary(.callout, weight: .bold)
                                )
                                Spacer()
                                if panel.id == "approvals", let count = bridge.approvalCount, count > 0 {
                                    ThemeChip(text: "\(count)", tone: .orange, systemImage: "hand.raised.fill", filled: true)
                                }
                            }
                            if let subtitleKey = panel.subtitleKey {
                                Text(AppL10n.text(subtitleKey))
                                    .font(.cardiary(.caption))
                                    .foregroundStyle(Palette.inkSecondary)
                            }
                        }
                        panel.makeBody()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .themeBlock(Palette.surface, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingL)
                }
            }
            .padding(DesignTokens.spacingM)
        }
        .scrollIndicators(.never)
        .background(Palette.sidebar)
    }

    /// 面板標題的花色依序輪替：審批是紅心，上下文是方塊。
    private static let panelSuits: [Suit] = [.heart, .diamond, .club, .spade]
}

/// 設定頁：分頁由 `SettingsRegistry` 決定；模型與一般設定由主視窗補上。
///
/// 分頁用主題的分段選擇，不用系統的 `TabView`，避免出現框線。
struct SettingsView: View {
    @ObservedObject var model: AppModel
    @State private var selectedTabId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
            // 分頁名稱放不下時（例如英文的七個分頁）改成標題在上、分頁在下，
            // 不然固定寬度的分頁會把標題擠成逐字換行，整頁也被撐寬裁切。
            ViewThatFits(in: .horizontal) {
                HStack(spacing: DesignTokens.spacingL) {
                    title
                    Spacer()
                    tabs
                }
                VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                    title
                    tabs
                }
            }
            .padding(.horizontal, DesignTokens.spacingL)
            .padding(.top, DesignTokens.spacingL)

            if let tab = model.settings.all.first(where: { $0.id == currentTabId }) {
                tab.makeBody()
                    .id(tab.id)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxWidth: DesignTokens.settingsMaxWidth, maxHeight: .infinity, alignment: .top)
        .frame(maxWidth: .infinity)
        .background(Palette.canvas)
    }

    private var title: some View {
        ThemePageTitle(title: AppL10n.text(.settingsTitle), suit: .spade)
            .fixedSize()
    }

    private var tabs: some View {
        ThemeSegmented(
            selection: Binding(
                get: { currentTabId },
                set: { selectedTabId = $0 }
            ),
            options: model.settings.all.map { ($0.id, AppL10n.text($0.titleKey)) }
        )
        .fixedSize()
    }

    private var currentTabId: String {
        selectedTabId ?? model.settings.all.first?.id ?? ""
    }
}
