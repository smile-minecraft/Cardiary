import Foundation
import XCTest

@testable import CardiaryKit

/// 卡片、上下文、封存與媒體的請求／回應：型別、欄位與事件分流。
final class CardClientTests: XCTestCase {
    private var transport: FakeServerTransport!
    private var connection: CardiaryConnection!

    override func setUp() async throws {
        transport = FakeServerTransport()
        connection = CardiaryConnection(transport: transport, clientToken: "client-token")
    }

    override func tearDown() async throws {
        await connection.close()
    }

    // MARK: - 卡片

    func testCardListSendsFiltersAndDecodesPage() async throws {
        let connection = self.connection!
        let task = Task {
            try await connection.listCards(
                kinds: [.note, .image],
                tags: ["記憶"],
                persona: "default",
                lifecycle: .live,
                query: "卡片",
                includeSuperseded: false,
                cursor: "page_1",
                limit: 20
            )
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "card.list")
        let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(payload["kinds"] as? [String], ["note", "image"])
        XCTAssertEqual(payload["tags"] as? [String], ["記憶"])
        XCTAssertEqual(payload["persona"] as? String, "default")
        XCTAssertEqual(payload["lifecycle"] as? String, "live")
        XCTAssertEqual(payload["query"] as? String, "卡片")
        XCTAssertEqual(payload["includeSuperseded"] as? Bool, false)
        XCTAssertEqual(payload["cursor"] as? String, "page_1")
        XCTAssertEqual(payload["limit"] as? Int, 20)

        await transport.push(
            Self.response(
                type: "card.list",
                replyTo: try XCTUnwrap(sent["id"] as? String),
                payload: [
                    "cards": [Self.cardSummary("card_1"), Self.cardSummary("card_2", kind: "image")],
                    "nextCursor": "page_2",
                ]
            )
        )
        let page = try await task.value
        XCTAssertEqual(page.cards.map(\.cardId), ["card_1", "card_2"])
        XCTAssertEqual(page.cards.last?.kind, .image)
        XCTAssertEqual(page.nextCursor, "page_2")
    }

    func testCardListOmitsUnsetFilters() async throws {
        let connection = self.connection!
        let task = Task { try await connection.listCards() }
        let sent = JSONFixture.decode(try await transport.nextSent())
        let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertNil(payload["kinds"], "沒有指定就不要送出空篩選")
        XCTAssertNil(payload["lifecycle"])
        XCTAssertNil(payload["cursor"])

        await transport.push(
            Self.response(
                type: "card.list",
                replyTo: try XCTUnwrap(sent["id"] as? String),
                payload: ["cards": []]
            )
        )
        let page = try await task.value
        XCTAssertTrue(page.cards.isEmpty)
    }

    func testCardGetAndCreateRoundTrip() async throws {
        let connection = self.connection!
        let getTask = Task { try await connection.getCard(cardId: "card_1") }
        let getSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(getSent["type"] as? String, "card.get")
        XCTAssertEqual(
            (getSent["payload"] as? [String: Any])?["cardId"] as? String,
            "card_1"
        )
        await transport.push(
            Self.response(
                type: "card.get",
                replyTo: try XCTUnwrap(getSent["id"] as? String),
                payload: ["card": Self.card("card_1")]
            )
        )
        let card = try await getTask.value
        XCTAssertEqual(card.card.cardId, "card_1")
        XCTAssertEqual(card.card.body, "內文")
        XCTAssertEqual(card.card.revision, "rev_1")
        XCTAssertEqual(card.card.links.outgoing, ["card_2"])

        let createTask = Task {
            try await connection.createCard(
                kind: .note,
                title: "新卡",
                body: "內容",
                tags: ["工作"],
                sources: ["sess_1"],
                clientRequestId: "req_create_1"
            )
        }
        let createSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(createSent["type"] as? String, "card.create")
        let createPayload = try XCTUnwrap(createSent["payload"] as? [String: Any])
        XCTAssertEqual(createPayload["kind"] as? String, "note")
        XCTAssertEqual(createPayload["title"] as? String, "新卡")
        XCTAssertEqual(createPayload["clientRequestId"] as? String, "req_create_1")
        XCTAssertEqual(createPayload["sources"] as? [String], ["sess_1"])
        await transport.push(
            Self.response(
                type: "card.create",
                replyTo: try XCTUnwrap(createSent["id"] as? String),
                payload: ["card": Self.cardSummary("card_9", title: "新卡")]
            )
        )
        let created = try await createTask.value
        XCTAssertEqual(created.card.cardId, "card_9")
    }

