import SwiftUI

/// 主題圖示庫。新畫面需要圖示時先從這裡挑，顏色與外框才會一致。
///
/// 一般圖示用 SF Symbols 的實心版本並配上主題色；撲克牌主題的裝飾（小丑帽、
/// 蝴蝶結、皇冠⋯）是 `ThemeMotifs.swift` 裡的自繪圖案。
enum ThemeIcon: String, CaseIterable, Identifiable {
    // 導航
    case home, conversation, cards, whiteboard, schedule, documents
    case search, settings, notifications, archive, modules, inspector, profile

    // 動作
    case add, edit, importItem, export, tag, favorite, pin, unpin, delete
    case refresh, compact, send, stop, pause, play, link, copy, share
    case filter, sort, expand, collapse, drag, undo

    // 狀態
    case success, warning, error, info, waiting, running, locked, unlocked
    case offline, approval, sync, streak

    // 卡片
    case bedrock, persona, memory, summary, note, image, audio
    case cold, fresh, stale, distill, deal, shuffle, stack

    // 物件
    case folder, calendar, clock, chart, heatmap, treemap, model, key
    case mail, bookmark, gift, lightbulb, brain, flask, book

    // 撲克牌主題（自繪）
    case jesterHat, bow, crown, sparkle, archWindow, pokerChip, cardFan, rosette, checker
    case mask, dice, loveLetter

    var id: String { rawValue }

    /// 圖示分組，給圖示總覽用。
    enum Group: String, CaseIterable {
        case navigation = "導航"
        case action = "動作"
        case status = "狀態"
        case card = "卡片"
        case object = "物件"
        case motif = "撲克牌主題"
    }

    var group: Group {
        switch self {
        case .home, .conversation, .cards, .whiteboard, .schedule, .documents,
             .search, .settings, .notifications, .archive, .modules, .inspector, .profile:
            return .navigation
        case .add, .edit, .importItem, .export, .tag, .favorite, .pin, .unpin, .delete,
             .refresh, .compact, .send, .stop, .pause, .play, .link, .copy, .share,
             .filter, .sort, .expand, .collapse, .drag, .undo:
            return .action
        case .success, .warning, .error, .info, .waiting, .running, .locked, .unlocked,
             .offline, .approval, .sync, .streak:
            return .status
        case .bedrock, .persona, .memory, .summary, .note, .image, .audio,
             .cold, .fresh, .stale, .distill, .deal, .shuffle, .stack:
            return .card
        case .folder, .calendar, .clock, .chart, .heatmap, .treemap, .model, .key,
             .mail, .bookmark, .gift, .lightbulb, .brain, .flask, .book:
            return .object
        case .jesterHat, .bow, .crown, .sparkle, .archWindow, .pokerChip, .cardFan, .rosette, .checker,
             .mask, .dice, .loveLetter:
            return .motif
        }
    }

    /// 預設顏色：導航沿用左側欄的花色，狀態用語意色。
    var tone: Tone {
        switch self {
        case .home, .favorite, .pin, .bedrock, .persona, .error, .stop, .delete, .loveLetter, .streak:
            return .red
        case .conversation, .settings, .archive, .summary, .cold, .stale, .locked, .offline,
             .unpin, .collapse, .drag, .undo, .sort, .stack:
            return .gray
        case .cards, .memory, .warning, .approval, .importItem, .export, .folder, .key, .lightbulb,
             .chart, .gift, .sparkle, .deal, .waiting, .whiteboard:
            return .orange
        case .note, .image, .audio, .tag, .edit, .add, .link, .bookmark, .mail,
             .notifications, .profile, .share, .bow, .checker, .fresh:
            return .pink
        case .documents, .modules, .inspector, .compact, .distill, .running, .sync, .shuffle,
             .heatmap, .treemap, .model, .brain, .flask, .book, .info, .archWindow, .mask, .dice,
             .schedule, .calendar, .clock, .search, .filter, .expand, .refresh, .copy, .pause, .play:
            return .purple
        case .success, .send, .unlocked:
            return .sage
        case .jesterHat, .crown, .pokerChip, .cardFan, .rosette:
            return .red
        }
    }

