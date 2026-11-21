import SwiftUI

// 主題的基本控制項：一律是無框線的圓潤色塊。

// MARK: - 根畫面

extension View {
    /// 套用撲克牌主題：圓體、暖色文字、紅心主色、全域縮放與無框線的預設控制項。
    /// 主視窗、匯入視窗與表單都從這裡進來。
    public func cardiaryTheme(uiScale: UIScaleStore? = nil) -> some View {
        modifier(CardiaryThemeModifier(uiScale: uiScale ?? .shared))
    }

    /// 浮在底色上的扁平色塊。
    func themeBlock(
        _ fill: Color = Palette.surface,
        radius: CGFloat = DesignTokens.cardRadius,
        padding: CGFloat? = DesignTokens.spacingM
    ) -> some View {
        self
            .padding(padding ?? 0)
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

private struct CardiaryThemeModifier: ViewModifier {
    @ObservedObject var uiScale: UIScaleStore

    func body(content: Content) -> some View {
        content
            .font(.cardiary(.body, scale: uiScale.scale))
            .fontDesign(.rounded)
            .foregroundStyle(Palette.ink)
            .tint(Palette.red)
            .buttonStyle(ThemeButtonStyle(kind: .soft))
            .textFieldStyle(ThemeFieldStyle())
            .toggleStyle(ThemeCheckboxStyle())
            .environment(\.cardiaryScale, uiScale.scale)
    }
}

// MARK: - 按鈕

/// 膠囊按鈕。主要動作用實色紅，其他動作用淺色塊，安靜的動作只有懸停時才出現底色。
struct ThemeButtonStyle: ButtonStyle {
    enum Kind {
        /// 實色主色塊，深墨字。
        case primary
        /// 淺色塊，主色文字。
        case soft
        /// 平時沒有底色，懸停時出現。
        case quiet
        /// 淺紅底、紅字，用在刪除與暫停。
        case danger
        /// 只有文字，像連結。
        case link
        /// 白色色塊，放在有色底的卡面上。
        case surface
    }

    var kind: Kind
    var tone: Tone = .red

    func makeBody(configuration: Configuration) -> some View {
        ThemeButtonBody(
            configuration: configuration,
            kind: configuration.role == .destructive && kind == .soft ? .danger : kind,
            tone: tone
        )
    }
}

private struct ThemeButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let kind: ThemeButtonStyle.Kind
    let tone: Tone

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.controlSize) private var controlSize
    @Environment(\.cardiaryScale) private var uiScale
    @State private var isHovered = false

    var body: some View {
        configuration.label
            .cardiaryFont(isCompact ? .caption : .callout, weight: .semibold)
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, kind == .link ? 0 : horizontalPadding)
            .padding(.vertical, kind == .link ? 0 : verticalPadding)
            .background(background, in: Capsule(style: .continuous))
            .contentShape(Capsule(style: .continuous))
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed && kind != .link ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .animation(.easeOut(duration: 0.12), value: isHovered)
            .onHover { isHovered = $0 }
    }

    private var isCompact: Bool {
        controlSize == .small || controlSize == .mini
    }

    private var paddingScale: CGFloat {
        min(1.35, max(0.85, uiScale))
    }

    private var horizontalPadding: CGFloat {
        (isCompact ? DesignTokens.buttonPaddingHCompact : DesignTokens.buttonPaddingH) * paddingScale
    }

    private var verticalPadding: CGFloat {
        (isCompact ? DesignTokens.buttonPaddingVCompact : DesignTokens.buttonPaddingV) * paddingScale
    }

    private var foreground: Color {
        switch kind {
        case .primary: return Palette.onAccent
        case .soft, .link: return tone.ink
        case .quiet, .surface: return Palette.ink
        case .danger: return Palette.redInk
        }
    }

    private var background: Color {
        let active = isEnabled && (isHovered || configuration.isPressed)
        switch kind {
        case .primary:
            return active ? tone.color.opacity(0.88) : tone.color
        case .soft:
            return active ? tone.soft.opacity(0.75) : tone.soft
        case .quiet:
            return active ? Palette.hover : .clear
        case .danger:
            return active ? Palette.redSoft.opacity(0.75) : Palette.redSoft
        case .link:
            return .clear
        case .surface:
            return active ? Palette.surface.opacity(0.7) : Palette.surface
        }
    }
}

extension ButtonStyle where Self == ThemeButtonStyle {
    static var themePrimary: ThemeButtonStyle { ThemeButtonStyle(kind: .primary) }
    static var themeSoft: ThemeButtonStyle { ThemeButtonStyle(kind: .soft) }
    static var themeQuiet: ThemeButtonStyle { ThemeButtonStyle(kind: .quiet) }
    static var themeDanger: ThemeButtonStyle { ThemeButtonStyle(kind: .danger) }
    static var themeLink: ThemeButtonStyle { ThemeButtonStyle(kind: .link) }
}

/// 只有圖示的圓形按鈕，例如送出與關閉。
struct ThemeIconButtonStyle: ButtonStyle {
    var fill: Color = .clear
    var foreground: Color = Palette.inkSecondary
    var diameter: CGFloat = 26

