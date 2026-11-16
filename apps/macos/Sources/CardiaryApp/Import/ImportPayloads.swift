import CardiaryKit
import Foundation

/// 匯入的線路型別；對應主機的 `module.import.*` 回應。
///
/// 回應固定包在 `ModuleResponsePayload.data` 裡，`ModuleImportService` 負責
/// 拆一層。時間欄位照協定是 RFC 3339 字串，介面要顯示時才轉成 `Date`。

/// 匯入來源種類。
public enum ImportSourceKind: String, CaseIterable, Codable, Sendable {
    case generic
    case hermes
    case alma
    case codex
    case claudeCode = "claude-code"
}

/// 六類中介格式。
public enum ImportCategory: String, CaseIterable, Codable, Sendable {
    case persona
    case user
    case memory
    case rule
    case skill
    case conversation
}

/// 資料從哪個工具、哪個檔案來。
public struct ImportItemSource: Codable, Equatable, Sendable {
    public let tool: String
    public let path: String
}

/// 一個來源的可用性；`module.import.sources` 用。
public struct ImportSourceAvailability: Codable, Identifiable, Equatable, Sendable {
    public var id: ImportSourceKind { kind }
    public let kind: ImportSourceKind
    public let name: String
    public let available: Bool
    public let path: String
    public let detail: String
    /// 沒有在真實安裝上驗證過的部分；介面要標明。
    public let unverified: String?
}

/// 通用來源的一個檔案；讓使用者逐檔指定類別。
public struct ImportFileEntry: Codable, Identifiable, Equatable, Sendable {
    public var id: String { relativePath }
    public let relativePath: String
    public let name: String
    public let sizeBytes: Int
    public let modifiedAt: String?
    public let supported: Bool
}

/// `module.import.list` 的回應。
public struct ImportFileListing: Codable, Equatable, Sendable {
    public let files: [ImportFileEntry]
    public let truncated: Bool
}

/// 預覽的一項；`duplicateCardId` 有值代表這次不會建立新卡。
public struct ImportPreviewItem: Codable, Identifiable, Equatable, Sendable {
    public var id: String { key }
    public let key: String
    public let category: ImportCategory
    public let title: String
    public let body: String
    public let summary: String?
    public let tags: [String]
    public let createdAt: String?
    public let contentHash: String
    public let source: ImportItemSource
    /// 來源的 importance；Alma 是 0 到 1 的小數。
    public let importance: Double?
    public let duplicateCardId: String?
    public var origin: String? = nil
}

/// 預覽的一個技能。
public struct ImportPreviewSkill: Codable, Identifiable, Equatable, Sendable {
    public var id: String { key }
    public let key: String
    public let name: String
    public let description: String
    public let slug: String
    public let contentHash: String
    public let source: ImportItemSource
    public let attachmentsNotCopied: Int
    public let existingSkillPath: String?
}

/// 一段可以匯入的對話。
public struct ImportConversation: Codable, Identifiable, Equatable, Sendable {
    public var id: String { key }
    public let key: String
    public let title: String
    public let createdAt: String
    public let updatedAt: String?
    public let messageCount: Int
    public let characterCount: Int
    public let existingSummary: String?
    public let contentHash: String
    public let source: ImportItemSource
    public let unverified: Bool?
}

/// 跳過的來源項目。
public struct ImportSkippedItem: Codable, Equatable, Sendable {
    public let path: String
    public let reason: String
    public let detail: String?
    public let count: Int?
}

/// 來源的一項觀察；不是卡片，也不含機密值。
public struct ImportNote: Codable, Equatable, Sendable {
    public let path: String
    public let detail: String
    public let count: Int?
}

/// 對話匯入的預估用量。
public struct ImportConversationEstimate: Codable, Equatable, Sendable {
    public let candidates: Int
    public let messages: Int
    public let characters: Int
    public let existingSummaries: Int
    public let modelSummaries: Int
    public let estimatedModelInputTokens: Int
    public let estimatedModelCalls: Int
    public let rangeStart: String
    public let rangeEnd: String
}

