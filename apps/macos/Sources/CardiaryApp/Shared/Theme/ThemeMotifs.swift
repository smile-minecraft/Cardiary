import SwiftUI

// 撲克牌主題的自繪圖案。全部用形狀畫、用主題色填色，沒有點陣圖；
// 大小跟著外框縮放，放進 `ThemeIconTile` 或直接當裝飾都可以。

// MARK: - 小丑帽

/// 三角小丑帽：紅色帽身、粉色帽緣、橘色鈴鐺。
struct JesterHatMotif: View {
    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                JesterHatShape()
                    .fill(Palette.red)
                RoundedRectangle(cornerRadius: size.height * 0.08, style: .continuous)
                    .fill(Palette.pink)
                    .frame(width: size.width * 0.68, height: size.height * 0.2)
                    .position(x: size.width * 0.5, y: size.height * 0.78)
                Image(systemName: "suit.diamond.fill")
                    .font(.system(size: size.height * 0.13, weight: .bold))
                    .foregroundStyle(Palette.onAccent)
                    .position(x: size.width * 0.5, y: size.height * 0.78)
                ForEach(Array(Self.bells.enumerated()), id: \.offset) { _, point in
                    Circle()
                        .fill(Palette.orange)
                        .frame(width: size.width * 0.15, height: size.width * 0.15)
                        .position(x: size.width * point.x, y: size.height * point.y)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private static let bells: [CGPoint] = [
        CGPoint(x: 0.07, y: 0.3), CGPoint(x: 0.5, y: 0.1), CGPoint(x: 0.93, y: 0.3),
    ]
}

private struct JesterHatShape: Shape {
    func path(in rect: CGRect) -> Path {
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + rect.width * x, y: rect.minY + rect.height * y)
        }
        var path = Path()
        path.move(to: p(0.2, 0.74))
        path.addQuadCurve(to: p(0.07, 0.3), control: p(0.04, 0.6))
        path.addQuadCurve(to: p(0.37, 0.52), control: p(0.27, 0.3))
        path.addQuadCurve(to: p(0.5, 0.1), control: p(0.36, 0.24))
        path.addQuadCurve(to: p(0.63, 0.52), control: p(0.64, 0.24))
        path.addQuadCurve(to: p(0.93, 0.3), control: p(0.73, 0.3))
        path.addQuadCurve(to: p(0.8, 0.74), control: p(0.96, 0.6))
        path.closeSubpath()
        return path
    }
}

// MARK: - 蝴蝶結

/// 粉紅蝴蝶結。
struct BowMotif: View {
    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                // 兩條尾巴
                ForEach([-1.0, 1.0], id: \.self) { side in
                    RoundedRectangle(cornerRadius: size.width * 0.05, style: .continuous)
                        .fill(Palette.red.opacity(0.85))
                        .frame(width: size.width * 0.14, height: size.height * 0.36)
                        .rotationEffect(.degrees(side * 24))
                        .position(x: size.width * (0.5 + side * 0.1), y: size.height * 0.68)
                }
                // 兩個圈
                ForEach([-1.0, 1.0], id: \.self) { side in
                    Ellipse()
                        .fill(Palette.pink)
                        .frame(width: size.width * 0.44, height: size.height * 0.34)
                        .rotationEffect(.degrees(side * -18))
                        .position(x: size.width * (0.5 + side * 0.22), y: size.height * 0.42)
                }
                Circle()
                    .fill(Palette.red)
                    .frame(width: size.width * 0.2, height: size.width * 0.2)
                    .position(x: size.width * 0.5, y: size.height * 0.44)
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - 皇冠

/// 粉色皇冠：紅色冠帶、橘色寶珠。
struct CrownMotif: View {
    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                CrownShape()
                    .fill(Palette.pink)
                RoundedRectangle(cornerRadius: size.height * 0.06, style: .continuous)
                    .fill(Palette.red)
                    .frame(width: size.width * 0.72, height: size.height * 0.16)
                    .position(x: size.width * 0.5, y: size.height * 0.76)
                Image(systemName: "suit.heart.fill")
                    .font(.system(size: size.height * 0.11, weight: .bold))
                    .foregroundStyle(Palette.onAccent)
                    .position(x: size.width * 0.5, y: size.height * 0.76)
                ForEach(Array(Self.gems.enumerated()), id: \.offset) { _, point in
                    Circle()
                        .fill(Palette.orange)
                        .frame(width: size.width * 0.12, height: size.width * 0.12)
                        .position(x: size.width * point.x, y: size.height * point.y)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private static let gems: [CGPoint] = [
        CGPoint(x: 0.13, y: 0.27), CGPoint(x: 0.5, y: 0.16), CGPoint(x: 0.87, y: 0.27),
    ]
}

private struct CrownShape: Shape {
    func path(in rect: CGRect) -> Path {
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + rect.width * x, y: rect.minY + rect.height * y)
        }
        var path = Path()
        path.move(to: p(0.16, 0.8))
        path.addLine(to: p(0.13, 0.3))
        path.addLine(to: p(0.34, 0.5))
        path.addLine(to: p(0.5, 0.2))
        path.addLine(to: p(0.66, 0.5))
        path.addLine(to: p(0.87, 0.3))
        path.addLine(to: p(0.84, 0.8))
        path.closeSubpath()
        return path
    }
}

// MARK: - 四角星

