import SwiftUI

/// 一行訊息：成功與錯誤用同一個排版，顏色不同。審批面板與設定頁共用。
struct MessageBanner: View {
    let text: String
    let systemImage: String
    let tint: Color

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption)
            .foregroundStyle(tint)
            .textSelection(.enabled)
    }
}