    func makeBody(configuration: Configuration) -> some View {
        ThemeIconButtonBody(configuration: configuration, fill: fill, foreground: foreground, diameter: diameter)
    }
}

private struct ThemeIconButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let fill: Color
    let foreground: Color
    let diameter: CGFloat

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.cardiaryScale) private var uiScale
    @State private var isHovered = false

    private var scaledDiameter: CGFloat {
        diameter * min(1.35, max(0.85, uiScale))
    }

    var body: some View {
        configuration.label
            .foregroundStyle(foreground)
            .frame(width: scaledDiameter, height: scaledDiameter)
            .background(
                Circle().fill(fill == .clear ? (isHovered ? Palette.hover : .clear) : fill)
            )
            .contentShape(Circle())
            .opacity(isEnabled ? (isHovered && fill != .clear ? 0.88 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .onHover { isHovered = $0 }
    }
}

// MARK: - 輸入框

/// 凹陷色塊的輸入框，沒有框線。
struct ThemeFieldStyle: TextFieldStyle {
    var fill: Color = Palette.sunken

    // swiftlint:disable:next identifier_name
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .textFieldStyle(.plain)
            .padding(.horizontal, DesignTokens.spacingM)
            .padding(.vertical, DesignTokens.fieldPaddingV)
            .background(fill, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
    }
}

extension View {
    /// 多行編輯區的色塊外觀。
    func themeEditor(minHeight: CGFloat) -> some View {
        self
            .scrollContentBackground(.hidden)
            .padding(DesignTokens.spacingS)
            .frame(minHeight: minHeight)
            .background(Palette.sunken, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
    }
}

// MARK: - 開關與勾選

/// 膠囊開關：開啟時是紅心色。
struct ThemeSwitchStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        ThemeSwitchBody(configuration: configuration)
    }
}

private struct ThemeSwitchBody: View {
    let configuration: ToggleStyleConfiguration
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        HStack(spacing: DesignTokens.spacingS) {
            configuration.label
            Capsule(style: .continuous)
                .fill(configuration.isOn ? Palette.red : Palette.hover)
                .frame(width: 38, height: 22)
                .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                    Circle()
                        .fill(configuration.isOn ? Palette.onAccent : Palette.ink)
                        .padding(3)
                }
                .animation(.spring(response: 0.25, dampingFraction: 0.8), value: configuration.isOn)
                .onTapGesture { configuration.isOn.toggle() }
                .accessibilityAddTraits(.isButton)
        }
        .opacity(isEnabled ? 1 : 0.45)
    }
}

/// 圓角方塊的勾選框：勾選時是紅底深墨勾。
struct ThemeCheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        ThemeCheckboxBody(configuration: configuration)
    }
}

private struct ThemeCheckboxBody: View {
    let configuration: ToggleStyleConfiguration
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: DesignTokens.spacingS) {
                RoundedRectangle(cornerRadius: DesignTokens.smallRadius, style: .continuous)
                    .fill(configuration.isOn ? Palette.red : Palette.hover)
                    .frame(width: 16, height: 16)
                    .overlay {
                        if configuration.isOn {
                            Image(systemName: "checkmark")
                                .cardiarySymbolFont(size: 9, weight: .heavy)
                                .foregroundStyle(Palette.onAccent)
                        }
                    }
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                configuration.label
                    .foregroundStyle(Palette.ink)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.45)
    }
}

// MARK: - 分段選擇

/// 取代系統的分段控制：選中的一段是實色紅塊。
struct ThemeSegmented<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String)]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let isSelected = option.value == selection
                Button {
                    selection = option.value
                } label: {
                    Text(option.title)
                        .cardiaryFont(.caption, weight: .semibold)
                        .lineLimit(1)
                        .foregroundStyle(isSelected ? Palette.onAccent : Palette.inkSecondary)
                        .padding(.horizontal, DesignTokens.spacingM)
                        .padding(.vertical, DesignTokens.segmentedPaddingV)
                        .frame(maxWidth: .infinity)
                        .background(
                            isSelected ? Palette.red : Color.clear,
                            in: Capsule(style: .continuous)
                        )
                        .contentShape(Capsule(style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Palette.sunken, in: Capsule(style: .continuous))
        .animation(.easeOut(duration: 0.15), value: selection)
    }
}

// MARK: - 選單

/// 下拉選單：淺色膠囊加上箭頭。取代系統彈出式按鈕的框線外觀。
struct ThemeMenuPicker<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String)]
    var fill: Color = Palette.sunken

    var body: some View {
        Menu {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                Button {
                    selection = option.value
                } label: {
                    if option.value == selection {
                        Label(option.title, systemImage: "checkmark")
                    } else {
                        Text(option.title)
                    }
                }
            }
        } label: {
            Text(currentTitle)
                .cardiaryFont(.callout)
                .lineLimit(1)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.visible)
        .fixedSize()
        .padding(.horizontal, DesignTokens.spacingM)
        .padding(.vertical, DesignTokens.segmentedPaddingV)
        .background(fill, in: Capsule(style: .continuous))
    }

    private var currentTitle: String {
        options.first { $0.value == selection }?.title ?? "—"
    }
}

