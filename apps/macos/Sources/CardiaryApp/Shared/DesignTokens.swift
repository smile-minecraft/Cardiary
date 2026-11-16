import SwiftUI

/// 介面的尺寸與間距。數值只放這裡，畫面不寫魔術數字。顏色與字型在 `Shared/Theme/`。
public enum DesignTokens {
    // 視窗
    public static let windowMinWidth: CGFloat = 720
    public static let windowMinHeight: CGFloat = 520
    public static let windowDefaultWidth: CGFloat = 1180
    public static let windowDefaultHeight: CGFloat = 760

    // 三欄
    public static let sidebarMinWidth: CGFloat = 200
    public static let sidebarIdealWidth: CGFloat = 236
    public static let sidebarMaxWidth: CGFloat = 320
    public static let contentMinWidth: CGFloat = 380
    public static let inspectorMinWidth: CGFloat = 260
    public static let inspectorIdealWidth: CGFloat = 310
    public static let inspectorMaxWidth: CGFloat = 420

    // 間距與圓角：整體圓潤，色塊之間靠留白分開，不畫線。
    public static let spacingXS: CGFloat = 4
    public static let spacingS: CGFloat = 8
    public static let spacingM: CGFloat = 12
    public static let spacingL: CGFloat = 18
    public static let spacingXL: CGFloat = 26
    /// 輸入框與小色塊。
    public static let cornerRadius: CGFloat = 12
    /// 卡片與面板。
    public static let cardRadius: CGFloat = 18
    /// 大面板與對話框。
    public static let panelRadius: CGFloat = 24
    /// 小色塊（勾選框、總覽格）。
    public static let smallRadius: CGFloat = 5
    /// 圖示磚（頁首、審批、刪除確認）。
    public static let tileRadius: CGFloat = 11
    /// 按鈕的水平內距：一般與窄版（.small / .mini）。
    public static let buttonPaddingH: CGFloat = 16
    public static let buttonPaddingHCompact: CGFloat = 11
    /// 按鈕的垂直內距：一般與窄版（.small / .mini）。
    public static let buttonPaddingV: CGFloat = 7.5
    public static let buttonPaddingVCompact: CGFloat = 4.5
    /// 輸入框垂直內距。
    public static let fieldPaddingV: CGFloat = 7
    /// 分段控制與選單的垂直內距。
    public static let segmentedPaddingV: CGFloat = 5
    /// 列表與總覽格的列內距。
    public static let rowPadding: CGFloat = 10
    /// 刪除確認對話框的寬度。
    public static let deleteConfirmationWidth: CGFloat = 440

    // 對話
    public static let transcriptMaxWidth: CGFloat = 720
    public static let messageBubbleRadius: CGFloat = 18
    public static let composerMinHeight: CGFloat = 44
    /// 助理頭像的寬度加間距；工具卡與結構化資料往右縮同樣的距離。
    public static let assistantIndent: CGFloat = 40

    // 卡片庫
    public static let cardListWidth: CGFloat = 340

    // 設定與首次設定
    public static let settingsMaxWidth: CGFloat = 640
    public static let firstRunMaxWidth: CGFloat = 560
}