/// 圓弧四角星，可指定顏色。
struct SparkleShape: Shape {
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let rx = rect.width / 2
        let ry = rect.height / 2
        let pinch: CGFloat = 0.16
        var path = Path()
        path.move(to: CGPoint(x: c.x, y: c.y - ry))
        path.addQuadCurve(to: CGPoint(x: c.x + rx, y: c.y), control: CGPoint(x: c.x + rx * pinch, y: c.y - ry * pinch))
        path.addQuadCurve(to: CGPoint(x: c.x, y: c.y + ry), control: CGPoint(x: c.x + rx * pinch, y: c.y + ry * pinch))
        path.addQuadCurve(to: CGPoint(x: c.x - rx, y: c.y), control: CGPoint(x: c.x - rx * pinch, y: c.y + ry * pinch))
        path.addQuadCurve(to: CGPoint(x: c.x, y: c.y - ry), control: CGPoint(x: c.x - rx * pinch, y: c.y - ry * pinch))
        path.closeSubpath()
        return path
    }
}

/// 一大一小兩顆星。
struct SparkleMotif: View {
    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                SparkleShape()
                    .fill(Palette.orange)
                    .frame(width: size.width * 0.72, height: size.height * 0.72)
                    .position(x: size.width * 0.44, y: size.height * 0.56)
                SparkleShape()
                    .fill(Palette.pink)
                    .frame(width: size.width * 0.3, height: size.height * 0.3)
                    .position(x: size.width * 0.82, y: size.height * 0.2)
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - 彩繪拱窗

/// 拱形彩繪玻璃窗：紫色窗框、四色窗格，中間一顆星。
struct ArchWindowMotif: View {
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let width = side * 0.7
            let height = side * 0.92
            let frame = side * 0.07
            let gap = side * 0.04
            let innerWidth = width - frame * 2
            let innerHeight = height - frame * 2
            ZStack {
                ArchShape()
                    .fill(Palette.purple)
                    .frame(width: width, height: height)
                VStack(spacing: gap) {
                    HStack(spacing: gap) {
                        Palette.pink
                        Palette.orange
                    }
                    HStack(spacing: gap) {
                        Palette.purpleSoft
                        Palette.red.opacity(0.85)
                    }
                }
                .frame(width: innerWidth, height: innerHeight)
                .clipShape(ArchShape())
                SparkleShape()
                    .fill(Palette.orangeSoft)
                    .frame(width: side * 0.3, height: side * 0.3)
                    .offset(y: side * 0.04)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

private struct ArchShape: Shape {
    func path(in rect: CGRect) -> Path {
        let radius = rect.width / 2
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addArc(
            center: CGPoint(x: rect.midX, y: rect.minY + radius),
            radius: radius,
            startAngle: .degrees(180),
            endAngle: .degrees(0),
            clockwise: false
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

// MARK: - 籌碼

/// 撲克籌碼：外圈有六道刻痕，中間印花色。
struct PokerChipMotif: View {
    var suit: Suit = .heart

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            ZStack {
                Circle().fill(suit.color)
                ForEach(0..<6, id: \.self) { index in
                    RoundedRectangle(cornerRadius: side * 0.03, style: .continuous)
                        .fill(Palette.onAccent.opacity(0.9))
                        .frame(width: side * 0.1, height: side * 0.17)
                        .offset(y: -side * 0.4)
                        .rotationEffect(.degrees(Double(index) * 60))
                }
                Circle()
                    .fill(Palette.surface)
                    .frame(width: side * 0.54, height: side * 0.54)
                Image(systemName: suit.symbol)
                    .font(.system(size: side * 0.26, weight: .bold))
                    .foregroundStyle(suit.color)
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - 徽章

/// 花邊徽章加兩條緞帶，用在成就或里程碑。
struct RosetteMotif: View {
    var suit: Suit = .club

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            ZStack {
                ForEach([-1.0, 1.0], id: \.self) { direction in
                    RoundedRectangle(cornerRadius: side * 0.04, style: .continuous)
                        .fill(Palette.red.opacity(0.8))
                        .frame(width: side * 0.16, height: side * 0.38)
                        .rotationEffect(.degrees(direction * 18))
                        .offset(x: direction * side * 0.12, y: side * 0.28)
                }
                ForEach(0..<12, id: \.self) { index in
                    Circle()
                        .fill(Palette.pink)
                        .frame(width: side * 0.24, height: side * 0.24)
                        .offset(y: -side * 0.26)
                        .rotationEffect(.degrees(Double(index) * 30))
                }
                .offset(y: -side * 0.06)
                Circle()
                    .fill(Palette.pink)
                    .frame(width: side * 0.56, height: side * 0.56)
                    .offset(y: -side * 0.06)
                Circle()
                    .fill(Palette.surface)
                    .frame(width: side * 0.38, height: side * 0.38)
                    .offset(y: -side * 0.06)
                Image(systemName: suit.symbol)
                    .font(.system(size: side * 0.2, weight: .bold))
                    .foregroundStyle(suit.color)
                    .offset(y: -side * 0.06)
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - 棋盤格

/// 3×3 的粉色棋盤格，當底紋或裝飾。
struct CheckerMotif: View {
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let gap = side * 0.06
            let cell = (side - gap * 2) / 3
            VStack(spacing: gap) {
                ForEach(0..<3, id: \.self) { row in
                    HStack(spacing: gap) {
                        ForEach(0..<3, id: \.self) { column in
                            RoundedRectangle(cornerRadius: cell * 0.25, style: .continuous)
                                .fill((row + column).isMultiple(of: 2) ? Palette.pink : Palette.surface)
                                .frame(width: cell, height: cell)
                        }
                    }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