    func testCardPatchAndDeleteRoundTrip() async throws {
        let connection = self.connection!
        let patchTask = Task {
            try await connection.patchCard(
                cardId: "card_1",
                baseRevision: "rev_1",
                patch: CardPatch(format: .replace, text: "新的內文"),
                clientRequestId: "req_patch_1"
            )
        }
        let patchSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(patchSent["type"] as? String, "card.patch")
        let patchPayload = try XCTUnwrap(patchSent["payload"] as? [String: Any])
        XCTAssertEqual(patchPayload["baseRevision"] as? String, "rev_1")
        XCTAssertEqual(patchPayload["clientRequestId"] as? String, "req_patch_1")
        let patch = try XCTUnwrap(patchPayload["patch"] as? [String: Any])
        XCTAssertEqual(patch["format"] as? String, "replace")
        XCTAssertEqual(patch["text"] as? String, "新的內文")
        await transport.push(
            Self.response(
                type: "card.patch",
                replyTo: try XCTUnwrap(patchSent["id"] as? String),
                payload: ["card": Self.card("card_1", revision: "rev_2")]
            )
        )
        let patched = try await patchTask.value
        XCTAssertEqual(patched.card.revision, "rev_2")

        let deleteTask = Task {
            try await connection.deleteCard(cardId: "card_1", clientRequestId: "req_delete_1")
        }
        let deleteSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(deleteSent["type"] as? String, "card.delete")
        let deletePayload = try XCTUnwrap(deleteSent["payload"] as? [String: Any])
        XCTAssertEqual(deletePayload["clientRequestId"] as? String, "req_delete_1")
        await transport.push(
            Self.response(
                type: "card.delete",
                replyTo: try XCTUnwrap(deleteSent["id"] as? String),
                payload: ["cardId": "card_1", "deletedAssets": 2]
            )
        )
        let deleted = try await deleteTask.value
        XCTAssertEqual(deleted.deletedAssets, 2)
    }

    func testCardSearchAndRefreshRoundTrip() async throws {
        let connection = self.connection!
        let searchTask = Task {
            try await connection.searchCards(query: "卡片", limit: 5)
        }
        let searchSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(searchSent["type"] as? String, "card.search")
        let searchPayload = try XCTUnwrap(searchSent["payload"] as? [String: Any])
        XCTAssertEqual(searchPayload["query"] as? String, "卡片")
        XCTAssertEqual(searchPayload["limit"] as? Int, 5)
        await transport.push(
            Self.response(
                type: "card.search",
                replyTo: try XCTUnwrap(searchSent["id"] as? String),
                payload: [
                    "hits": [
                        ["card": Self.cardSummary("card_1"), "score": 0.8, "snippet": "…卡片…"],
                    ],
                ]
            )
        )
        let hits = try await searchTask.value
        XCTAssertEqual(hits.hits.first?.card.cardId, "card_1")
        XCTAssertEqual(hits.hits.first?.snippet, "…卡片…")

        let refreshTask = Task { try await connection.refreshCard(cardId: "card_1") }
        let refreshSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(refreshSent["type"] as? String, "card.refresh")
        await transport.push(
            Self.response(
                type: "card.refresh",
                replyTo: try XCTUnwrap(refreshSent["id"] as? String),
                payload: ["cardId": "card_1", "freshness": 100]
            )
        )
        let refreshed = try await refreshTask.value
        XCTAssertEqual(refreshed.freshness, 100)
    }

    // MARK: - 上下文

    func testContextRequestsRoundTrip() async throws {
        let connection = self.connection!
        let getTask = Task { try await connection.getContext(sessionId: "sess_1") }
        let getSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(getSent["type"] as? String, "context.get")
        XCTAssertEqual(
            (getSent["payload"] as? [String: Any])?["sessionId"] as? String,
            "sess_1"
        )
        await transport.push(
            Self.response(
                type: "context.get",
                replyTo: try XCTUnwrap(getSent["id"] as? String),
                payload: ["context": Self.contextView(sessionId: "sess_1")]
            )
        )
        let context = try await getTask.value
        XCTAssertEqual(context.context.usedTokens, 420)
        XCTAssertEqual(context.context.entries.map(\.layer), [.persona, .workingContext])
        XCTAssertEqual(context.context.entries.last?.state, .pendingRemoval)

        let addTask = Task {
            try await connection.addCardToContext(sessionId: "sess_1", cardId: "card_2")
        }
        let addSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(addSent["type"] as? String, "context.add_card")
        let addPayload = try XCTUnwrap(addSent["payload"] as? [String: Any])
        XCTAssertEqual(addPayload["cardId"] as? String, "card_2")
        await transport.push(
            Self.response(
                type: "context.add_card",
                replyTo: try XCTUnwrap(addSent["id"] as? String),
                payload: ["context": Self.contextView(sessionId: "sess_1")]
            )
        )
        _ = try await addTask.value

        let removeTask = Task {
            try await connection.removeCardFromContext(sessionId: "sess_1", cardId: "card_2")
        }
        let removeSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(removeSent["type"] as? String, "context.remove_card")
        await transport.push(
            Self.response(
                type: "context.remove_card",
                replyTo: try XCTUnwrap(removeSent["id"] as? String),
                payload: ["context": Self.contextView(sessionId: "sess_1")]
            )
        )
        _ = try await removeTask.value

        let compactTask = Task {
            try await connection.compactContext(sessionId: "sess_1", instructions: "只留結論")
        }
        let compactSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(compactSent["type"] as? String, "context.compact")
        XCTAssertEqual(
            (compactSent["payload"] as? [String: Any])?["instructions"] as? String,
            "只留結論"
        )
        await transport.push(
            Self.response(
                type: "context.compact",
                replyTo: try XCTUnwrap(compactSent["id"] as? String),
                payload: ["sessionId": "sess_1", "scheduled": true]
            )
        )
        let compact = try await compactTask.value
        XCTAssertTrue(compact.scheduled)
    }

