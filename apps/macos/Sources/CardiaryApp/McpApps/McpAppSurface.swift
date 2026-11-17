import CardiaryKit
import SwiftUI

/// 把隔離的 `McpAppWebView` 放進 SwiftUI，並把頁面回報的高度接到外層。
///
/// 這是產品畫面唯一建立 McpAppWebView 的地方。`McpAppWebView` 本身不管高度，
/// 高度由它的 `onHeightChange` 回呼經由 Binding 傳上來，交由呼叫端決定容器大小；
/// 離開畫面時 `McpAppWebView.dismantleNSView` 會拆掉 WKWebView。
struct McpAppSurface: View {
    let html: String
    let allowedHosts: [String]
    let theme: McpAppTheme
    /// 頁面內容高度的上界約束：至少 120 點，最多 2048 點，避免惡意頁面無限撐高畫面。
    @Binding var height: CGFloat

    private static let heightRange: ClosedRange<CGFloat> = 120...2048

    var body: some View {
        McpAppWebView(
            html: html,
            allowedHosts: allowedHosts,
            context: McpAppHostContext(theme: theme, language: AppL10n.language),
            onHeightChange: { reported in
                let clamped = min(max(reported, Self.heightRange.lowerBound), Self.heightRange.upperBound)
                if clamped != height { height = clamped }
            }
        )
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
    }
}