/// 左邊標題、右邊選單的一列，給設定表單用。
struct ThemeLabeledRow<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: DesignTokens.spacingM) {
            Text(title)
                .cardiaryFont(.callout)
                .foregroundStyle(Palette.inkSecondary)
            Spacer(minLength: DesignTokens.spacingS)
            content
        }
    }
}

// MARK: - 進度

/// 膠囊進度條。
struct ThemeProgressBar: View {
    let value: Double
    var tone: Tone = .red
    var height: CGFloat = 8

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(Palette.sunken)
                Capsule(style: .continuous)
                    .fill(tone.color)
                    .frame(width: max(height, geometry.size.width * min(1, max(0, value))))
                    .opacity(value > 0 ? 1 : 0)
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityValue(Text("\(Int((value * 100).rounded()))%"))
    }
}

/// 載入中的四個花色依序跳動，取代系統的轉圈。
struct SuitLoader: View {
    var size: CGFloat = 9

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20)) { context in
            let phase = context.date.timeIntervalSinceReferenceDate * 2.4
            HStack(spacing: size * 0.35) {
                ForEach(Array(Suit.allCases.enumerated()), id: \.offset) { index, suit in
                    let wave = (sin(phase - Double(index) * 0.9) + 1) / 2
                    Image(systemName: suit.symbol)
                        .cardiarySymbolFont(size: size, weight: .bold)
                        .foregroundStyle(suit.color)
                        .opacity(0.35 + 0.65 * wave)
                        .offset(y: -size * 0.25 * wave)
                }
            }
        }
        .accessibilityLabel(Text(verbatim: "…"))
    }
}

// MARK: - 標籤與章節

/// 圓角標籤。
struct ThemeChip: View {
    let text: String
    var tone: Tone = .gray
    var systemImage: String?
    var filled = false
    @Environment(\.cardiaryScale) private var uiScale

    var body: some View {
        let paddingScale = min(1.25, max(0.85, uiScale))
        HStack(spacing: 3) {
            if let systemImage {
                Image(systemName: systemImage)
                    .cardiarySymbolFont(size: 8, weight: .bold)
            }
            Text(text)
                .lineLimit(1)
        }
        .cardiaryFont(.caption2, weight: .semibold)
        .foregroundStyle(filled ? Palette.onAccent : tone.ink)
        .padding(.horizontal, 8 * paddingScale)
        .padding(.vertical, 2.5 * paddingScale)
        .background(filled ? tone.color : tone.soft, in: Capsule(style: .continuous))
    }
}

/// 花色符號加章節標題。
struct SuitHeading: View {
    let title: String
    var suit: Suit = .heart
    var style: Font.TextStyle = .headline
    var weight: Font.Weight?

    var body: some View {
        HStack(spacing: DesignTokens.spacingS) {
            Image(systemName: suit.symbol)
                .cardiarySymbolFont(size: 11, weight: .bold)
                .foregroundStyle(suit.ink)
            Text(title)
                .cardiaryFont(style, weight: weight)
                .foregroundStyle(Palette.ink)
        }
    }
}

/// 一排四個花色，夾在兩條短線之間。只當裝飾用。
struct SuitDivider: View {
    var body: some View {
        HStack(spacing: 7) {
            Capsule().fill(Palette.hover).frame(height: 2)
            ForEach(Suit.allCases, id: \.self) { suit in
                Image(systemName: suit.symbol)
                    .cardiarySymbolFont(size: 8, weight: .bold)
                    .foregroundStyle(suit.color.opacity(0.8))
            }
            Capsule().fill(Palette.hover).frame(height: 2)
        }
        .accessibilityHidden(true)
    }
}

/// 空狀態：一個淡色花色圖塊加一句說明。
struct ThemeEmptyState: View {
    let text: String
    var suit: Suit = .club
    var systemImage: String?

    var body: some View {
        VStack(spacing: DesignTokens.spacingM) {
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(suit.soft)
                    .frame(width: 54, height: 54)
                Image(systemName: systemImage ?? suit.symbol)
                    .cardiarySymbolFont(size: 22, weight: .semibold)
                    .foregroundStyle(suit.ink)
            }
            Text(text)
                .cardiaryFont(.callout)
                .foregroundStyle(Palette.inkSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DesignTokens.spacingL)
    }
}

/// 頁首：花色圖塊、標題與副標。
struct ThemePageTitle: View {
    let title: String
    var subtitle: String?
    var suit: Suit = .heart

    var body: some View {
        HStack(spacing: DesignTokens.spacingM) {
            ZStack {
                RoundedRectangle(cornerRadius: DesignTokens.tileRadius, style: .continuous)
                    .fill(suit.color)
                    .frame(width: 34, height: 34)
                Image(systemName: suit.symbol)
                    .cardiarySymbolFont(size: 15, weight: .bold)
                    .foregroundStyle(Palette.onAccent)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .cardiaryFont(.title3, weight: .bold)
                    .foregroundStyle(Palette.ink)
                if let subtitle {
                    Text(subtitle)
                        .cardiaryFont(.caption)
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
        }
    }
}
