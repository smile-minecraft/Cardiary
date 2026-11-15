import SwiftUI

/// 介面的尺寸與間距。數值只放這裡，畫面不寫魔術數字。
public enum DesignTokens {
    // 視窗
    public static let windowMinWidth: CGFloat = 900
    public static let windowMinHeight: CGFloat = 560
    public static let windowDefaultWidth: CGFloat = 1180
    public static let windowDefaultHeight: CGFloat = 760

    // 三欄
    public static let sidebarMinWidth: CGFloat = 190
    public static let sidebarIdealWidth: CGFloat = 230
    public static let sidebarMaxWidth: CGFloat = 320
    public static let contentMinWidth: CGFloat = 380
    public static let inspectorMinWidth: CGFloat = 240
    public static let inspectorIdealWidth: CGFloat = 300
    public static let inspectorMaxWidth: CGFloat = 420

    // 間距與圓角
    public static let spacingXS: CGFloat = 4
    public static let spacingS: CGFloat = 8
    public static let spacingM: CGFloat = 12
    public static let spacingL: CGFloat = 18
    public static let spacingXL: CGFloat = 26
    public static let cornerRadius: CGFloat = 8
    public static let cardRadius: CGFloat = 10

    // 對話
    public static let transcriptMaxWidth: CGFloat = 720
    public static let messageBubbleRadius: CGFloat = 12
    public static let composerMinHeight: CGFloat = 44

    // 設定與首次設定
    public static let settingsMaxWidth: CGFloat = 640
    public static let firstRunMaxWidth: CGFloat = 560
}
