import CardiaryKit
import Combine
import Foundation

/// 左側欄的對話清單：列出、建立、切換。
///
/// 清單以主機回報的摘要為準；這裡只保存「目前選了哪一場」，因為那是介面的狀態，
/// 不是主機的狀態。
@MainActor
public final class ConversationListModel: ObservableObject {
    public struct Item: Identifiable, Equatable, Sendable {
        public let id: String
        public var title: String
        public var status: SessionStatus
        public var messageCount: Int
        public var updatedAt: String

        public init(
            id: String,
            title: String,
            status: SessionStatus,
            messageCount: Int,
            updatedAt: String
        ) {
            self.id = id
            self.title = title
            self.status = status
            self.messageCount = messageCount
            self.updatedAt = updatedAt
        }

        init(summary: SessionSummary) {
            self.init(
                id: summary.id,
                title: summary.title,
                status: summary.status,
                messageCount: summary.messageCount,
                updatedAt: summary.updatedAt
            )
        }
    }

    @Published public private(set) var sessions: [Item] = []
    @Published public private(set) var selectedId: String?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?

    /// 一次列幾場對話。翻頁最多 20 頁，避免主機出問題時無限迴圈。
    public let pageSize: Int
    public let pageLimit: Int

    private var service: (any ConversationService)?

    public init(pageSize: Int = 50, pageLimit: Int = 20) {
        self.pageSize = pageSize
        self.pageLimit = pageLimit
    }

    public func attach(service: any ConversationService) {
        self.service = service
    }

    public var selectedSession: Item? {
        guard let selectedId else { return nil }
        return sessions.first { $0.id == selectedId }
    }

    public func select(_ id: String?) {
        selectedId = id
    }

    /// 重新列出對話。保留目前的選擇；選的那一場不見了才改選第一場。
    public func reload() async {
        guard let service else { return }
        isLoading = true
        defer { isLoading = false }

        var collected: [Item] = []
        var cursor: String?
        var pages = 0
        do {
            repeat {
                let page = try await service.listSessions(cursor: cursor, limit: pageSize)
                collected.append(contentsOf: page.sessions.map(Item.init(summary:)))
                cursor = page.nextCursor
                pages += 1
            } while cursor != nil && pages < pageLimit
        } catch {
            errorMessage = errorText(error)
            return
        }

        errorMessage = nil
        sessions = collected.sorted { $0.updatedAt > $1.updatedAt }
        if let selectedId, sessions.contains(where: { $0.id == selectedId }) {
            self.selectedId = selectedId
        } else {
            self.selectedId = sessions.first?.id
        }
    }

    /// 建立一場新對話並選取它。失敗回 nil。
    public func create(title: String? = nil) async -> String? {
        guard let service else { return nil }
        do {
            let response = try await service.createSession(
                clientRequestId: ClientRequestID.next("session"),
                title: title
            )
            let item = Item(summary: response.session)
            sessions.insert(item, at: 0)
            selectedId = item.id
            errorMessage = nil
            return item.id
        } catch {
            errorMessage = errorText(error)
            return nil
        }
    }

    /// 事件帶來的摘要變更（例如封存、重新命名）。
    public func upsert(_ summary: SessionSummary) {
        let item = Item(summary: summary)
        if let index = sessions.firstIndex(where: { $0.id == item.id }) {
            sessions[index] = item
        } else {
            sessions.insert(item, at: 0)
        }
        sessions.sort { $0.updatedAt > $1.updatedAt }
    }

    public func remove(id: String) {
        sessions.removeAll { $0.id == id }
        if selectedId == id {
            selectedId = sessions.first?.id
        }
    }

    private func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}