    /// SF Symbol 名稱；自繪圖案回傳 nil。
    var symbol: String? {
        switch self {
        case .home: return "house.fill"
        case .conversation: return "bubble.left.and.bubble.right.fill"
        case .cards: return "rectangle.stack.fill"
        case .whiteboard: return "square.grid.2x2.fill"
        case .schedule: return "calendar.badge.clock"
        case .documents: return "doc.text.fill"
        case .search: return "magnifyingglass"
        case .settings: return "gearshape.fill"
        case .notifications: return "bell.fill"
        case .archive: return "archivebox.fill"
        case .modules: return "puzzlepiece.extension.fill"
        case .inspector: return "sidebar.trailing"
        case .profile: return "person.crop.circle.fill"

        case .add: return "plus"
        case .edit: return "pencil"
        case .importItem: return "square.and.arrow.down.fill"
        case .export: return "square.and.arrow.up.fill"
        case .tag: return "tag.fill"
        case .favorite: return "heart.fill"
        case .pin: return "pin.fill"
        case .unpin: return "pin.slash.fill"
        case .delete: return "trash.fill"
        case .refresh: return "arrow.clockwise"
        case .compact: return "arrow.down.right.and.arrow.up.left"
        case .send: return "arrow.up"
        case .stop: return "stop.fill"
        case .pause: return "pause.fill"
        case .play: return "play.fill"
        case .link: return "link"
        case .copy: return "doc.on.doc.fill"
        case .share: return "paperplane.fill"
        case .filter: return "line.3.horizontal.decrease"
        case .sort: return "arrow.up.arrow.down"
        case .expand: return "arrow.up.left.and.arrow.down.right"
        case .collapse: return "chevron.up"
        case .drag: return "hand.draw.fill"
        case .undo: return "arrow.uturn.backward"

        case .success: return "checkmark"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark"
        case .info: return "info"
        case .waiting: return "hourglass"
        case .running: return "ellipsis"
        case .locked: return "lock.fill"
        case .unlocked: return "lock.open.fill"
        case .offline: return "bolt.horizontal.fill"
        case .approval: return "hand.raised.fill"
        case .sync: return "arrow.triangle.2.circlepath"
        case .streak: return "flame.fill"

        case .bedrock: return Suit.heart.symbol
        case .persona: return "theatermasks.fill"
        case .memory: return Suit.diamond.symbol
        case .summary: return Suit.spade.symbol
        case .note: return Suit.club.symbol
        case .image: return "photo.fill"
        case .audio: return "waveform"
        case .cold: return "snowflake"
        case .fresh: return "leaf.fill"
        case .stale: return "wind"
        case .distill: return "drop.fill"
        case .deal: return "hand.point.up.left.fill"
        case .shuffle: return "shuffle"
        case .stack: return "square.stack.3d.up.fill"

        case .folder: return "folder.fill"
        case .calendar: return "calendar"
        case .clock: return "clock.fill"
        case .chart: return "chart.bar.fill"
        case .heatmap: return "square.grid.3x3.fill"
        case .treemap: return "square.split.2x2.fill"
        case .model: return "cpu.fill"
        case .key: return "key.fill"
        case .mail: return "envelope.fill"
        case .bookmark: return "bookmark.fill"
        case .gift: return "gift.fill"
        case .lightbulb: return "lightbulb.fill"
        case .brain: return "brain.head.profile"
        case .flask: return "flask.fill"
        case .book: return "book.closed.fill"

        case .mask: return "theatermasks.fill"
        case .dice: return "die.face.5.fill"
        case .jesterHat, .bow, .crown, .sparkle, .archWindow, .pokerChip, .cardFan, .rosette,
             .checker, .loveLetter:
            return nil
        }
    }
}

/// 圖示本體：SF Symbol 或自繪圖案，不含外框。
struct ThemeIconGlyph: View {
    let icon: ThemeIcon
    var size: CGFloat = 16
    /// 指定時覆蓋預設顏色，例如放在實色色塊上要用白色。
    var color: Color?

