import CardiaryKit
import Combine
import Foundation

/// 封存區的一列：一場封存中的對話。`archivedAt`／`purgeAt` 全部來自主機，
/// 客戶端只換算「剩餘幾天」這種呈現用數字。
public struct ArchiveEntry: Identifiable, Equatable, Sendable {
    public let id: String
    public var title: String
    public let archivedAt: String
    public let purgeAt: String

    public init(id: String, title: String, archivedAt: String, purgeAt: String) {
        self.id = id
        self.title = title
        self.archivedAt = archivedAt
        self.purgeAt = purgeAt
    }
}

/// 刪除前的預估範圍；確認視窗只讀這個型別，所以顯示的數字一定等於
/// `session.deletion_preview` 的回應。
public struct ArchiveDeletionPreview: Identifiable, Equatable, Sendable {
    public let sessionId: String
    public let sessionTitle: String
    public let subtreeSessionIds: [String]
    public let exclusiveCards: Int
    public let sharedCards: Int
    public let assets: Int

    public var id: String { sessionId }

    public init(
        sessionId: String,
        sessionTitle: String,
        preview: SessionDeletionPreviewResponsePayload
    ) {
        self.sessionId = sessionId
        self.sessionTitle = sessionTitle
        self.subtreeSessionIds = preview.subtreeSessionIds
        self.exclusiveCards = preview.exclusiveCards
        self.sharedCards = preview.sharedCards
        self.assets = preview.assets
    }
}

/// 封存區的狀態與請求。重新載入時以主機摘要為準，事件用來即時更新。
@MainActor
public final class ArchiveModel: ObservableObject {
    @Published public private(set) var items: [ArchiveEntry] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var isPreviewingDeletion = false
    @Published public private(set) var deletingSessionId: String?
    /// 非 nil 時確認視窗才顯示；先拿到 `session.deletion_preview` 才會設成非 nil。
    @Published public private(set) var deletionTarget: ArchiveDeletionPreview?
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?

    /// 一次列幾場對話。封存中的對話通常很少，翻完就收。
    public let pageSize: Int
    public let pageLimit: Int

    private let now: () -> Date
    private var management: (any SessionManagementService)?
    private var sessions: (any ConversationService)?
    private var listCache: [String: SessionSummary] = [:]
    private var eventsDuringLoad: [ServerFrame] = []
    private var loadGeneration = 0

    public init(
        pageSize: Int = 50,
        pageLimit: Int = 20,
        now: @escaping () -> Date = Date.init
    ) {
        self.pageSize = max(1, pageSize)
        self.pageLimit = max(1, pageLimit)
        self.now = now
    }

    public var isServiceAvailable: Bool { management != nil && sessions != nil }

    public func attach(
        management: (any SessionManagementService)?,
        sessions: (any ConversationService)?
    ) {
        self.management = management
        self.sessions = sessions
    }

    public func detach() {
        management = nil
        sessions = nil
    }

    // MARK: - 清單

    /// 重新列出封存中的對話。搜尋、取消封存、刪除之後都走這裡。
    public func reload() async {
        guard let sessions else {
            errorMessage = CardL10n.text(.archiveServiceUnavailable)
            return
        }
        loadGeneration += 1
        let current = loadGeneration
        eventsDuringLoad = []
        isLoading = true
        defer {
            if current == loadGeneration { isLoading = false }
        }

        var collected: [SessionSummary] = []
        var cursor: String?
        var pages = 0
        do {
            repeat {
                let page = try await sessions.listSessions(cursor: cursor, limit: pageSize)
                collected.append(contentsOf: page.sessions)
                cursor = page.nextCursor
                pages += 1
            } while cursor != nil && pages < pageLimit
        } catch {
            guard current == loadGeneration else { return }
            errorMessage = CardL10n.format(.archiveLoadFailed, value: errorText(error))
            return
        }
        guard current == loadGeneration else { return }

        listCache = Dictionary(collected.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        merge(collected)
        for event in eventsDuringLoad {
            apply(frame: event)
        }
        eventsDuringLoad = []
        errorMessage = nil
    }

    private func merge(_ listed: [SessionSummary]) {
        var merged: [String: ArchiveEntry] = [:]

        for summary in listed {
            guard let archive = summary.archive else { continue }
            merged[summary.id] = ArchiveEntry(
                id: summary.id,
                title: title(for: summary.id),
                archivedAt: archive.archivedAt,
                purgeAt: archive.purgeAt
            )
        }

        items = merged.values.sorted(by: sortByPurgeAt)
    }

    private func title(for sessionId: String) -> String {
        guard let summary = listCache[sessionId] else { return sessionId }
        return summary.title.isEmpty ? sessionId : summary.title
    }

    private func sortByPurgeAt(_ lhs: ArchiveEntry, _ rhs: ArchiveEntry) -> Bool {
        if lhs.purgeAt != rhs.purgeAt { return lhs.purgeAt < rhs.purgeAt }
        return lhs.id < rhs.id
    }

    private func upsert(_ entry: ArchiveEntry) {
        if let index = items.firstIndex(where: { $0.id == entry.id }) {
            items[index] = entry
        } else {
            items.append(entry)
        }
        items.sort(by: sortByPurgeAt)
    }

    // MARK: - 剩餘天數

    /// 距離 `purgeAt` 還有幾天；向上取整，歸零或過期都回 0。時間字串
    /// 解析不了時回 nil，畫面顯示「剩餘天數未知」。
    public func remainingDays(for entry: ArchiveEntry) -> Int? {
        guard let purgeAt = Self.parseISO8601(entry.purgeAt) else { return nil }
        let seconds = purgeAt.timeIntervalSince(now())
        guard seconds > 0 else { return 0 }
        return Int((seconds / 86_400).rounded(.up))
    }

    static func parseISO8601(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: text) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }

