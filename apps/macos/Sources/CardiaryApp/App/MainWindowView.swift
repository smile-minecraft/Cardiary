import AppKit
import SwiftUI

/// 三欄主視窗：左側欄、主內容、可調整寬度並收合的檢視欄。三欄用底色區分，不畫硬分隔線。
struct MainWindowView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var approvals: ApprovalModel
    @ObservedObject var uiScale: UIScaleStore

    @State private var inspectorWidth: CGFloat = DesignTokens.inspectorIdealWidth
    @State private var dragStartWidth: CGFloat?

    init(model: AppModel) {
        self.model = model
        self.approvals = model.approvals
        self.uiScale = model.uiScale
    }

    var body: some View {
        NavigationSplitView {
            SidebarView(model: model)
                .navigationSplitViewColumnWidth(
                    min: DesignTokens.sidebarMinWidth,
                    ideal: DesignTokens.sidebarIdealWidth,
                    max: DesignTokens.sidebarMaxWidth
                )
        } detail: {
            GeometryReader { proxy in
                let resolvedInspectorWidth = Self.clampedInspectorWidth(
                    preferred: inspectorWidth,
                    totalWidth: proxy.size.width
                )

                HStack(spacing: 0) {
                    VStack(spacing: 0) {
                        ConnectionBanner(model: model)
                        MainContentView(model: model)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.canvas)

                    if model.isInspectorVisible {
                        InspectorResizeHandle(
                            onChanged: { deltaX in
                                let baseline = dragStartWidth ?? resolvedInspectorWidth
                                if dragStartWidth == nil {
                                    dragStartWidth = baseline
                                }
                                let maxAllowed = Self.maxInspectorWidth(forTotalWidth: proxy.size.width)
                                let minAllowed = min(DesignTokens.inspectorMinWidth, maxAllowed)
                                inspectorWidth = min(maxAllowed, max(minAllowed, baseline - deltaX))
                            },
                            onEnded: {
                                dragStartWidth = nil
                            }
                        )

                        InspectorHostView(model: model)
                            .frame(width: resolvedInspectorWidth)
                            .frame(maxHeight: .infinity)
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
                .background(Palette.canvas)
                .animation(.easeOut(duration: 0.2), value: model.isInspectorVisible)
            }
        }
        .toolbarBackground(Palette.canvas, for: .windowToolbar)
        .toolbar {
            if !uiScale.isDefault {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        uiScale.reset()
                    } label: {
                        Text(uiScale.percentageText)
                            .cardiaryFont(.caption2, weight: .semibold, monospacedDigits: true)
                    }
                    .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                    .controlSize(.small)
                    .help(AppL10n.text(.settingsZoomReset))
                    .accessibilityLabel("\(AppL10n.text(.settingsZoomLabel)) \(uiScale.percentageText)")
                }
            }
            if !model.isInspectorVisible && approvals.count > 0 {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        model.showApprovals()
                    } label: {
                        Label("\(approvals.count)", systemImage: "hand.raised.fill")
                            .labelStyle(.titleAndIcon)
                    }
                    .help(AppL10n.text(.inspectorApprovalsTitle))
                    .accessibilityLabel("\(AppL10n.text(.inspectorApprovalsTitle)) \(approvals.count)")
                }
            }
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

    private static func maxInspectorWidth(forTotalWidth totalWidth: CGFloat) -> CGFloat {
        let remaining = max(0, totalWidth - DesignTokens.contentMinWidth)
        if remaining >= DesignTokens.inspectorMinWidth {
            return min(DesignTokens.inspectorMaxWidth, remaining)
        }
        return max(160, min(DesignTokens.inspectorMaxWidth, totalWidth * 0.42))
    }

    private static func clampedInspectorWidth(preferred: CGFloat, totalWidth: CGFloat) -> CGFloat {
        guard totalWidth > 0 else { return DesignTokens.inspectorIdealWidth }
        let maxAllowed = maxInspectorWidth(forTotalWidth: totalWidth)
        let minAllowed = min(DesignTokens.inspectorMinWidth, maxAllowed)
        return min(maxAllowed, max(minAllowed, preferred))
    }
}

/// 檢視欄左側的柔和拖曳手把：懸停時顯示膠囊指示並切換游標，不畫生硬直線。
private struct InspectorResizeHandle: View {
    let onChanged: (CGFloat) -> Void
    let onEnded: () -> Void

    @State private var isHovered = false
    @State private var isDragging = false

    var body: some View {
        ZStack {
            Palette.sidebar
            Capsule(style: .continuous)
                .fill(isHovered || isDragging ? Palette.inkTertiary : Palette.hover)
                .frame(width: 3, height: isHovered || isDragging ? 34 : 18)
                .animation(.easeOut(duration: 0.12), value: isHovered || isDragging)
        }
        .frame(width: 6)
        .frame(maxHeight: .infinity)
        .contentShape(Rectangle())
        .onHover { hovering in
            if hovering != isHovered {
                isHovered = hovering
                if hovering {
                    NSCursor.resizeLeftRight.push()
                } else {
                    NSCursor.pop()
                }
            }
        }
        .onDisappear {
            if isHovered {
                isHovered = false
                NSCursor.pop()
            }
        }
        .gesture(
            DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { value in
                    isDragging = true
                    onChanged(value.translation.width)
                }
                .onEnded { _ in
                    isDragging = false
                    onEnded()
                }
        )
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