    var body: some View {
        if let symbol = icon.symbol {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .bold))
                .foregroundStyle(color ?? icon.tone.color)
                .frame(width: size * 1.3, height: size * 1.3)
        } else {
            motif
                .frame(width: size * 1.3, height: size * 1.3)
        }
    }

    @ViewBuilder
    private var motif: some View {
        switch icon {
        case .jesterHat: JesterHatMotif()
        case .bow: BowMotif()
        case .crown: CrownMotif()
        case .sparkle: SparkleMotif()
        case .archWindow: ArchWindowMotif()
        case .pokerChip: PokerChipMotif()
        case .cardFan: CardFanMark(size: size * 1.1)
        case .rosette: RosetteMotif()
        case .checker: CheckerMotif()
        case .loveLetter: LoveLetterMotif()
        default: EmptyView()
        }
    }
}

/// 圓角圖示塊。
struct ThemeIconTile: View {
    enum Style {
        /// 淺色底、主題色圖示。
        case soft
        /// 實色底、白色圖示。
        case filled
        /// 只有圖示。
        case plain
    }

    let icon: ThemeIcon
    var style: Style = .soft
    var size: CGFloat = 40
    var tone: Tone?

    var body: some View {
        let tone = tone ?? icon.tone
        let isMotif = icon.symbol == nil
        ZStack {
            if style != .plain {
                RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                    .fill(style == .filled && !isMotif ? tone.color : tone.soft)
            }
            ThemeIconGlyph(
                icon: icon,
                size: size * (isMotif ? 0.5 : 0.4),
                color: style == .filled && !isMotif ? Palette.onAccent : tone.color
            )
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// 情書：信封上印著紅心。
struct LoveLetterMotif: View {
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            ZStack {
                RoundedRectangle(cornerRadius: side * 0.12, style: .continuous)
                    .fill(Palette.pinkSoft)
                    .frame(width: side * 0.9, height: side * 0.64)
                EnvelopeFlap()
                    .fill(Palette.pink)
                    .frame(width: side * 0.9, height: side * 0.64)
                Image(systemName: "suit.heart.fill")
                    .font(.system(size: side * 0.28, weight: .bold))
                    .foregroundStyle(Palette.red)
                    .offset(y: side * 0.04)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

private struct EnvelopeFlap: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let inset = rect.width * 0.06
        path.move(to: CGPoint(x: rect.minX + inset, y: rect.minY + inset))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - inset, y: rect.minY + inset),
            control: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.95)
        )
        path.closeSubpath()
        return path
    }
}

/// 圖示總覽：依分組列出所有圖示與名稱。給設計檢查與預覽用，不掛在產品介面上。
struct ThemeIconGallery: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                ForEach(ThemeIcon.Group.allCases, id: \.self) { group in
                    VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                        SuitHeading(title: group.rawValue, suit: Self.suit(for: group))
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 84), spacing: DesignTokens.spacingM)],
                            alignment: .leading,
                            spacing: DesignTokens.spacingM
                        ) {
                            ForEach(ThemeIcon.allCases.filter { $0.group == group }) { icon in
                                VStack(spacing: 6) {
                                    HStack(spacing: 6) {
                                        ThemeIconTile(icon: icon, style: .soft, size: 36)
                                        if icon.symbol != nil {
                                            ThemeIconTile(icon: icon, style: .filled, size: 36)
                                        }
                                    }
                                    Text(icon.rawValue)
                                        .font(.cardiary(.caption2))
                                        .foregroundStyle(Palette.inkSecondary)
                                        .lineLimit(1)
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                    }
                    .themeBlock(Palette.surface, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingL)
                }
            }
            .padding(DesignTokens.spacingL)
        }
        .background(Palette.canvas)
    }

    private static func suit(for group: ThemeIcon.Group) -> Suit {
        switch group {
        case .navigation, .motif: return .heart
        case .action: return .club
        case .status: return .spade
        case .card, .object: return .diamond
        }
    }
}