/// `module.import.preview` 的回應。
public struct ImportPreview: Codable, Equatable, Sendable {
    public struct Source: Codable, Equatable, Sendable {
        public let kind: ImportSourceKind
        public let path: String
        public let tool: String
        public let version: String?
    }

    public let jobId: String
    public let source: Source
    public let items: [ImportPreviewItem]
    public let skills: [ImportPreviewSkill]
    public let conversations: [ImportConversation]
    public let skipped: [ImportSkippedItem]
    public let notes: [ImportNote]
    public let warnings: [String]
    public let conversationEstimate: ImportConversationEstimate?
    public let newCards: Int
    public let duplicates: Int
}

/// 寫入的一項結果。
public struct ImportWrittenItem: Codable, Equatable, Sendable {
    public let key: String
    public let category: ImportCategory
    public let status: String
    public let cardId: String?
    public let skillPath: String?
    public let reason: String?
    public let duplicateCardId: String?
}

/// `module.import.write` 的回應。
public struct ImportWriteResult: Codable, Equatable, Sendable {
    public let jobId: String
    public let status: String
    public let cardsCreated: Int
    public let skillsCopied: Int
    public let duplicates: Int
    public let failed: Int
    public let skipped: [ImportSkippedItem]
    public let results: [ImportWrittenItem]
    public let coreMemoryCandidates: [String]
    public let conversationEstimate: ImportConversationEstimate?
    public let warnings: [String]
}

/// `module.import.progress` 事件；主機每寫完一項送一次。
public struct ImportProgress: Codable, Equatable, Sendable {
    public let jobId: String
    public let done: Int
    public let total: Int
    public let status: String
    public let category: ImportCategory?
    public let reason: String?
}

/// 預覽請求；`categories` 只在通用來源使用。
public struct ImportPreviewRequest: Codable, Equatable, Sendable {
    public struct Persona: Codable, Equatable, Sendable {
        public let title: String
        public let body: String

        public init(title: String, body: String) {
            self.title = title
            self.body = body
        }
    }

    public let sourceKind: ImportSourceKind
    public let sourcePath: String?
    public let categories: [String: ImportCategory]?
    public let defaultCategory: ImportCategory?
    public let includeConversations: Bool?
    public let rangeStart: String?
    public let rangeEnd: String?
    public let providedPersona: Persona?

    public init(
        sourceKind: ImportSourceKind,
        sourcePath: String? = nil,
        categories: [String: ImportCategory]? = nil,
        defaultCategory: ImportCategory? = nil,
        includeConversations: Bool? = nil,
        rangeStart: String? = nil,
        rangeEnd: String? = nil,
        providedPersona: Persona? = nil
    ) {
        self.sourceKind = sourceKind
        self.sourcePath = sourcePath
        self.categories = categories
        self.defaultCategory = defaultCategory
        self.includeConversations = includeConversations
        self.rangeStart = rangeStart
        self.rangeEnd = rangeEnd
        self.providedPersona = providedPersona
    }
}

/// 寫入請求。
public struct ImportWriteRequest: Codable, Equatable, Sendable {
    public let jobId: String
    public let itemKeys: [String]
    public let coreMemoryItemKeys: [String]?
    public let reimport: Bool?

    public init(
        jobId: String,
        itemKeys: [String],
        coreMemoryItemKeys: [String]? = nil,
        reimport: Bool? = nil
    ) {
        self.jobId = jobId
        self.itemKeys = itemKeys
        self.coreMemoryItemKeys = coreMemoryItemKeys
        self.reimport = reimport
    }
}

/// 介面顯示的固定順序；與主機的 `IMPORT_CATEGORY_ORDER` 一致。
public enum ImportCategoryOrder {
    public static let all: [ImportCategory] = [
        .persona, .user, .memory, .rule, .skill, .conversation,
    ]
}

/// RFC 3339 字串轉 `Date`；沒有小數秒的格式也接受。
public enum ImportTimestamp {
    public static func date(from text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }

    public static func string(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