    // MARK: - 封存與刪除

    func testSessionArchiveUnarchivePreviewAndDeleteRoundTrip() async throws {
        let connection = self.connection!
        let archiveTask = Task {
            try await connection.archiveSession(sessionId: "sess_1", purgeAfterDays: 30)
        }
        let archiveSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(archiveSent["type"] as? String, "session.archive")
        XCTAssertEqual(
            (archiveSent["payload"] as? [String: Any])?["purgeAfterDays"] as? Int,
            30
        )
        await transport.push(
            Self.response(
                type: "session.archive",
                replyTo: try XCTUnwrap(archiveSent["id"] as? String),
                payload: [
                    "sessionId": "sess_1",
                    "archive": ["archivedAt": "2026-11-15T00:00:00Z", "purgeAt": "2026-12-15T00:00:00Z"],
                ]
            )
        )
        let archived = try await archiveTask.value
        XCTAssertEqual(archived.archive.purgeAt, "2026-12-15T00:00:00Z")

        let unarchiveTask = Task { try await connection.unarchiveSession(sessionId: "sess_1") }
        let unarchiveSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(unarchiveSent["type"] as? String, "session.unarchive")
        await transport.push(
            Self.response(
                type: "session.unarchive",
                replyTo: try XCTUnwrap(unarchiveSent["id"] as? String),
                payload: ["sessionId": "sess_1", "unarchived": true]
            )
        )
        let unarchived = try await unarchiveTask.value
        XCTAssertTrue(unarchived.unarchived)

        let previewTask = Task {
            try await connection.previewSessionDeletion(sessionId: "sess_1")
        }
        let previewSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(previewSent["type"] as? String, "session.deletion_preview")
        await transport.push(
            Self.response(
                type: "session.deletion_preview",
                replyTo: try XCTUnwrap(previewSent["id"] as? String),
                payload: [
                    "sessionId": "sess_1",
                    "subtreeSessionIds": ["sess_1", "sess_2"],
                    "exclusiveCards": 4,
                    "sharedCards": 2,
                    "assets": 1,
                ]
            )
        )
        let preview = try await previewTask.value
        XCTAssertEqual(preview.subtreeSessionIds, ["sess_1", "sess_2"])
        XCTAssertEqual(preview.exclusiveCards, 4)
        XCTAssertEqual(preview.sharedCards, 2)

        let deleteTask = Task {
            try await connection.deleteSession(sessionId: "sess_1", clientRequestId: "req_delete_sess")
        }
        let deleteSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(deleteSent["type"] as? String, "session.delete")
        XCTAssertEqual(
            (deleteSent["payload"] as? [String: Any])?["clientRequestId"] as? String,
            "req_delete_sess"
        )
        await transport.push(
            Self.response(
                type: "session.delete",
                replyTo: try XCTUnwrap(deleteSent["id"] as? String),
                payload: [
                    "sessionId": "sess_1",
                    "deletedSessionIds": ["sess_1", "sess_2"],
                    "deletedCards": 4,
                    "deletedAssets": 1,
                ]
            )
        )
        let deleted = try await deleteTask.value
        XCTAssertEqual(deleted.deletedCards, 4)
        XCTAssertEqual(deleted.deletedAssets, 1)
    }

    // MARK: - 媒體

