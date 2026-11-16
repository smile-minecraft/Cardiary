import CardiaryKit
import Foundation

@testable import CardiaryApp

/// 卡片庫測試用的分頁服務：`card.list` 與 `card.search` 回預先排好的頁，
/// 其他請求只記下來或回固定資料。真實的主機行為由 `RealServiceAppFlowTests` 驗。
actor PagedCardService: CardService {
    private var pages: [CardListResponsePayload]
    private var searchPages: [CardSearchResponsePayload]
    private var cards: [String: Card]

    private(set) var listCalls: [(cursor: String?, limit: Int?)] = []
    private(set) var searchCalls: [(query: String, cursor: String?, limit: Int?)] = []
    private(set) var patches: [(cardId: String, baseRevision: String, patch: CardPatch)] = []
    private(set) var deletedIds: [String] = []
    private(set) var refreshedIds: [String] = []
    private(set) var createdTitles: [String] = []
    private var getCardDelays: [String: TimeInterval] = [:]
    private var pending: [PendingCardPatch] = []
    private var history: [CardVersion] = []

    func setDocumentState(patches: [PendingCardPatch], versions: [CardVersion]) {
        pending = patches
        history = versions
    }

    func listCardPatches(cardId: String) async throws -> CardPatchesListResponsePayload {
        CardPatchesListResponsePayload(patches: pending.filter { $0.cardId == cardId })
    }

    func listCardVersions(cardId: String) async throws -> CardVersionsListResponsePayload {
        CardVersionsListResponsePayload(versions: history.filter { $0.cardId == cardId })
    }

    func acceptCardPatch(patchId: String, clientRequestId: String) async throws -> CardPatchAcceptResponsePayload {
        guard let patch = pending.first(where: { $0.patchId == patchId }), let card = cards[patch.cardId] else { throw TestFailure.notFound }
        let updated = documentCard(card, body: "新內文", revision: "rev-accepted")
        cards[card.cardId] = updated
        pending.removeAll { $0.patchId == patchId }
        history.append(documentVersion(cardId: card.cardId, seq: history.count + 1, kind: .patch, revision: updated.revision))
        return CardPatchAcceptResponsePayload(patch: patch, card: updated)
    }

    func rejectCardPatch(patchId: String, clientRequestId: String) async throws -> CardPatchRejectResponsePayload {
        guard let patch = pending.first(where: { $0.patchId == patchId }) else { throw TestFailure.notFound }
        pending.removeAll { $0.patchId == patchId }
        return CardPatchRejectResponsePayload(patch: patch)
    }

    func restoreCardVersion(cardId: String, versionId: String, baseRevision: String, clientRequestId: String) async throws -> CardVersionRestoreResponsePayload {
        guard let card = cards[cardId], history.contains(where: { $0.versionId == versionId }) else { throw TestFailure.notFound }
        let updated = documentCard(card, body: "舊內文", revision: "rev-restored")
        let version = documentVersion(cardId: cardId, seq: history.count + 1, kind: .restore, revision: updated.revision)
        cards[cardId] = updated
        history.append(version)
        return CardVersionRestoreResponsePayload(card: updated, version: version)
    }

    init(
        pages: [CardListResponsePayload] = [],
        searchPages: [CardSearchResponsePayload] = [],
        cards: [Card] = []
    ) {
        self.pages = pages
        self.searchPages = searchPages
        self.cards = Dictionary(uniqueKeysWithValues: cards.map { ($0.cardId, $0) })
    }

    func setCard(_ card: Card) {
        cards[card.cardId] = card
    }

    /// 測試競爭危害用：讓特定卡片的 `getCard` 延遲回應。
    func setGetCardDelay(_ cardId: String, delay: TimeInterval) {
        getCardDelays[cardId] = delay
    }

    func listCards(
        kinds: [CardKind]?,
        tags: [String]?,
        persona: String?,
        lifecycle: CardLifecycleFilter?,
        query: String?,
        includeSuperseded: Bool?,
        cursor: String?,
        limit: Int?
    ) async throws -> CardListResponsePayload {
        listCalls.append((cursor, limit))
        guard !pages.isEmpty else {
            return CardListResponsePayload(cards: [], nextCursor: nil)
        }
        return pages.removeFirst()
    }

    func searchCards(
        query: String,
        kinds: [CardKind]?,
        tags: [String]?,
        includeSuperseded: Bool?,
        limit: Int?,
        cursor: String?
    ) async throws -> CardSearchResponsePayload {
        searchCalls.append((query, cursor, limit))
        guard !searchPages.isEmpty else {
            return CardSearchResponsePayload(hits: [], nextCursor: nil)
        }
        return searchPages.removeFirst()
    }

    func getCard(cardId: String) async throws -> CardGetResponsePayload {
        if let delay = getCardDelays[cardId], delay > 0 {
            try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
        guard let card = cards[cardId] else { throw TestFailure.notFound }
        return CardGetResponsePayload(card: card)
    }

    func createCard(
        kind: CardKind,
        title: String,
        body: String,
        summary: String?,
        tags: [String]?,
        persona: String?,
        sources: [String]?,
        supersedes: String?,
        assetBlobId: String?,
        clientRequestId: String
    ) async throws -> CardCreateResponsePayload {
        createdTitles.append(title)
        let card = Card(
            cardId: "created-\(cards.count + 1)",
            kind: kind,
            title: title,
            summary: summary,
            body: body,
            tags: tags ?? [],
            persona: persona ?? "default",
            createdAt: "2026-01-01T00:00:00Z",
            freshness: 100,
            lifecycle: .live,
            sources: sources ?? [],
            links: CardLinks(outgoing: [], backlinks: []),
            revision: "rev-created"
        )
        cards[card.cardId] = card
        return CardCreateResponsePayload(card: CardSummary(
            cardId: card.cardId,
            kind: card.kind,
            title: card.title,
            summary: card.summary,
            tags: card.tags,
            persona: card.persona,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
            freshness: card.freshness,
            lifecycle: card.lifecycle,
            supersededBy: card.supersededBy,
            asset: card.asset
        ))
    }

    func patchCard(
        cardId: String,
        baseRevision: String,
        patch: CardPatch,
        clientRequestId: String?
    ) async throws -> CardPatchResponsePayload {
        patches.append((cardId, baseRevision, patch))
        guard let card = cards[cardId] else { throw TestFailure.notFound }
        let updated = Card(
            cardId: card.cardId,
            kind: card.kind,
            title: card.title,
            summary: card.summary,
            body: card.body,
            tags: card.tags,
            persona: card.persona,
            createdAt: card.createdAt,
            updatedAt: "2026-01-01T00:00:09Z",
            freshness: card.freshness,
            lifecycle: card.lifecycle,
            supersedes: card.supersedes,
            sources: card.sources,
            asset: card.asset,
            links: card.links,
            revision: "rev-2"
        )
        cards[cardId] = updated
        return CardPatchResponsePayload(card: updated)
    }

    func deleteCard(cardId: String, clientRequestId: String) async throws -> CardDeleteResponsePayload {
        deletedIds.append(cardId)
        cards.removeValue(forKey: cardId)
        return CardDeleteResponsePayload(cardId: cardId, deletedAssets: 0)
    }

    func refreshCard(cardId: String) async throws -> CardRefreshResponsePayload {
        refreshedIds.append(cardId)
        if let card = cards[cardId] {
            cards[cardId] = Card(
                cardId: card.cardId,
                kind: card.kind,
                title: card.title,
                summary: card.summary,
                body: card.body,
                tags: card.tags,
                persona: card.persona,
                createdAt: card.createdAt,
                updatedAt: card.updatedAt,
                freshness: 100,
                lifecycle: card.lifecycle,
                supersededBy: card.supersededBy,
                supersedes: card.supersedes,
                sources: card.sources,
                asset: card.asset,
                links: card.links,
                revision: card.revision
            )
        }
        return CardRefreshResponsePayload(cardId: cardId, freshness: 100)
    }
}

func documentCard(_ card: Card, body: String, revision: String) -> Card {
    Card(cardId: card.cardId, kind: card.kind, title: card.title, body: body, tags: card.tags,
         persona: card.persona, createdAt: card.createdAt, freshness: card.freshness,
         lifecycle: card.lifecycle, sources: card.sources, links: card.links, revision: revision)
}

func documentVersion(cardId: String, seq: Int, kind: CardVersionKind, revision: String) -> CardVersion {
    CardVersion(versionId: "version-\(seq)", cardId: cardId, seq: seq, kind: kind,
                revision: revision, bodyHash: "hash", createdAt: "2026-01-01T00:00:00Z")
}

enum TestFailure: Error {
    case notFound
}

/// 測試用的卡片摘要。
func makeCard(
    _ id: String,
    title: String? = nil,
    kind: CardKind = .note,
    body: String = "舊內文",
    tags: [String] = [],
    freshness: Int = 100,
    createdAt: String = "2026-01-01T00:00:00Z"
) -> Card {
    Card(
        cardId: id,
        kind: kind,
        title: title ?? "卡片 \(id)",
        body: body,
        tags: tags,
        persona: "default",
        createdAt: createdAt,
        freshness: freshness,
        lifecycle: .live,
        sources: [],
        links: CardLinks(outgoing: [], backlinks: []),
        revision: "rev-\(id)"
    )
}

func makeSummary(
    _ id: String,
    title: String? = nil,
    tags: [String] = [],
    freshness: Int = 100,
    createdAt: String = "2026-01-01T00:00:00Z"
) -> CardSummary {
    CardSummary(
        cardId: id,
        kind: .note,
        title: title ?? "卡片 \(id)",
        summary: nil,
        tags: tags,
        persona: "default",
        createdAt: createdAt,
        updatedAt: nil,
        freshness: freshness,
        lifecycle: .live,
        supersededBy: nil,
        asset: nil
    )
}
