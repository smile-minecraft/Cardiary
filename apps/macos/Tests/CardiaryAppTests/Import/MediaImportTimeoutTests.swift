import CardiaryKit
import CardiaryShellCore
import Foundation
import XCTest

@testable import CardiaryApp

/// 拖放匯入要等主機的同步辨識完成，從拖放到卡片出現在清單都算同一次等待。
///
/// 實機回報殼端 OCR 花了約 31 秒；客戶端如果沿用一般請求的 10 秒期限，
/// 畫面會顯示「匯入失敗：主機服務沒有在期限內回應。」，但卡片其實已經建立。
@MainActor
final class MediaImportTimeoutTests: XCTestCase {
    /// 比實機回報的 30,967 ms 多一點，確保超過一般請求的 10 秒期限。
    private static let slowOCRSeconds: TimeInterval = 35

    func testSlowShellOCRStillPutsTheCardInTheLibrary() async throws {
        let pngURL = try makeDroppedPNG()
        defer { try? FileManager.default.removeItem(at: pngURL) }

        let harness = try await RealHostService.start(folderPrefix: "cardiary-media-timeout") {
            route,
            _ in
            guard route == "broker.recognition.ocr" else {
                return .unavailable("這個測試只模擬 OCR")
            }
            try? await Task.sleep(for: .seconds(Self.slowOCRSeconds))
            return .ok(.object([
                "available": .bool(true),
                "text": .string("慢速辨識的文字"),
                "locale": .string("zh-Hant"),
            ]))
        }
        defer {
            harness.supervisor.stopImmediately()
            Task { await harness.client.stop() }
        }

        let model = makeModel(harness: harness)
        await model.reload()
        XCTAssertNil(model.errorMessage)

        let startedAt = Date()
        await model.importDropped(urls: [pngURL])
        let elapsed = Date().timeIntervalSince(startedAt)

        XCTAssertGreaterThanOrEqual(elapsed, Self.slowOCRSeconds - 1, "拖放要等慢速 OCR 真的回完")
        XCTAssertNil(model.errorMessage, "慢速 OCR 不能顯示匯入失敗")
        XCTAssertFalse(model.isImporting)
        XCTAssertEqual(
            model.noticeMessage,
            CardL10n.format(.cardsImportCreated, value: pngURL.lastPathComponent)
        )

        let selectedId = try XCTUnwrap(model.selectedCardId, "匯入後要選取新建的卡")
        XCTAssertTrue(model.items.contains { $0.id == selectedId }, "新建的卡要出現在清單")
        let card = try XCTUnwrap(model.selectedCard)
        XCTAssertEqual(card.kind, .image)
        XCTAssertTrue(card.body.contains("慢速辨識的文字"), "卡片內文要用 OCR 的文字替身")
        let thumbnail = try XCTUnwrap(model.selectedImageData, "圖片卡要載入縮圖")
        XCTAssertEqual(Array(thumbnail.prefix(3)), [0xFF, 0xD8, 0xFF], "縮圖要是主機產生的 JPEG")
    }

    func testFastShellOCRStillImports() async throws {
        let pngURL = try makeDroppedPNG()
        defer { try? FileManager.default.removeItem(at: pngURL) }

        let harness = try await RealHostService.start(folderPrefix: "cardiary-media-fast") { route, _ in
            guard route == "broker.recognition.ocr" else {
                return .unavailable("這個測試只模擬 OCR")
            }
            return .ok(.object([
                "available": .bool(true),
                "text": .string("快速辨識的文字"),
                "locale": .string("zh-Hant"),
            ]))
        }
        defer {
            harness.supervisor.stopImmediately()
            Task { await harness.client.stop() }
        }

        let model = makeModel(harness: harness)
        await model.reload()
        await model.importDropped(urls: [pngURL])

        XCTAssertNil(model.errorMessage)
        let card = try XCTUnwrap(model.selectedCard)
        XCTAssertTrue(card.body.contains("快速辨識的文字"))
        XCTAssertEqual(
            model.noticeMessage,
            CardL10n.format(.cardsImportCreated, value: pngURL.lastPathComponent)
        )
    }

    /// 沒有殼端 OCR 時（獨立模式，或殼端回報不可用），匯入還是要建立卡片，
    /// 只是內文是沒有辨識結果的替身。
    func testImportWithoutShellOCRStillCreatesTheCard() async throws {
        let pngURL = try makeDroppedPNG()
        defer { try? FileManager.default.removeItem(at: pngURL) }

        let harness = try await RealHostService.start(folderPrefix: "cardiary-media-no-shell") { _, _ in
            .unavailable("這個測試沒有殼端 OCR")
        }
        defer {
            harness.supervisor.stopImmediately()
            Task { await harness.client.stop() }
        }

        let model = makeModel(harness: harness)
        await model.reload()
        await model.importDropped(urls: [pngURL])

        XCTAssertNil(model.errorMessage)
        let card = try XCTUnwrap(model.selectedCard)
        XCTAssertEqual(card.kind, .image)
        XCTAssertTrue(card.body.contains("本機OCR不可用"), "沒有 OCR 時要標明缺少本機辨識")
        XCTAssertTrue(card.body.contains("缺少的部分"))
        let selectedId = try XCTUnwrap(model.selectedCardId)
        XCTAssertTrue(model.items.contains { $0.id == selectedId })
    }

    private func makeModel(harness: RealHostService.Harness) -> CardLibraryModel {
        let media = CardiaryMediaService(blobs: harness.blobs, importer: harness.client)
        let model = CardLibraryModel(
            freshness: CardFreshnessStore(),
            mediaProvider: { media }
        )
        model.attach(service: harness.client)
        return model
    }

    private func makeDroppedPNG() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("慢速 OCR-\(UUID().uuidString).png")
        try Self.pngBytes.write(to: url)
        return url
    }

    /// 8×8 的實心 PNG；主機要用 sharp 產生縮圖，位元組必須真的解碼得開。
    private static let pngBytes = Data(
        base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWM4EaCBFTEMLQkAaplQAdEjY8UAAAAASUVORK5CYII="
    )!
}