    func testMediaImportRoundTrip() async throws {
        let connection = self.connection!
        let task = Task {
            try await connection.importMedia(
                blobId: String(repeating: "a", count: 64),
                ocrLocales: ["zh-Hant", "en-US"],
                title: "截圖",
                tags: ["工作"],
                persona: "default"
            )
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "media.import")
        let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(payload["blobId"] as? String, String(repeating: "a", count: 64))
        XCTAssertEqual(payload["ocrLocales"] as? [String], ["zh-Hant", "en-US"])
        XCTAssertEqual(payload["title"] as? String, "截圖")
        await transport.push(
            Self.response(
                type: "media.import",
                replyTo: try XCTUnwrap(sent["id"] as? String),
                payload: [
                    "cardId": "card_9",
                    "kind": "image",
                    "deduped": false,
                    "textStandIn": [
                        "sources": [
                            "ocr": "local",
                            "description": "small-model",
                            "transcript": "none",
                            "summary": "none",
                        ],
                        "missingParts": ["summary"],
                    ],
                ]
            )
        )
        let imported = try await task.value
        XCTAssertEqual(imported.cardId, "card_9")
        XCTAssertEqual(imported.kind, .image)
        XCTAssertEqual(imported.textStandIn.sources.ocr, .local)
        XCTAssertEqual(imported.textStandIn.missingParts, ["summary"])
    }

    // MARK: - 回應與事件分流

    /// 每一個 M1 回應都必須被 `replyTo` 接走，不能落進 default 變成事件。
    func testM1ResponsesAreNotDeliveredAsEvents() async throws {
        let connection = self.connection!
        let events = Recorder<ServerFrame>()
        let consumer = Task {
            for await frame in connection.events {
                events.append(frame)
            }
        }
        defer { consumer.cancel() }

        try await roundTrip(
            type: "card.list",
            payload: ["cards": []],
            call: { try await connection.listCards() }
        )
        try await roundTrip(
            type: "card.get",
            payload: ["card": Self.card("card_1")],
            call: { try await connection.getCard(cardId: "card_1") }
        )
        try await roundTrip(
            type: "card.create",
            payload: ["card": Self.cardSummary("card_1")],
            call: {
                try await connection.createCard(
                    kind: .note,
                    title: "卡",
                    body: "內文",
                    clientRequestId: "req_1"
                )
            }
        )
        try await roundTrip(
            type: "card.patch",
            payload: ["card": Self.card("card_1")],
            call: {
                try await connection.patchCard(
                    cardId: "card_1",
                    baseRevision: "rev_1",
                    patch: CardPatch(format: .replace, text: "新")
                )
            }
        )
        try await roundTrip(
            type: "card.delete",
            payload: ["cardId": "card_1", "deletedAssets": 0],
            call: { try await connection.deleteCard(cardId: "card_1", clientRequestId: "req_2") }
        )
        try await roundTrip(
            type: "card.search",
            payload: ["hits": []],
            call: { try await connection.searchCards(query: "卡") }
        )
        try await roundTrip(
            type: "card.refresh",
            payload: ["cardId": "card_1", "freshness": 100],
            call: { try await connection.refreshCard(cardId: "card_1") }
        )
        try await roundTrip(
            type: "context.get",
            payload: ["context": Self.contextView(sessionId: "sess_1")],
            call: { try await connection.getContext(sessionId: "sess_1") }
        )
        try await roundTrip(
            type: "context.add_card",
            payload: ["context": Self.contextView(sessionId: "sess_1")],
            call: { try await connection.addCardToContext(sessionId: "sess_1", cardId: "card_1") }
        )
        try await roundTrip(
            type: "context.remove_card",
            payload: ["context": Self.contextView(sessionId: "sess_1")],
            call: { try await connection.removeCardFromContext(sessionId: "sess_1", cardId: "card_1") }
        )
        try await roundTrip(
            type: "context.compact",
            payload: ["sessionId": "sess_1", "scheduled": true],
            call: { try await connection.compactContext(sessionId: "sess_1") }
        )
        try await roundTrip(
            type: "session.archive",
            payload: [
                "sessionId": "sess_1",
                "archive": ["archivedAt": "2026-11-15T00:00:00Z", "purgeAt": "2026-12-15T00:00:00Z"],
            ],
            call: { try await connection.archiveSession(sessionId: "sess_1") }
        )
        try await roundTrip(
            type: "session.unarchive",
            payload: ["sessionId": "sess_1", "unarchived": true],
            call: { try await connection.unarchiveSession(sessionId: "sess_1") }
        )
        try await roundTrip(
            type: "session.deletion_preview",
            payload: [
                "sessionId": "sess_1",
                "subtreeSessionIds": ["sess_1"],
                "exclusiveCards": 0,
                "sharedCards": 0,
                "assets": 0,
            ],
            call: { try await connection.previewSessionDeletion(sessionId: "sess_1") }
        )
        try await roundTrip(
            type: "session.delete",
            payload: [
                "sessionId": "sess_1",
                "deletedSessionIds": ["sess_1"],
                "deletedCards": 0,
                "deletedAssets": 0,
            ],
            call: { try await connection.deleteSession(sessionId: "sess_1", clientRequestId: "req_3") }
        )
        try await roundTrip(
            type: "media.import",
            payload: [
                "cardId": "card_1",
                "kind": "image",
                "deduped": false,
                "textStandIn": [
                    "sources": [
                        "ocr": "none",
                        "description": "none",
                        "transcript": "none",
                        "summary": "none",
                    ],
                    "missingParts": ["ocr", "description"],
                ],
            ],
            call: { try await connection.importMedia(blobId: String(repeating: "a", count: 64)) }
        )

        XCTAssertTrue(events.snapshot.isEmpty, "回應不能變成事件")

        // 事件照樣送出：card.changed 掛在 system 串流。
        await transport.push(
            JSONFixture.string([
                "v": 1,
                "kind": "event",
                "type": "card.changed",
                "stream": "system",
                "seq": 12,
                "emittedAt": "2026-11-15T00:00:05Z",
                "payload": ["cardId": "card_1", "change": "updated", "revision": "rev_2", "freshness": 80],
            ])
        )
        try await waitUntil { events.snapshot.count == 1 }
        guard case .cardChangedEvent(let event) = events.snapshot[0] else {
            return XCTFail("事件沒有送到 events 串流")
        }
        XCTAssertEqual(event.payload.cardId, "card_1")
        XCTAssertEqual(event.payload.change, .updated)
        XCTAssertEqual(event.stream, "system")
    }