    // MARK: - 取消封存

    public func unarchive(sessionId: String) async {
        guard let management else {
            errorMessage = CardL10n.text(.archiveServiceUnavailable)
            return
        }
        do {
            _ = try await management.unarchiveSession(sessionId: sessionId)
            items.removeAll { $0.id == sessionId }
            noticeMessage = CardL10n.text(.archiveUnarchived)
            errorMessage = nil
        } catch {
            errorMessage = CardL10n.format(.archiveUnarchiveFailed, value: errorText(error))
        }
    }

    // MARK: - 刪除

    /// 先拿 `session.deletion_preview`，拿到才設 `deletionTarget` 讓確認視窗出現。
    public func beginDelete(sessionId: String) async {
        guard let management else {
            errorMessage = CardL10n.text(.archiveServiceUnavailable)
            return
        }
        guard deletionTarget == nil, !isPreviewingDeletion else { return }
        let title = items.first(where: { $0.id == sessionId })?.title ?? sessionId

        isPreviewingDeletion = true
        defer { isPreviewingDeletion = false }
        do {
            let preview = try await management.previewSessionDeletion(sessionId: sessionId)
            deletionTarget = ArchiveDeletionPreview(
                sessionId: sessionId,
                sessionTitle: title,
                preview: preview
            )
            errorMessage = nil
        } catch {
            errorMessage = CardL10n.format(.archivePreviewFailed, value: errorText(error))
        }
    }

    /// 確認刪除。刪除整個子樹；實際刪除的場次以回應的 `deletedSessionIds` 為準。
    public func confirmDelete() async {
        guard let target = deletionTarget, let management else { return }
        deletingSessionId = target.sessionId
        defer { deletingSessionId = nil }
        do {
            let response = try await management.deleteSession(
                sessionId: target.sessionId,
                clientRequestId: ClientRequestID.next("session-delete")
            )
            var gone = Set(response.deletedSessionIds)
            gone.insert(target.sessionId)
            items.removeAll { gone.contains($0.id) }
            deletionTarget = nil
            noticeMessage = CardL10n.text(.archiveDeleted)
            errorMessage = nil
        } catch {
            errorMessage = CardL10n.format(.archiveDeleteFailed, value: errorText(error))
        }
    }

    public func cancelDelete() {
        deletionTarget = nil
    }

    // MARK: - 事件

    /// `session.archived`／`session.unarchived`／`session.deleted` 掛在 system
    /// 串流；其他事件忽略。
    public func handle(frame: ServerFrame) {
        if isLoading { eventsDuringLoad.append(frame) }
        apply(frame: frame)
    }

    private func apply(frame: ServerFrame) {
        switch frame {
        case .sessionArchivedEvent(let event):
            let payload = event.payload
            upsert(ArchiveEntry(
                id: payload.sessionId,
                title: title(for: payload.sessionId),
                archivedAt: payload.archive.archivedAt,
                purgeAt: payload.archive.purgeAt
            ))
        case .sessionUnarchivedEvent(let event):
            items.removeAll { $0.id == event.payload.sessionId }
        case .sessionDeletedEvent(let event):
            var gone = Set(event.payload.deletedSessionIds)
            gone.insert(event.payload.sessionId)
            items.removeAll { gone.contains($0.id) }
            if let target = deletionTarget, gone.contains(target.sessionId) {
                deletionTarget = nil
            }
        default:
            break
        }
    }

    private func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}
