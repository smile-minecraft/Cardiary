import SwiftUI

/// Cardiary 的標誌：兩張扇開的牌，前面那張印著紅心。全部用形狀畫，不用點陣圖。
struct CardFanMark: View {
    var size: CGFloat = 30

    var body: some View {
        ZStack {
            card(fill: Palette.pink)
                .rotationEffect(.degrees(-16), anchor: .bottom)
                .offset(x: -size * 0.12)
            card(fill: Palette.red)
                .rotationEffect(.degrees(10), anchor: .bottom)
                .offset(x: size * 0.1)
                .overlay {
                    Image(systemName: "suit.heart.fill")
                        .font(.system(size: size * 0.3, weight: .bold))
                        .foregroundStyle(Palette.onAccent)
                        .rotationEffect(.degrees(10))
                        .offset(x: size * 0.16, y: size * 0.02)
                }
        }
        .frame(width: size * 1.15, height: size)
        .accessibilityHidden(true)
    }

    private func card(fill: Color) -> some View {
        RoundedRectangle(cornerRadius: size * 0.16, style: .continuous)
            .fill(fill)
            .frame(width: size * 0.62, height: size * 0.84)
    }
}

/// 標誌加字標，左側欄頂端與首次設定使用。
struct BrandHeader: View {
    var markSize: CGFloat = 28
    var titleSize: CGFloat = 22

    var body: some View {
        HStack(spacing: DesignTokens.spacingS) {
            CardFanMark(size: markSize)
            Text(AppL10n.text(.appTitle))
                .font(.cardiary(size: titleSize, weight: .bold))
                .foregroundStyle(Palette.redInk)
        }
        .accessibilityElement(children: .combine)
    }
}
