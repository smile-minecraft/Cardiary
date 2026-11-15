import SwiftUI

/// 三欄主視窗：左側欄、主內容、可收合的檢視欄。三欄用底色區分，不畫分隔線。
struct MainWindowView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationSplitView {
            SidebarView(model: model)
                .navigationSplitViewColumnWidth(
                    min: DesignTokens.sidebarMinWidth,
                    ideal: DesignTokens.sidebarIdealWidth,
                    max: DesignTokens.sidebarMaxWidth
                )
        } detail: {
            HStack(spacing: 0) {
                VStack(spacing: 0) {
                    ConnectionBanner(model: model)
                    MainContentView(model: model)
                }
                .frame(minWidth: DesignTokens.contentMinWidth, maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.canvas)

                if model.isInspectorVisible {
                    InspectorHostView(model: model)
                        .frame(
                            minWidth: DesignTokens.inspectorMinWidth,
                            idealWidth: DesignTokens.inspectorIdealWidth,
                            maxWidth: DesignTokens.inspectorMaxWidth,
                            maxHeight: .infinity
                        )
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            // 檢視欄與內容欄都以可用寬度排列；視窗縮小時不能讓內容溢出被裁切。
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Palette.canvas)
            .animation(.easeOut(duration: 0.2), value: model.isInspectorVisible)
        }
        .toolbarBackground(Palette.canvas, for: .windowToolbar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    model.toggleInspector()
                } label: {
                    Label(
                        AppL10n.text(model.isInspectorVisible ? .inspectorHide : .inspectorShow),
                        systemImage: "sidebar.trailing"
                    )
                    .labelStyle(.iconOnly)
                    .foregroundStyle(model.isInspectorVisible ? Palette.redInk : Palette.inkSecondary)
                }
                .buttonStyle(ThemeIconButtonStyle(diameter: 30))
                .help(AppL10n.text(model.isInspectorVisible ? .inspectorHide : .inspectorShow))
            }
        }
    }
}

/// 主內容：對話或左側欄其他入口的畫面。
struct MainContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        switch model.selection {
        case .conversation:
            ConversationView(model: model)
        case .slot(let id):
            slotContent(id)
        case .none:
            PlaceholderTextView(messageKey: .conversationSelectPrompt)
        }
    }

    @ViewBuilder
    private func slotContent(_ id: String) -> some View {
        if id == AppRegistry.settingsSlotId {
            SettingsView(model: model)
        } else if let slot = model.sidebar.slot(id) {
            if let content = slot.content {
                content()
            } else {
                PlaceholderTextView(messageKey: slot.placeholderKey)
            }
        } else {
            PlaceholderTextView(messageKey: .placeholderComingSoon)
        }
    }
}
