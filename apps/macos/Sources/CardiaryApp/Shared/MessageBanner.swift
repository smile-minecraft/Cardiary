import SwiftUI

/// 一則提示：成功、資訊與錯誤用同一個色塊排版，顏色不同。審批面板與設定頁共用。
struct MessageBanner: View {
    let text: String
    let systemImage: String
    var tone: Tone = .gray

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: DesignTokens.spacingS) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(tone.ink)
            Text(text)
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, DesignTokens.spacingM)
        .padding(.vertical, DesignTokens.spacingS)
        .background(tone.soft, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
    }
}
