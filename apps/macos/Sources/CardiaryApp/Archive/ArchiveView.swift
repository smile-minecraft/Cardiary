import CardiaryKit
import SwiftUI

/// 封存區：列出封存中的對話、顯示剩餘天數，可以取消封存或刪除。
/// 刪除前先向主機拿 `session.deletion_preview`，拿到才顯示確認視窗。
struct ArchiveView: View {
    @ObservedObject var model: ArchiveModel

    var body: some View {
        VStack(spacing: DesignTokens.spacingM) {
            header
            content
            statusBanners
        }
        .padding(DesignTokens.spacingL)
        .background(Palette.canvas)
        .task {
            await model.reload()
        }
        .sheet(item: deletionTargetBinding) { target in
            DeleteConfirmationView(
                target: target,
                isDeleting: model.deletingSessionId == target.sessionId,
                onCancel: { model.cancelDelete() },
                onConfirm: { Task { await model.confirmDelete() } }
            )
        }
    }

    private var deletionTargetBinding: Binding<ArchiveDeletionPreview?> {
        Binding(
            get: { model.deletionTarget },
            set: { newValue in
                if newValue == nil { model.cancelDelete() }
            }
        )
    }

    private var header: some View {
        HStack(spacing: DesignTokens.spacingM) {
            ThemePageTitle(title: CardL10n.text(.archiveTitle), subtitle: countText, suit: .spade)
            Spacer()
            if model.isPreviewingDeletion {
                HStack(spacing: DesignTokens.spacingS) {
                    SuitLoader(size: 7)
                    Text(CardL10n.text(.archivePreviewLoading))
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
            } else if model.deletingSessionId != nil {
                SuitLoader(size: 7)
            }
            Button {
                Task { await model.reload() }
            } label: {
                Label(CardL10n.text(.archiveRefresh), systemImage: "arrow.clockwise")
            }
            .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
            .controlSize(.small)
            .disabled(model.isLoading)
        }
    }

    private var countText: String {
        CardL10n.count(.archiveCount, count: model.items.count)
    }

    @ViewBuilder
    private var content: some View {
        if model.isLoading && model.items.isEmpty {
            centeredSpinner()
        } else if !model.isServiceAvailable {
            centeredMessage(CardL10n.text(.archiveServiceUnavailable), systemImage: "bolt.horizontal.circle")
        } else if model.items.isEmpty {
            centeredMessage(CardL10n.text(.archiveEmpty), systemImage: "archivebox")
        } else {
            ScrollView {
                LazyVStack(spacing: DesignTokens.spacingS) {
                    ForEach(model.items) { entry in
                        ArchiveRowView(
                            entry: entry,
                            remainingDays: model.remainingDays(for: entry),
                            onUnarchive: { Task { await model.unarchive(sessionId: entry.id) } },
                            onDelete: { Task { await model.beginDelete(sessionId: entry.id) } }
                        )
                    }
                }
            }
            .scrollIndicators(.never)
        }
    }

    @ViewBuilder
    private var statusBanners: some View {
        if let error = model.errorMessage {
            MessageBanner(text: error, systemImage: "exclamationmark.triangle", tone: .red)
        }
        if let notice = model.noticeMessage {
            MessageBanner(text: notice, systemImage: "checkmark.circle", tone: .sage)
        }
    }

    private func centeredMessage(_ text: String, systemImage: String) -> some View {
        ThemeEmptyState(text: text, suit: .spade, systemImage: systemImage)
    }

    private func centeredSpinner() -> some View {
        SuitLoader(size: 11)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(DesignTokens.spacingL)
    }
}

private struct ArchiveRowView: View {
    let entry: ArchiveEntry
    let remainingDays: Int?
    let onUnarchive: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: DesignTokens.spacingM) {
            ZStack {
                RoundedRectangle(cornerRadius: DesignTokens.tileRadius, style: .continuous)
                    .fill(Palette.graySoft)
                    .frame(width: 38, height: 38)
                Image(systemName: "archivebox.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.grayInk)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(entry.title)
                    .font(.cardiary(.body, weight: .semibold))
                    .lineLimit(1)

                Text(CardL10n.format(.archiveArchivedAt, value: Self.displayDate(entry.archivedAt)))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)

                Text(CardL10n.format(.archivePurgeAt, value: Self.displayDate(entry.purgeAt)))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: DesignTokens.spacingS) {
                remainingBadge
                HStack(spacing: DesignTokens.spacingXS) {
                    Button(action: onUnarchive) {
                        Text(CardL10n.text(.archiveUnarchive))
                    }
                    Button(action: onDelete) {
                        Text(CardL10n.text(.archiveDelete))
                    }
                    .buttonStyle(.themeDanger)
                }
                .controlSize(.small)
            }
        }
        .themeBlock(Palette.surface, radius: DesignTokens.cardRadius)
    }

    @ViewBuilder
    private var remainingBadge: some View {
        if let remainingDays {
            ThemeChip(
                text: CardL10n.count(.archiveRemainingDays, count: remainingDays),
                tone: remainingDays <= 1 ? .red : .gray,
                systemImage: "hourglass",
                filled: remainingDays <= 1
            )
        } else {
            ThemeChip(text: CardL10n.text(.archiveDaysUnknown), tone: .gray)
        }
    }

    static func displayDate(_ iso: String) -> String {
        guard let date = ArchiveModel.parseISO8601(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

private struct DeleteConfirmationView: View {
    let target: ArchiveDeletionPreview
    let isDeleting: Bool
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            HStack(spacing: DesignTokens.spacingM) {
                Image(systemName: "trash.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(width: 34, height: 34)
                    .background(Palette.red, in: RoundedRectangle(cornerRadius: DesignTokens.tileRadius, style: .continuous))
                Text(CardL10n.text(.archiveDeleteConfirmTitle))
                    .font(.cardiary(.title3, weight: .bold))
            }

            Text(target.sessionTitle)
                .font(.cardiary(.body, weight: .semibold))
                .lineLimit(2)

            Text(CardL10n.text(.archiveDeleteConfirmBody))
                .font(.cardiary(.callout))
                .foregroundStyle(Palette.inkSecondary)

            VStack(alignment: .leading, spacing: 6) {
                row(CardL10n.count(.archiveDeleteSessions, count: target.subtreeSessionIds.count), suit: .spade)
                row(CardL10n.count(.archiveDeleteExclusiveCards, count: target.exclusiveCards), suit: .heart)
                row(CardL10n.count(.archiveDeleteSharedCards, count: target.sharedCards), suit: .club)
                row(CardL10n.count(.archiveDeleteAssets, count: target.assets), suit: .diamond)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .themeBlock(Palette.surface, radius: DesignTokens.cardRadius)

            HStack(spacing: DesignTokens.spacingS) {
                Spacer()
                if isDeleting {
                    SuitLoader(size: 7)
                }
                Button(CardL10n.text(.archiveDeleteCancel), action: onCancel)
                    .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                    .keyboardShortcut(.cancelAction)
                    .disabled(isDeleting)
                Button(role: .destructive, action: onConfirm) {
                    Text(isDeleting
                        ? CardL10n.text(.archiveDeleting)
                        : CardL10n.text(.archiveDeleteConfirm))
                }
                .buttonStyle(.themePrimary)
                .disabled(isDeleting)
            }
        }
        .padding(DesignTokens.spacingXL)
        .frame(width: DesignTokens.deleteConfirmationWidth)
        .background(Palette.canvas)
        .cardiaryTheme()
    }

    private func row(_ text: String, suit: Suit) -> some View {
        HStack(spacing: DesignTokens.spacingS) {
            Image(systemName: suit.symbol)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(suit.ink)
            Text(text)
                .font(.cardiary(.callout, monospacedDigits: true))
        }
    }
}
