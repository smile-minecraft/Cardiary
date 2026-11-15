import CardiaryKit
import SwiftUI

/// 封存區：列出封存中的對話、顯示剩餘天數，可以取消封存或刪除。
/// 刪除前先向主機拿 `session.deletion_preview`，拿到才顯示確認視窗。
struct ArchiveView: View {
    @ObservedObject var model: ArchiveModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
            statusBanners
        }
        .background(Color(nsColor: .controlBackgroundColor))
        .task {
            if model.items.isEmpty {
                await model.reload()
            }
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
            VStack(alignment: .leading, spacing: 2) {
                Text(CardL10n.text(.archiveTitle))
                    .font(.title3.bold())
                Text(countText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if model.isPreviewingDeletion {
                HStack(spacing: DesignTokens.spacingXS) {
                    ProgressView()
                        .controlSize(.small)
                    Text(CardL10n.text(.archivePreviewLoading))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if model.deletingSessionId != nil {
                ProgressView()
                    .controlSize(.small)
            }
            Button {
                Task { await model.reload() }
            } label: {
                Label(CardL10n.text(.archiveRefresh), systemImage: "arrow.clockwise")
            }
            .controlSize(.small)
            .disabled(model.isLoading)
        }
        .padding(.horizontal, DesignTokens.spacingL)
        .padding(.vertical, DesignTokens.spacingM)
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
                .padding(DesignTokens.spacingM)
            }
        }
    }

    private var statusBanners: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            if let error = model.errorMessage {
                MessageBanner(text: error, systemImage: "exclamationmark.triangle", tint: .red)
            }
            if let notice = model.noticeMessage {
                MessageBanner(text: notice, systemImage: "checkmark.circle", tint: .secondary)
            }
        }
        .padding(.horizontal, DesignTokens.spacingM)
        .padding(.bottom, model.errorMessage == nil && model.noticeMessage == nil ? 0 : DesignTokens.spacingS)
    }

    private func centeredMessage(_ text: String, systemImage: String) -> some View {
        VStack(spacing: DesignTokens.spacingS) {
            Image(systemName: systemImage)
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DesignTokens.spacingL)
    }

    private func centeredSpinner() -> some View {
        ProgressView()
            .controlSize(.regular)
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
        HStack(alignment: .top, spacing: DesignTokens.spacingM) {
            Image(systemName: "archivebox")
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                Text(entry.title)
                    .font(.body.weight(.medium))
                    .lineLimit(1)

                Text(CardL10n.format(.archiveArchivedAt, value: Self.displayDate(entry.archivedAt)))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(CardL10n.format(.archivePurgeAt, value: Self.displayDate(entry.purgeAt)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: DesignTokens.spacingXS) {
                remainingBadge
                HStack(spacing: DesignTokens.spacingXS) {
                    Button(action: onUnarchive) {
                        Text(CardL10n.text(.archiveUnarchive))
                    }
                    .controlSize(.small)
                    Button(action: onDelete) {
                        Text(CardL10n.text(.archiveDelete))
                    }
                    .controlSize(.small)
                    .tint(.red)
                }
            }
        }
        .padding(DesignTokens.spacingM)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
    }

    @ViewBuilder
    private var remainingBadge: some View {
        if let remainingDays {
            Text(CardL10n.count(.archiveRemainingDays, count: remainingDays))
                .font(.caption.bold().monospacedDigit())
                .foregroundStyle(remainingDays <= 1 ? .red : .secondary)
        } else {
            Text(CardL10n.text(.archiveDaysUnknown))
                .font(.caption)
                .foregroundStyle(.secondary)
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
            Label(CardL10n.text(.archiveDeleteConfirmTitle), systemImage: "trash")
                .font(.headline)

            Text(target.sessionTitle)
                .font(.body.weight(.medium))
                .lineLimit(2)

            Text(CardL10n.text(.archiveDeleteConfirmBody))
                .font(.callout)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                row(CardL10n.count(.archiveDeleteSessions, count: target.subtreeSessionIds.count))
                row(CardL10n.count(.archiveDeleteExclusiveCards, count: target.exclusiveCards))
                row(CardL10n.count(.archiveDeleteSharedCards, count: target.sharedCards))
                row(CardL10n.count(.archiveDeleteAssets, count: target.assets))
            }
            .padding(DesignTokens.spacingS)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))

            HStack {
                Spacer()
                Button(CardL10n.text(.archiveDeleteCancel), action: onCancel)
                    .disabled(isDeleting)
                if isDeleting {
                    ProgressView()
                        .controlSize(.small)
                }
                Button(role: .destructive, action: onConfirm) {
                    Text(isDeleting
                        ? CardL10n.text(.archiveDeleting)
                        : CardL10n.text(.archiveDeleteConfirm))
                }
                .disabled(isDeleting)
            }
        }
        .padding(DesignTokens.spacingL)
        .frame(width: 420)
    }

    private func row(_ text: String) -> some View {
        HStack {
            Image(systemName: "circle.fill")
                .font(.system(size: 4))
                .foregroundStyle(.secondary)
            Text(text)
                .font(.callout.monospacedDigit())
        }
    }
}
