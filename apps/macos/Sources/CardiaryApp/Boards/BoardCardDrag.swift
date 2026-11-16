import CoreTransferable
import Foundation
import UniformTypeIdentifiers

extension UTType {
    /// 卡片庫拖到白板時使用的型別；只帶卡片識別碼，不帶卡片內容。
    static let cardiaryBoardCard = UTType(exportedAs: "com.cardiary.board-card")
}

/// 從卡片庫拖到白板的一張卡。白板收到後再向主機投影，拖曳過程不傳內容。
public struct BoardCardDrag: Codable, Transferable, Sendable {
    public let cardId: String

    public init(cardId: String) {
        self.cardId = cardId
    }

    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .cardiaryBoardCard)
    }
}