    /// 連線中斷時，在途請求要拿到錯誤；新的連線不會被舊回應汙染。
    func testInFlightRequestFailsWhenConnectionDrops() async throws {
        let connection = self.connection!
        let task = Task { try await connection.listCards() }
        _ = try await transport.nextSent()
        await transport.serverClosed()

        do {
            _ = try await task.value
            XCTFail("預期連線關閉")
        } catch let error as CardiaryClientError {
            XCTAssertEqual(error, .connectionClosed)
        }
    }

    /// 重連後新的 epoch 只服務新的請求；上一個連線的卡片請求不會跟著活下來。
    func testReconnectDoesNotLeakInFlightCardRequest() async throws {
        let queue = TransportQueue()
        let first = FakeServerTransport()
        let second = FakeServerTransport()
        queue.append(first)
        queue.append(second)

        let client = CardiaryClient(
            configuration: CardiaryClient.Configuration(
                endpoint: URL(string: "ws://127.0.0.1:1/v1/ws")!,
                clientToken: "client-token",
                client: ClientInfo(
                    name: "Cardiary macOS",
                    version: "0.1.0",
                    platform: .macos,
                    instanceId: "inst_test"
                ),
                reconnect: ReconnectPolicy(baseDelay: .milliseconds(10), maxDelay: .milliseconds(20)),
                subscribeActiveSessions: false
            )
        ) { _ in
            queue.next()
        }
        await client.start()

        let hello = JSONFixture.decode(try await first.nextSent())
        await first.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello["id"] as? String),
                epoch: "epoch_a"
            )
        )
        let subscribe = JSONFixture.decode(try await first.nextSent())
        await first.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe["id"] as? String),
                seq: 1,
                epoch: "epoch_a",
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus()
            )
        )

        let lost = Task { try await client.listCards() }
        _ = try await first.nextSent()
        await first.serverClosed()
        do {
            _ = try await lost.value
            XCTFail("舊連線的請求要失敗")
        } catch let error as CardiaryClientError {
            XCTAssertEqual(error, .connectionClosed)
        }

        let hello2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello2["id"] as? String),
                epoch: "epoch_b"
            )
        )
        let subscribe2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe2["id"] as? String),
                seq: 1,
                epoch: "epoch_b",
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus()
            )
        )

        let refresh = Task { try await client.refreshCard(cardId: "card_1") }
        let sent = JSONFixture.decode(try await second.nextSent())
        XCTAssertEqual(sent["type"] as? String, "card.refresh")
        await second.push(
            Self.response(
                type: "card.refresh",
                replyTo: try XCTUnwrap(sent["id"] as? String),
                payload: ["cardId": "card_1", "freshness": 100]
            )
        )
        let refreshed = try await refresh.value
        XCTAssertEqual(refreshed.cardId, "card_1")
        await client.stop()
    }


    // MARK: - 版本與待決補丁

    func testCardPatchesListRoundTrip() async throws {
        let connection = self.connection!
        try await roundTripShort(
            type: "card.patches.list",
            payload: [
                "patches": [
                    Self.pendingPatch("patch_1"),
                    Self.pendingPatch("patch_2", status: "accepted"),
                ],
            ]
        ) { options in
            let result = try await connection.listCardPatches(cardId: "card_1", options: options)
            XCTAssertEqual(result.patches.map(\.patchId), ["patch_1", "patch_2"])
            XCTAssertEqual(result.patches[0].status, .pending)
            XCTAssertEqual(result.patches[1].status, .accepted)
            XCTAssertEqual(result.patches[0].patch.format, .unified)
            return result
        }
    }

    func testCardVersionsListRoundTrip() async throws {
        let connection = self.connection!
        try await roundTripShort(
            type: "card.versions.list",
            payload: [
                "versions": [
                    Self.version("ver_1", seq: 1, kind: "create"),
                    Self.version("ver_2", seq: 2, kind: "patch"),
                ],
            ]
        ) { options in
            let result = try await connection.listCardVersions(cardId: "card_1", options: options)
            XCTAssertEqual(result.versions.map(\.seq), [1, 2])
            XCTAssertEqual(result.versions.map(\.kind), [.create, .patch])
            return result
        }
    }

    /// 與 reloadDocumentDetails 相同的順序：先 patches、再 versions，兩個都要正常回傳。
    func testPatchesThenVersionsResolveInOrder() async throws {
        let connection = self.connection!
        let options = CardiaryConnection.RequestOptions(timeout: .seconds(2))

        let patchesTask = Task {
            try await connection.listCardPatches(cardId: "card_1", options: options)
        }
        let patchesSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(patchesSent["type"] as? String, "card.patches.list")
        await transport.push(
            Self.response(
                type: "card.patches.list",
                replyTo: try XCTUnwrap(patchesSent["id"] as? String),
                payload: ["patches": [Self.pendingPatch("patch_1")]]
            )
        )
        let patches = try await patchesTask.value
        XCTAssertEqual(patches.patches.map(\.patchId), ["patch_1"])

        let versionsTask = Task {
            try await connection.listCardVersions(cardId: "card_1", options: options)
        }
        let versionsSent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(versionsSent["type"] as? String, "card.versions.list")
        await transport.push(
            Self.response(
                type: "card.versions.list",
                replyTo: try XCTUnwrap(versionsSent["id"] as? String),
                payload: [
                    "versions": [
                        Self.version("ver_1", seq: 1, kind: "create"),
                        Self.version("ver_2", seq: 2, kind: "patch"),
                    ],
                ]
            )
        )
        let versions = try await versionsTask.value
        XCTAssertEqual(versions.versions.map(\.seq), [1, 2])
    }

    func testCardVersionGetAndRestoreRoundTrip() async throws {
        let connection = self.connection!
        try await roundTripShort(
            type: "card.version.get",
            payload: ["body": "歷史內文"]
        ) { options in
            let result = try await connection.getCardVersion(
                cardId: "card_1",
                versionId: "ver_1",
                options: options
            )
            XCTAssertEqual(result.body, "歷史內文")
            return result
        }
        try await roundTripShort(
            type: "card.version.restore",
            payload: [
                "card": Self.card("card_1", revision: "rev_9"),
                "version": Self.version("ver_1", seq: 1, kind: "restore"),
            ]
        ) { options in
            let result = try await connection.restoreCardVersion(
                cardId: "card_1",
                versionId: "ver_1",
                baseRevision: "rev_1",
                clientRequestId: "req_restore",
                options: options
            )
            XCTAssertEqual(result.card.revision, "rev_9")
            XCTAssertEqual(result.version.kind, .restore)
            return result
        }
    }

    func testCardPatchAcceptAndRejectRoundTrip() async throws {
        let connection = self.connection!
        try await roundTripShort(
            type: "card.patch.accept",
            payload: [
                "patch": Self.pendingPatch("patch_1", status: "accepted", decidedAt: "2026-11-15T00:01:00Z"),
                "card": Self.card("card_1", revision: "rev_9"),
            ]
        ) { options in
            let result = try await connection.acceptCardPatch(
                patchId: "patch_1",
                clientRequestId: "req_accept",
                options: options
            )
            XCTAssertEqual(result.patch.status, .accepted)
            XCTAssertEqual(result.patch.decidedAt, "2026-11-15T00:01:00Z")
            XCTAssertEqual(result.card.revision, "rev_9")
            return result
        }
        try await roundTripShort(
            type: "card.patch.reject",
            payload: [
                "patch": Self.pendingPatch("patch_1", status: "rejected", decidedAt: "2026-11-15T00:01:00Z"),
            ]
        ) { options in
            let result = try await connection.rejectCardPatch(
                patchId: "patch_1",
                clientRequestId: "req_reject",
                options: options
            )
            XCTAssertEqual(result.patch.status, .rejected)
            return result
        }
    }

    /// 所有 M3 新增的回應都不能落進 default 變成事件；board 與 notification 同樣要回到請求方。
    func testM3ResponsesAreNotDeliveredAsEvents() async throws {
        let connection = self.connection!
        let events = Recorder<ServerFrame>()
        let consumer = Task {
            for await frame in connection.events {
                events.append(frame)
            }
        }
        defer { consumer.cancel() }

        try await roundTripShort(
            type: "card.patches.list",
            payload: ["patches": []]
        ) { options in
            _ = try await connection.listCardPatches(cardId: "card_1", options: options)
        }
        try await roundTripShort(
            type: "card.patch.accept",
            payload: [
                "patch": Self.pendingPatch("patch_1", status: "accepted"),
                "card": Self.card("card_1"),
            ]
        ) { options in
            _ = try await connection.acceptCardPatch(
                patchId: "patch_1",
                clientRequestId: "req_accept",
                options: options
            )
        }
        try await roundTripShort(
            type: "card.patch.reject",
            payload: ["patch": Self.pendingPatch("patch_1", status: "rejected")]
        ) { options in
            _ = try await connection.rejectCardPatch(
                patchId: "patch_1",
                clientRequestId: "req_reject",
                options: options
            )
        }
        try await roundTripShort(
            type: "card.versions.list",
            payload: ["versions": []]
        ) { options in
            _ = try await connection.listCardVersions(cardId: "card_1", options: options)
        }
        try await roundTripShort(
            type: "card.version.get",
            payload: ["body": "內文"]
        ) { options in
            _ = try await connection.getCardVersion(
                cardId: "card_1",
                versionId: "ver_1",
                options: options
            )
        }
        try await roundTripShort(
            type: "card.version.restore",
            payload: [
                "card": Self.card("card_1"),
                "version": Self.version("ver_1", seq: 1, kind: "restore"),
            ]
        ) { options in
            _ = try await connection.restoreCardVersion(
                cardId: "card_1",
                versionId: "ver_1",
                baseRevision: "rev_1",
                clientRequestId: "req_restore",
                options: options
            )
        }
        try await roundTripShort(
            type: "board.list",
            payload: ["boards": [Self.boardSummary("board_1")]]
        ) { options in
            _ = try await connection.listBoards(options: options)
        }
        try await roundTripShort(
            type: "board.get",
            payload: ["board": Self.boardDocument()]
        ) { options in
            _ = try await connection.getBoard(boardId: "board_1", options: options)
        }
        try await roundTripShort(
            type: "board.create",
            payload: ["board": Self.boardDocument()]
        ) { options in
            _ = try await connection.createBoard(
                boardId: "board_1",
                title: "白板",
                clientRequestId: "req_board",
                options: options
            )
        }
        try await roundTripShort(
            type: "board.save",
            payload: ["board": Self.boardDocument()]
        ) { options in
            _ = try await connection.saveBoard(
                board: Self.boardDocumentValue(),
                baseUpdatedAt: "2026-11-15T00:00:00Z",
                clientRequestId: "req_save",
                options: options
            )
        }
        try await roundTripShort(
            type: "board.delete",
            payload: ["deleted": true]
        ) { options in
            _ = try await connection.deleteBoard(boardId: "board_1", options: options)
        }
        try await roundTripShort(
            type: "board.project_card",
            payload: ["board": Self.boardDocument()]
        ) { options in
            _ = try await connection.projectCardOnBoard(
                boardId: "board_1",
                itemId: "item_1",
                cardId: "card_1",
                position: BoardPoint(x: 10, y: 20),
                options: options
            )
        }
        try await roundTripShort(
            type: "board.unproject_card",
            payload: ["board": Self.boardDocument()]
        ) { options in
            _ = try await connection.unprojectCardOnBoard(
                boardId: "board_1",
                itemId: "item_1",
                options: options
            )
        }
        try await roundTripShort(
            type: "board.create_card_from_selection",
            payload: ["board": Self.boardDocument(), "cardId": "card_9"]
        ) { options in
            _ = try await connection.createCardFromSelection(
                boardId: "board_1",
                cardIds: ["card_1"],
                title: "新卡",
                body: "內文",
                itemId: "item_2",
                position: BoardPoint(x: 30, y: 40),
                clientRequestId: "req_selection",
                options: options
            )
        }
        try await roundTripShort(
            type: "notification.list",
            payload: [
                "notifications": [Self.notification("noti_1")],
                "totalUnread": 1,
            ]
        ) { options in
            _ = try await connection.listNotifications(options: options)
        }
        try await roundTripShort(
            type: "notification.mark_read",
            payload: ["updated": 1, "totalUnread": 0]
        ) { options in
            _ = try await connection.markNotificationsRead(ids: ["noti_1"], options: options)
        }
        try await roundTripShort(
            type: "notification.create_card",
            payload: ["card": Self.cardSummary("card_9"), "deduped": false]
        ) { options in
            _ = try await connection.createCardFromNotification(
                notificationId: "noti_1",
                options: options
            )
        }

        XCTAssertTrue(events.snapshot.isEmpty, "回應不能變成事件")
    }

    // MARK: - 共用


    private func roundTripShort<T: Sendable>(
        type: String,
        payload: [String: Any],
        options: CardiaryConnection.RequestOptions = CardiaryConnection.RequestOptions(timeout: .seconds(2)),
        call: @escaping @Sendable (CardiaryConnection.RequestOptions) async throws -> T
    ) async throws {
        let task = Task { try await call(options) }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, type)
        await transport.push(
            Self.response(
                type: type,
                replyTo: try XCTUnwrap(sent["id"] as? String),
                payload: payload
            )
        )
        _ = try await task.value
    }

    private static func pendingPatch(
        _ id: String,
        cardId: String = "card_1",
        status: String = "pending",
        decidedAt: String? = nil
    ) -> [String: Any] {
        var value: [String: Any] = [
            "patchId": id,
            "cardId": cardId,
            "baseRevision": "rev_1",
            "patch": ["format": "unified", "text": "@@ -1 +1 @@"],
            "status": status,
            "summary": "待決補丁",
            "createdAt": "2026-11-15T00:00:00Z",
        ]
        if let decidedAt {
            value["decidedAt"] = decidedAt
        }
        return value
    }

    private static func version(
        _ id: String,
        seq: Int,
        kind: String
    ) -> [String: Any] {
        [
            "versionId": id,
            "cardId": "card_1",
            "seq": seq,
            "kind": kind,
            "revision": "rev_\(seq)",
            "bodyHash": String(repeating: "a", count: 64),
            "createdAt": "2026-11-15T00:00:0\(seq)Z",
        ]
    }

    private static func boardSummary(_ id: String) -> [String: Any] {
        [
            "id": id,
            "title": "白板",
            "updatedAt": "2026-11-15T00:00:00Z",
            "itemCount": 2,
        ]
    }

    private static func boardDocument(_ id: String = "board_1") -> [String: Any] {
        [
            "schema": 1,
            "id": id,
            "title": "白板",
            "createdAt": "2026-11-15T00:00:00Z",
            "updatedAt": "2026-11-15T00:00:00Z",
            "items": [],
            "inbox": [],
            "edges": [],
            "groups": [],
        ]
    }

    private static func boardDocumentValue() -> BoardDocument {
        BoardDocument(
            id: "board_1",
            title: "白板",
            createdAt: "2026-11-15T00:00:00Z",
            updatedAt: "2026-11-15T00:00:00Z",
            items: [],
            inbox: [],
            edges: [],
            groups: []
        )
    }

    private static func notification(_ id: String) -> [String: Any] {
        [
            "notificationId": id,
            "kind": "schedule",
            "title": "提醒",
            "body": "內容",
            "createdAt": "2026-11-15T00:00:00Z",
            "payload": [:],
        ]
    }

    private func roundTrip<T: Sendable>(
        type: String,
        payload: [String: Any],
        call: @escaping @Sendable () async throws -> T
    ) async throws {
        let task = Task { try await call() }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, type)
        await transport.push(
            Self.response(
                type: type,
                replyTo: try XCTUnwrap(sent["id"] as? String),
                payload: payload
            )
        )
        _ = try await task.value
    }

    private func waitUntil(
        timeout: TimeInterval = 3,
        _ condition: @Sendable () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTFail("等待條件逾時")
    }

    private static func response(
        type: String,
        replyTo: String,
        payload: [String: Any]
    ) -> String {
        JSONFixture.string([
            "v": 1,
            "kind": "response",
            "replyTo": replyTo,
            "type": type,
            "payload": payload,
        ])
    }

    private static func cardSummary(
        _ id: String,
        kind: String = "note",
        title: String = "測試卡片"
    ) -> [String: Any] {
        [
            "cardId": id,
            "kind": kind,
            "title": title,
            "tags": ["測試"],
            "persona": "default",
            "createdAt": "2026-11-15T00:00:00Z",
            "freshness": 100,
            "lifecycle": "live",
        ]
    }

    private static func card(_ id: String, revision: String = "rev_1") -> [String: Any] {
        var value = cardSummary(id)
        value["body"] = "內文"
        value["sources"] = ["sess_1"]
        value["links"] = ["outgoing": ["card_2"], "backlinks": ["card_0"]]
        value["revision"] = revision
        return value
    }

    private static func contextView(sessionId: String) -> [String: Any] {
        [
            "sessionId": sessionId,
            "version": 3,
            "entries": [
                [
                    "entryId": "entry_1",
                    "layer": "persona",
                    "cardId": "card_1",
                    "title": "人格卡",
                    "tokenEstimate": 120,
                    "state": "active",
                    "position": 0,
                ],
                [
                    "entryId": "entry_2",
                    "layer": "working-context",
                    "title": "逐字稿",
                    "tokenEstimate": 300,
                    "state": "pending-removal",
                    "position": 1,
                ],
            ],
            "usedTokens": 420,
            "budgetTokens": 1000,
            "contextWindow": 200_000,
            "compactionThreshold": 0.75,
        ]
    }
}
