// 這個檔案由 packages/protocol/schema/protocol.schema.json 產生，不要手改。
// 重新產生：pnpm --filter @cardiary/protocol generate
//
// JSONValue 與 JSONObject 由同一個 target 的 JSONValue.swift 提供。

import Foundation

// MARK: - ApprovalDecideRequest

public struct ApprovalDecideRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: ApprovalDecideRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "approval.decide",
        payload: ApprovalDecideRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ApprovalDecideRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ApprovalDecideRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "approval.decide" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ApprovalDecideRequest.type 必須是 approval.decide")
        }
        let payload = try container.decode(ApprovalDecideRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - ApprovalDecideRequestPayload

public struct ApprovalDecideRequestPayload: Codable, Equatable, Sendable {
    public let approvalId: String
    public let optionId: String
    public let note: String?

    public init(
        approvalId: String,
        optionId: String,
        note: String? = nil
    ) {
        self.approvalId = approvalId
        self.optionId = optionId
        self.note = note
    }

    private enum CodingKeys: String, CodingKey {
        case approvalId = "approvalId"
        case optionId = "optionId"
        case note = "note"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let approvalId = try container.decode(String.self, forKey: .approvalId)
        let optionId = try container.decode(String.self, forKey: .optionId)
        let note = try container.decodeIfPresent(String.self, forKey: .note)
        self.init(
            approvalId: approvalId,
            optionId: optionId,
            note: note
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(approvalId, forKey: .approvalId)
        try container.encode(optionId, forKey: .optionId)
        try container.encodeIfPresent(note, forKey: .note)
    }
}

// MARK: - ApprovalDecideResponse

public struct ApprovalDecideResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: ApprovalDecideResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "approval.decide",
        payload: ApprovalDecideResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ApprovalDecideResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ApprovalDecideResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "approval.decide" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ApprovalDecideResponse.type 必須是 approval.decide")
        }
        let payload = try container.decode(ApprovalDecideResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - ApprovalDecideResponsePayload

public struct ApprovalDecideResponsePayload: Codable, Equatable, Sendable {
    public let approvalId: String
    public let effect: ApprovalEffect
    public let decidedAt: String
    public let persisted: Bool

    public init(
        approvalId: String,
        effect: ApprovalEffect,
        decidedAt: String,
        persisted: Bool
    ) {
        self.approvalId = approvalId
        self.effect = effect
        self.decidedAt = decidedAt
        self.persisted = persisted
    }

    private enum CodingKeys: String, CodingKey {
        case approvalId = "approvalId"
        case effect = "effect"
        case decidedAt = "decidedAt"
        case persisted = "persisted"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let approvalId = try container.decode(String.self, forKey: .approvalId)
        let effect = try container.decode(ApprovalEffect.self, forKey: .effect)
        let decidedAt = try container.decode(String.self, forKey: .decidedAt)
        let persisted = try container.decode(Bool.self, forKey: .persisted)
        self.init(
            approvalId: approvalId,
            effect: effect,
            decidedAt: decidedAt,
            persisted: persisted
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(approvalId, forKey: .approvalId)
        try container.encode(effect, forKey: .effect)
        try container.encode(decidedAt, forKey: .decidedAt)
        try container.encode(persisted, forKey: .persisted)
    }
}

// MARK: - ApprovalDecidedEvent

public struct ApprovalDecidedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: ApprovalDecidedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "approval.decided",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: ApprovalDecidedEventPayload
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ApprovalDecidedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ApprovalDecidedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "approval.decided" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ApprovalDecidedEvent.type 必須是 approval.decided")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(ApprovalDecidedEventPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - ApprovalDecidedEventPayload

public struct ApprovalDecidedEventPayload: Codable, Equatable, Sendable {
    public let approvalId: String
    public let sessionId: String
    public let effect: ApprovalEffect
    public let decidedAt: String
    public let decidedBy: DecidedBy

    public init(
        approvalId: String,
        sessionId: String,
        effect: ApprovalEffect,
        decidedAt: String,
        decidedBy: DecidedBy
    ) {
        self.approvalId = approvalId
        self.sessionId = sessionId
        self.effect = effect
        self.decidedAt = decidedAt
        self.decidedBy = decidedBy
    }

    private enum CodingKeys: String, CodingKey {
        case approvalId = "approvalId"
        case sessionId = "sessionId"
        case effect = "effect"
        case decidedAt = "decidedAt"
        case decidedBy = "decidedBy"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let approvalId = try container.decode(String.self, forKey: .approvalId)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let effect = try container.decode(ApprovalEffect.self, forKey: .effect)
        let decidedAt = try container.decode(String.self, forKey: .decidedAt)
        let decidedBy = try container.decode(DecidedBy.self, forKey: .decidedBy)
        self.init(
            approvalId: approvalId,
            sessionId: sessionId,
            effect: effect,
            decidedAt: decidedAt,
            decidedBy: decidedBy
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(approvalId, forKey: .approvalId)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(effect, forKey: .effect)
        try container.encode(decidedAt, forKey: .decidedAt)
        try container.encode(decidedBy, forKey: .decidedBy)
    }
}

// MARK: - ApprovalEffect

public enum ApprovalEffect: String, Codable, Equatable, Sendable, CaseIterable {
    case approve = "approve"
    case reject = "reject"
    case approveAlways = "approve_always"
}

// MARK: - ApprovalOption

public struct ApprovalOption: Codable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let effect: ApprovalEffect

    public init(
        id: String,
        label: String,
        effect: ApprovalEffect
    ) {
        self.id = id
        self.label = label
        self.effect = effect
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case label = "label"
        case effect = "effect"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let label = try container.decode(String.self, forKey: .label)
        let effect = try container.decode(ApprovalEffect.self, forKey: .effect)
        self.init(
            id: id,
            label: label,
            effect: effect
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(label, forKey: .label)
        try container.encode(effect, forKey: .effect)
    }
}

// MARK: - ApprovalPauseAllRequest

public struct ApprovalPauseAllRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: ApprovalPauseAllRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "approval.pause_all",
        payload: ApprovalPauseAllRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ApprovalPauseAllRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ApprovalPauseAllRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "approval.pause_all" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ApprovalPauseAllRequest.type 必須是 approval.pause_all")
        }
        let payload = try container.decode(ApprovalPauseAllRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - ApprovalPauseAllRequestPayload

public struct ApprovalPauseAllRequestPayload: Codable, Equatable, Sendable {
    public let reason: String?

    public init(
        reason: String? = nil
    ) {
        self.reason = reason
    }

    private enum CodingKeys: String, CodingKey {
        case reason = "reason"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let reason = try container.decodeIfPresent(String.self, forKey: .reason)
        self.init(
            reason: reason
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(reason, forKey: .reason)
    }
}

// MARK: - ApprovalPauseAllResponse

public struct ApprovalPauseAllResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: ApprovalPauseAllResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "approval.pause_all",
        payload: ApprovalPauseAllResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ApprovalPauseAllResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ApprovalPauseAllResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "approval.pause_all" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ApprovalPauseAllResponse.type 必須是 approval.pause_all")
        }
        let payload = try container.decode(ApprovalPauseAllResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - ApprovalPauseAllResponsePayload

public struct ApprovalPauseAllResponsePayload: Codable, Equatable, Sendable {
    public let pausedAt: String
    public let interruptedSessionIds: [String]

    public init(
        pausedAt: String,
        interruptedSessionIds: [String]
    ) {
        self.pausedAt = pausedAt
        self.interruptedSessionIds = interruptedSessionIds
    }

    private enum CodingKeys: String, CodingKey {
        case pausedAt = "pausedAt"
        case interruptedSessionIds = "interruptedSessionIds"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let pausedAt = try container.decode(String.self, forKey: .pausedAt)
        let interruptedSessionIds = try container.decode([String].self, forKey: .interruptedSessionIds)
        self.init(
            pausedAt: pausedAt,
            interruptedSessionIds: interruptedSessionIds
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pausedAt, forKey: .pausedAt)
        try container.encode(interruptedSessionIds, forKey: .interruptedSessionIds)
    }
}

// MARK: - ApprovalRequest

public struct ApprovalRequest: Codable, Equatable, Sendable {
    public let approvalId: String
    public let sessionId: String
    public let turnId: String
    public let toolCallId: String?
    public let title: String
    public let summary: String?
    public let scope: ApprovalScope
    public let options: [ApprovalOption]
    public let requestedAt: String
    public let expiresAt: String?

    public init(
        approvalId: String,
        sessionId: String,
        turnId: String,
        toolCallId: String? = nil,
        title: String,
        summary: String? = nil,
        scope: ApprovalScope,
        options: [ApprovalOption],
        requestedAt: String,
        expiresAt: String? = nil
    ) {
        self.approvalId = approvalId
        self.sessionId = sessionId
        self.turnId = turnId
        self.toolCallId = toolCallId
        self.title = title
        self.summary = summary
        self.scope = scope
        self.options = options
        self.requestedAt = requestedAt
        self.expiresAt = expiresAt
    }

    private enum CodingKeys: String, CodingKey {
        case approvalId = "approvalId"
        case sessionId = "sessionId"
        case turnId = "turnId"
        case toolCallId = "toolCallId"
        case title = "title"
        case summary = "summary"
        case scope = "scope"
        case options = "options"
        case requestedAt = "requestedAt"
        case expiresAt = "expiresAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let approvalId = try container.decode(String.self, forKey: .approvalId)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let toolCallId = try container.decodeIfPresent(String.self, forKey: .toolCallId)
        let title = try container.decode(String.self, forKey: .title)
        let summary = try container.decodeIfPresent(String.self, forKey: .summary)
        let scope = try container.decode(ApprovalScope.self, forKey: .scope)
        let options = try container.decode([ApprovalOption].self, forKey: .options)
        let requestedAt = try container.decode(String.self, forKey: .requestedAt)
        let expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
        self.init(
            approvalId: approvalId,
            sessionId: sessionId,
            turnId: turnId,
            toolCallId: toolCallId,
            title: title,
            summary: summary,
            scope: scope,
            options: options,
            requestedAt: requestedAt,
            expiresAt: expiresAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(approvalId, forKey: .approvalId)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(turnId, forKey: .turnId)
        try container.encodeIfPresent(toolCallId, forKey: .toolCallId)
        try container.encode(title, forKey: .title)
        try container.encodeIfPresent(summary, forKey: .summary)
        try container.encode(scope, forKey: .scope)
        try container.encode(options, forKey: .options)
        try container.encode(requestedAt, forKey: .requestedAt)
        try container.encodeIfPresent(expiresAt, forKey: .expiresAt)
    }
}

// MARK: - ApprovalRequestedEvent

public struct ApprovalRequestedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: ApprovalRequest

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "approval.requested",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: ApprovalRequest
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ApprovalRequestedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ApprovalRequestedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "approval.requested" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ApprovalRequestedEvent.type 必須是 approval.requested")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(ApprovalRequest.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - ApprovalScope

public struct ApprovalScope: Codable, Equatable, Sendable {
    public let kind: ApprovalScopeKind
    public let target: String
    public let detail: JSONValue?

    public init(
        kind: ApprovalScopeKind,
        target: String,
        detail: JSONValue? = nil
    ) {
        self.kind = kind
        self.target = target
        self.detail = detail
    }

    private enum CodingKeys: String, CodingKey {
        case kind = "kind"
        case target = "target"
        case detail = "detail"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(ApprovalScopeKind.self, forKey: .kind)
        let target = try container.decode(String.self, forKey: .target)
        let detail = try container.decodeIfPresent(JSONValue.self, forKey: .detail)
        self.init(
            kind: kind,
            target: target,
            detail: detail
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(target, forKey: .target)
        try container.encodeIfPresent(detail, forKey: .detail)
    }
}

// MARK: - ApprovalScopeKind

public enum ApprovalScopeKind: String, Codable, Equatable, Sendable, CaseIterable {
    case toolCall = "tool_call"
    case settingsChange = "settings_change"
    case schedule = "schedule"
}

// MARK: - AssistantTranscriptEntry

public struct AssistantTranscriptEntry: Codable, Equatable, Sendable {
    public let id: String
    public let role: String
    public let turnId: String
    public let createdAt: String
    public let text: String
    public let status: MessageStatus

    public init(
        id: String,
        role: String = "assistant",
        turnId: String,
        createdAt: String,
        text: String,
        status: MessageStatus
    ) {
        self.id = id
        self.role = role
        self.turnId = turnId
        self.createdAt = createdAt
        self.text = text
        self.status = status
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case role = "role"
        case turnId = "turnId"
        case createdAt = "createdAt"
        case text = "text"
        case status = "status"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let role = try container.decode(String.self, forKey: .role)
        guard role == "assistant" else {
            throw DecodingError.dataCorruptedError(forKey: .role, in: container, debugDescription: "AssistantTranscriptEntry.role 必須是 assistant")
        }
        let turnId = try container.decode(String.self, forKey: .turnId)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let text = try container.decode(String.self, forKey: .text)
        let status = try container.decode(MessageStatus.self, forKey: .status)
        self.init(
            id: id,
            role: role,
            turnId: turnId,
            createdAt: createdAt,
            text: text,
            status: status
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(role, forKey: .role)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(text, forKey: .text)
        try container.encode(status, forKey: .status)
    }
}

// MARK: - ClientFrame

public enum ClientFrame: Codable, Equatable, Sendable {
    case systemHelloRequest(SystemHelloRequest)
    case systemSubscribeRequest(SystemSubscribeRequest)
    case systemUnsubscribeRequest(SystemUnsubscribeRequest)
    case sessionCreateRequest(SessionCreateRequest)
    case sessionListRequest(SessionListRequest)
    case sessionSendMessageRequest(SessionSendMessageRequest)
    case sessionInterruptRequest(SessionInterruptRequest)
    case sessionSubscribeRequest(SessionSubscribeRequest)
    case sessionUnsubscribeRequest(SessionUnsubscribeRequest)
    case sessionGetHistoryRequest(SessionGetHistoryRequest)
    case approvalDecideRequest(ApprovalDecideRequest)
    case approvalPauseAllRequest(ApprovalPauseAllRequest)
    case moduleRequest(ModuleRequest)

    private enum DiscriminatorKeys: String, CodingKey {
        case type
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DiscriminatorKeys.self)
        let type = try container.decodeIfPresent(String.self, forKey: .type)
        switch type {
        case .some("system.hello"):
            self = .systemHelloRequest(try SystemHelloRequest(from: decoder))
        case .some("system.subscribe"):
            self = .systemSubscribeRequest(try SystemSubscribeRequest(from: decoder))
        case .some("system.unsubscribe"):
            self = .systemUnsubscribeRequest(try SystemUnsubscribeRequest(from: decoder))
        case .some("session.create"):
            self = .sessionCreateRequest(try SessionCreateRequest(from: decoder))
        case .some("session.list"):
            self = .sessionListRequest(try SessionListRequest(from: decoder))
        case .some("session.send_message"):
            self = .sessionSendMessageRequest(try SessionSendMessageRequest(from: decoder))
        case .some("session.interrupt"):
            self = .sessionInterruptRequest(try SessionInterruptRequest(from: decoder))
        case .some("session.subscribe"):
            self = .sessionSubscribeRequest(try SessionSubscribeRequest(from: decoder))
        case .some("session.unsubscribe"):
            self = .sessionUnsubscribeRequest(try SessionUnsubscribeRequest(from: decoder))
        case .some("session.get_history"):
            self = .sessionGetHistoryRequest(try SessionGetHistoryRequest(from: decoder))
        case .some("approval.decide"):
            self = .approvalDecideRequest(try ApprovalDecideRequest(from: decoder))
        case .some("approval.pause_all"):
            self = .approvalPauseAllRequest(try ApprovalPauseAllRequest(from: decoder))
        case .some(let value0) where value0.hasPrefix("module."):
            self = .moduleRequest(try ModuleRequest(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "不支援的 ClientFrame 判別組合：type=\(type ?? "nil")")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .systemHelloRequest(let value):
            try value.encode(to: encoder)
        case .systemSubscribeRequest(let value):
            try value.encode(to: encoder)
        case .systemUnsubscribeRequest(let value):
            try value.encode(to: encoder)
        case .sessionCreateRequest(let value):
            try value.encode(to: encoder)
        case .sessionListRequest(let value):
            try value.encode(to: encoder)
        case .sessionSendMessageRequest(let value):
            try value.encode(to: encoder)
        case .sessionInterruptRequest(let value):
            try value.encode(to: encoder)
        case .sessionSubscribeRequest(let value):
            try value.encode(to: encoder)
        case .sessionUnsubscribeRequest(let value):
            try value.encode(to: encoder)
        case .sessionGetHistoryRequest(let value):
            try value.encode(to: encoder)
        case .approvalDecideRequest(let value):
            try value.encode(to: encoder)
        case .approvalPauseAllRequest(let value):
            try value.encode(to: encoder)
        case .moduleRequest(let value):
            try value.encode(to: encoder)
        }
    }
}

// MARK: - ClientInfo

public struct ClientInfo: Codable, Equatable, Sendable {
    public let name: String
    public let version: String
    public let platform: ClientPlatform
    public let instanceId: String

    public init(
        name: String,
        version: String,
        platform: ClientPlatform,
        instanceId: String
    ) {
        self.name = name
        self.version = version
        self.platform = platform
        self.instanceId = instanceId
    }

    private enum CodingKeys: String, CodingKey {
        case name = "name"
        case version = "version"
        case platform = "platform"
        case instanceId = "instanceId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let name = try container.decode(String.self, forKey: .name)
        let version = try container.decode(String.self, forKey: .version)
        let platform = try container.decode(ClientPlatform.self, forKey: .platform)
        let instanceId = try container.decode(String.self, forKey: .instanceId)
        self.init(
            name: name,
            version: version,
            platform: platform,
            instanceId: instanceId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(version, forKey: .version)
        try container.encode(platform, forKey: .platform)
        try container.encode(instanceId, forKey: .instanceId)
    }
}

// MARK: - ClientPlatform

public enum ClientPlatform: String, Codable, Equatable, Sendable, CaseIterable {
    case macos = "macos"
    case ios = "ios"
    case ipados = "ipados"
    case web = "web"
    case other = "other"
}

// MARK: - DecidedBy

public struct DecidedBy: Codable, Equatable, Sendable {
    public let kind: DeciderKind
    public let clientId: String?

    public init(
        kind: DeciderKind,
        clientId: String? = nil
    ) {
        self.kind = kind
        self.clientId = clientId
    }

    private enum CodingKeys: String, CodingKey {
        case kind = "kind"
        case clientId = "clientId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(DeciderKind.self, forKey: .kind)
        let clientId = try container.decodeIfPresent(String.self, forKey: .clientId)
        self.init(
            kind: kind,
            clientId: clientId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encodeIfPresent(clientId, forKey: .clientId)
    }
}

// MARK: - DeciderKind

public enum DeciderKind: String, Codable, Equatable, Sendable, CaseIterable {
    case client = "client"
    case system = "system"
}

// MARK: - DeliveryMode

public enum DeliveryMode: String, Codable, Equatable, Sendable, CaseIterable {
    case queue = "queue"
    case interrupt = "interrupt"
}

// MARK: - EmptyPayload

public struct EmptyPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - ErrorCode

public enum ErrorCode: String, Codable, Equatable, Sendable, CaseIterable {
    case authInvalid = "auth_invalid"
    case authExpired = "auth_expired"
    case notAuthenticated = "not_authenticated"
    case incompatibleVersion = "incompatible_version"
    case invalidMessage = "invalid_message"
    case payloadTooLarge = "payload_too_large"
    case notFound = "not_found"
    case conflict = "conflict"
    case busy = "busy"
    case permissionDenied = "permission_denied"
    case rateLimited = "rate_limited"
    case unavailable = "unavailable"
    case `internal` = "internal"
    case cancelled = "cancelled"
    case unsupported = "unsupported"
}

// MARK: - ErrorFrame

public struct ErrorFrame: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String?
    public let code: ErrorCode
    public let message: String
    public let details: JSONObject?
    public let retryable: Bool

    public init(
        v: Int = 1,
        kind: String = "error",
        replyTo: String? = nil,
        code: ErrorCode,
        message: String,
        details: JSONObject? = nil,
        retryable: Bool
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.code = code
        self.message = message
        self.details = details
        self.retryable = retryable
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case code = "code"
        case message = "message"
        case details = "details"
        case retryable = "retryable"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ErrorFrame.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "error" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ErrorFrame.kind 必須是 error")
        }
        let replyTo = try container.decodeIfPresent(String.self, forKey: .replyTo)
        let code = try container.decode(ErrorCode.self, forKey: .code)
        let message = try container.decode(String.self, forKey: .message)
        let details = try container.decodeIfPresent(JSONObject.self, forKey: .details)
        let retryable = try container.decode(Bool.self, forKey: .retryable)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            code: code,
            message: message,
            details: details,
            retryable: retryable
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encodeIfPresent(replyTo, forKey: .replyTo)
        try container.encode(code, forKey: .code)
        try container.encode(message, forKey: .message)
        try container.encodeIfPresent(details, forKey: .details)
        try container.encode(retryable, forKey: .retryable)
    }
}

// MARK: - FolderState

public enum FolderState: String, Codable, Equatable, Sendable, CaseIterable {
    case ready = "ready"
    case notSelected = "not_selected"
    case unavailable = "unavailable"
}

// MARK: - FolderStatus

public struct FolderStatus: Codable, Equatable, Sendable {
    public let state: FolderState
    public let displayName: String
    public let writable: Bool
    public let reason: String?

    public init(
        state: FolderState,
        displayName: String,
        writable: Bool,
        reason: String? = nil
    ) {
        self.state = state
        self.displayName = displayName
        self.writable = writable
        self.reason = reason
    }

    private enum CodingKeys: String, CodingKey {
        case state = "state"
        case displayName = "displayName"
        case writable = "writable"
        case reason = "reason"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let state = try container.decode(FolderState.self, forKey: .state)
        let displayName = try container.decode(String.self, forKey: .displayName)
        let writable = try container.decode(Bool.self, forKey: .writable)
        let reason = try container.decodeIfPresent(String.self, forKey: .reason)
        self.init(
            state: state,
            displayName: displayName,
            writable: writable,
            reason: reason
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(state, forKey: .state)
        try container.encode(displayName, forKey: .displayName)
        try container.encode(writable, forKey: .writable)
        try container.encodeIfPresent(reason, forKey: .reason)
    }
}

// MARK: - HelloAuth

public struct HelloAuth: Codable, Equatable, Sendable {
    public let token: String

    public init(
        token: String
    ) {
        self.token = token
    }

    private enum CodingKeys: String, CodingKey {
        case token = "token"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let token = try container.decode(String.self, forKey: .token)
        self.init(
            token: token
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(token, forKey: .token)
    }
}

// MARK: - HelloResume

public struct HelloResume: Codable, Equatable, Sendable {
    public let systemSeq: Int?

    public init(
        systemSeq: Int? = nil
    ) {
        self.systemSeq = systemSeq
    }

    private enum CodingKeys: String, CodingKey {
        case systemSeq = "systemSeq"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let systemSeq = try container.decodeIfPresent(Int.self, forKey: .systemSeq)
        self.init(
            systemSeq: systemSeq
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(systemSeq, forKey: .systemSeq)
    }
}

// MARK: - MessageStatus

public enum MessageStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case streaming = "streaming"
    case complete = "complete"
    case interrupted = "interrupted"
    case failed = "failed"
}

// MARK: - ModuleEvent

public struct ModuleEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: ModuleEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String,
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: ModuleEventPayload
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ModuleEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ModuleEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(ModuleEventPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - ModuleEventPayload

public struct ModuleEventPayload: Codable, Equatable, Sendable {
    public let data: JSONObject
    public let schemaVersion: String?

    public init(
        data: JSONObject,
        schemaVersion: String? = nil
    ) {
        self.data = data
        self.schemaVersion = schemaVersion
    }

    private enum CodingKeys: String, CodingKey {
        case data = "data"
        case schemaVersion = "schemaVersion"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let data = try container.decode(JSONObject.self, forKey: .data)
        let schemaVersion = try container.decodeIfPresent(String.self, forKey: .schemaVersion)
        self.init(
            data: data,
            schemaVersion: schemaVersion
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(data, forKey: .data)
        try container.encodeIfPresent(schemaVersion, forKey: .schemaVersion)
    }
}

// MARK: - ModuleRequest

public struct ModuleRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: ModuleRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String,
        payload: ModuleRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ModuleRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ModuleRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        let payload = try container.decode(ModuleRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - ModuleRequestPayload

public struct ModuleRequestPayload: Codable, Equatable, Sendable {
    public let data: JSONObject

    public init(
        data: JSONObject
    ) {
        self.data = data
    }

    private enum CodingKeys: String, CodingKey {
        case data = "data"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let data = try container.decode(JSONObject.self, forKey: .data)
        self.init(
            data: data
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(data, forKey: .data)
    }
}

// MARK: - ModuleResponse

public struct ModuleResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: ModuleResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String,
        payload: ModuleResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ModuleResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ModuleResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        let payload = try container.decode(ModuleResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - ModuleResponsePayload

public struct ModuleResponsePayload: Codable, Equatable, Sendable {
    public let data: JSONObject

    public init(
        data: JSONObject
    ) {
        self.data = data
    }

    private enum CodingKeys: String, CodingKey {
        case data = "data"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let data = try container.decode(JSONObject.self, forKey: .data)
        self.init(
            data: data
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(data, forKey: .data)
    }
}

// MARK: - ProtocolInfo

public struct ProtocolInfo: Codable, Equatable, Sendable {
    public let version: Int
    public let min: Int
    public let max: Int

    public init(
        version: Int,
        min: Int,
        max: Int
    ) {
        self.version = version
        self.min = min
        self.max = max
    }

    private enum CodingKeys: String, CodingKey {
        case version = "version"
        case min = "min"
        case max = "max"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        let min = try container.decode(Int.self, forKey: .min)
        let max = try container.decode(Int.self, forKey: .max)
        self.init(
            version: version,
            min: min,
            max: max
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(min, forKey: .min)
        try container.encode(max, forKey: .max)
    }
}

// MARK: - ProtocolRange

public struct ProtocolRange: Codable, Equatable, Sendable {
    public let min: Int
    public let max: Int

    public init(
        min: Int,
        max: Int
    ) {
        self.min = min
        self.max = max
    }

    private enum CodingKeys: String, CodingKey {
        case min = "min"
        case max = "max"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let min = try container.decode(Int.self, forKey: .min)
        let max = try container.decode(Int.self, forKey: .max)
        self.init(
            min: min,
            max: max
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(min, forKey: .min)
        try container.encode(max, forKey: .max)
    }
}

// MARK: - SendMessageDisposition

public enum SendMessageDisposition: String, Codable, Equatable, Sendable, CaseIterable {
    case started = "started"
    case queued = "queued"
    case interruptedThenStarted = "interrupted_then_started"
}

// MARK: - ServerCapabilities

public struct ServerCapabilities: Codable, Equatable, Sendable {
    public let modules: Bool
    public let files: Bool

    public init(
        modules: Bool,
        files: Bool
    ) {
        self.modules = modules
        self.files = files
    }

    private enum CodingKeys: String, CodingKey {
        case modules = "modules"
        case files = "files"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let modules = try container.decode(Bool.self, forKey: .modules)
        let files = try container.decode(Bool.self, forKey: .files)
        self.init(
            modules: modules,
            files: files
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(modules, forKey: .modules)
        try container.encode(files, forKey: .files)
    }
}

// MARK: - ServerFrame

public enum ServerFrame: Codable, Equatable, Sendable {
    case systemHelloResponse(SystemHelloResponse)
    case systemSubscribeResponse(SystemSubscribeResponse)
    case systemUnsubscribeResponse(SystemUnsubscribeResponse)
    case systemStatusEvent(SystemStatusEvent)
    case sessionCreateResponse(SessionCreateResponse)
    case sessionListResponse(SessionListResponse)
    case sessionSendMessageResponse(SessionSendMessageResponse)
    case sessionInterruptResponse(SessionInterruptResponse)
    case sessionSubscribeResponse(SessionSubscribeResponse)
    case sessionUnsubscribeResponse(SessionUnsubscribeResponse)
    case sessionGetHistoryResponse(SessionGetHistoryResponse)
    case streamTurnStartedEvent(StreamTurnStartedEvent)
    case streamTextDeltaEvent(StreamTextDeltaEvent)
    case streamMessageCompletedEvent(StreamMessageCompletedEvent)
    case streamToolCallEvent(StreamToolCallEvent)
    case streamToolResultEvent(StreamToolResultEvent)
    case streamTurnStateEvent(StreamTurnStateEvent)
    case streamUiEvent(StreamUiEvent)
    case approvalRequestedEvent(ApprovalRequestedEvent)
    case approvalDecideResponse(ApprovalDecideResponse)
    case approvalDecidedEvent(ApprovalDecidedEvent)
    case approvalPauseAllResponse(ApprovalPauseAllResponse)
    case errorFrame(ErrorFrame)
    case moduleResponse(ModuleResponse)
    case moduleEvent(ModuleEvent)

    private enum DiscriminatorKeys: String, CodingKey {
        case kind
        case type
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DiscriminatorKeys.self)
        let kind = try container.decodeIfPresent(String.self, forKey: .kind)
        let type = try container.decodeIfPresent(String.self, forKey: .type)
        switch (kind, type) {
        case (.some("response"), .some("system.hello")):
            self = .systemHelloResponse(try SystemHelloResponse(from: decoder))
        case (.some("response"), .some("system.subscribe")):
            self = .systemSubscribeResponse(try SystemSubscribeResponse(from: decoder))
        case (.some("response"), .some("system.unsubscribe")):
            self = .systemUnsubscribeResponse(try SystemUnsubscribeResponse(from: decoder))
        case (.some("event"), .some("system.status")):
            self = .systemStatusEvent(try SystemStatusEvent(from: decoder))
        case (.some("response"), .some("session.create")):
            self = .sessionCreateResponse(try SessionCreateResponse(from: decoder))
        case (.some("response"), .some("session.list")):
            self = .sessionListResponse(try SessionListResponse(from: decoder))
        case (.some("response"), .some("session.send_message")):
            self = .sessionSendMessageResponse(try SessionSendMessageResponse(from: decoder))
        case (.some("response"), .some("session.interrupt")):
            self = .sessionInterruptResponse(try SessionInterruptResponse(from: decoder))
        case (.some("response"), .some("session.subscribe")):
            self = .sessionSubscribeResponse(try SessionSubscribeResponse(from: decoder))
        case (.some("response"), .some("session.unsubscribe")):
            self = .sessionUnsubscribeResponse(try SessionUnsubscribeResponse(from: decoder))
        case (.some("response"), .some("session.get_history")):
            self = .sessionGetHistoryResponse(try SessionGetHistoryResponse(from: decoder))
        case (.some("event"), .some("stream.turn_started")):
            self = .streamTurnStartedEvent(try StreamTurnStartedEvent(from: decoder))
        case (.some("event"), .some("stream.text_delta")):
            self = .streamTextDeltaEvent(try StreamTextDeltaEvent(from: decoder))
        case (.some("event"), .some("stream.message_completed")):
            self = .streamMessageCompletedEvent(try StreamMessageCompletedEvent(from: decoder))
        case (.some("event"), .some("stream.tool_call")):
            self = .streamToolCallEvent(try StreamToolCallEvent(from: decoder))
        case (.some("event"), .some("stream.tool_result")):
            self = .streamToolResultEvent(try StreamToolResultEvent(from: decoder))
        case (.some("event"), .some("stream.turn_state")):
            self = .streamTurnStateEvent(try StreamTurnStateEvent(from: decoder))
        case (.some("event"), .some("stream.ui")):
            self = .streamUiEvent(try StreamUiEvent(from: decoder))
        case (.some("event"), .some("approval.requested")):
            self = .approvalRequestedEvent(try ApprovalRequestedEvent(from: decoder))
        case (.some("response"), .some("approval.decide")):
            self = .approvalDecideResponse(try ApprovalDecideResponse(from: decoder))
        case (.some("event"), .some("approval.decided")):
            self = .approvalDecidedEvent(try ApprovalDecidedEvent(from: decoder))
        case (.some("response"), .some("approval.pause_all")):
            self = .approvalPauseAllResponse(try ApprovalPauseAllResponse(from: decoder))
        case (.some("error"), .none):
            self = .errorFrame(try ErrorFrame(from: decoder))
        case (.some("response"), .some(let value1)) where value1.hasPrefix("module."):
            self = .moduleResponse(try ModuleResponse(from: decoder))
        case (.some("event"), .some(let value1)) where value1.hasPrefix("module."):
            self = .moduleEvent(try ModuleEvent(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "不支援的 ServerFrame 判別組合：kind=\(kind ?? "nil"), type=\(type ?? "nil")")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .systemHelloResponse(let value):
            try value.encode(to: encoder)
        case .systemSubscribeResponse(let value):
            try value.encode(to: encoder)
        case .systemUnsubscribeResponse(let value):
            try value.encode(to: encoder)
        case .systemStatusEvent(let value):
            try value.encode(to: encoder)
        case .sessionCreateResponse(let value):
            try value.encode(to: encoder)
        case .sessionListResponse(let value):
            try value.encode(to: encoder)
        case .sessionSendMessageResponse(let value):
            try value.encode(to: encoder)
        case .sessionInterruptResponse(let value):
            try value.encode(to: encoder)
        case .sessionSubscribeResponse(let value):
            try value.encode(to: encoder)
        case .sessionUnsubscribeResponse(let value):
            try value.encode(to: encoder)
        case .sessionGetHistoryResponse(let value):
            try value.encode(to: encoder)
        case .streamTurnStartedEvent(let value):
            try value.encode(to: encoder)
        case .streamTextDeltaEvent(let value):
            try value.encode(to: encoder)
        case .streamMessageCompletedEvent(let value):
            try value.encode(to: encoder)
        case .streamToolCallEvent(let value):
            try value.encode(to: encoder)
        case .streamToolResultEvent(let value):
            try value.encode(to: encoder)
        case .streamTurnStateEvent(let value):
            try value.encode(to: encoder)
        case .streamUiEvent(let value):
            try value.encode(to: encoder)
        case .approvalRequestedEvent(let value):
            try value.encode(to: encoder)
        case .approvalDecideResponse(let value):
            try value.encode(to: encoder)
        case .approvalDecidedEvent(let value):
            try value.encode(to: encoder)
        case .approvalPauseAllResponse(let value):
            try value.encode(to: encoder)
        case .errorFrame(let value):
            try value.encode(to: encoder)
        case .moduleResponse(let value):
            try value.encode(to: encoder)
        case .moduleEvent(let value):
            try value.encode(to: encoder)
        }
    }
}

// MARK: - ServerInfo

public struct ServerInfo: Codable, Equatable, Sendable {
    public let name: String
    public let version: String

    public init(
        name: String,
        version: String
    ) {
        self.name = name
        self.version = version
    }

    private enum CodingKeys: String, CodingKey {
        case name = "name"
        case version = "version"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let name = try container.decode(String.self, forKey: .name)
        let version = try container.decode(String.self, forKey: .version)
        self.init(
            name: name,
            version: version
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(version, forKey: .version)
    }
}

// MARK: - ServerLimits

public struct ServerLimits: Codable, Equatable, Sendable {
    public let maxFrameBytes: Int
    public let replayWindow: Int
    public let heartbeatSeconds: Int

    public init(
        maxFrameBytes: Int,
        replayWindow: Int,
        heartbeatSeconds: Int
    ) {
        self.maxFrameBytes = maxFrameBytes
        self.replayWindow = replayWindow
        self.heartbeatSeconds = heartbeatSeconds
    }

    private enum CodingKeys: String, CodingKey {
        case maxFrameBytes = "maxFrameBytes"
        case replayWindow = "replayWindow"
        case heartbeatSeconds = "heartbeatSeconds"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let maxFrameBytes = try container.decode(Int.self, forKey: .maxFrameBytes)
        let replayWindow = try container.decode(Int.self, forKey: .replayWindow)
        let heartbeatSeconds = try container.decode(Int.self, forKey: .heartbeatSeconds)
        self.init(
            maxFrameBytes: maxFrameBytes,
            replayWindow: replayWindow,
            heartbeatSeconds: heartbeatSeconds
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(maxFrameBytes, forKey: .maxFrameBytes)
        try container.encode(replayWindow, forKey: .replayWindow)
        try container.encode(heartbeatSeconds, forKey: .heartbeatSeconds)
    }
}

// MARK: - ServiceState

public enum ServiceState: String, Codable, Equatable, Sendable, CaseIterable {
    case running = "running"
    case paused = "paused"
    case degraded = "degraded"
}

// MARK: - ServiceStatus

public struct ServiceStatus: Codable, Equatable, Sendable {
    public let state: ServiceState
    public let version: String
    public let uptimeSeconds: Int
    public let activeTasks: Int

    public init(
        state: ServiceState,
        version: String,
        uptimeSeconds: Int,
        activeTasks: Int
    ) {
        self.state = state
        self.version = version
        self.uptimeSeconds = uptimeSeconds
        self.activeTasks = activeTasks
    }

    private enum CodingKeys: String, CodingKey {
        case state = "state"
        case version = "version"
        case uptimeSeconds = "uptimeSeconds"
        case activeTasks = "activeTasks"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let state = try container.decode(ServiceState.self, forKey: .state)
        let version = try container.decode(String.self, forKey: .version)
        let uptimeSeconds = try container.decode(Int.self, forKey: .uptimeSeconds)
        let activeTasks = try container.decode(Int.self, forKey: .activeTasks)
        self.init(
            state: state,
            version: version,
            uptimeSeconds: uptimeSeconds,
            activeTasks: activeTasks
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(state, forKey: .state)
        try container.encode(version, forKey: .version)
        try container.encode(uptimeSeconds, forKey: .uptimeSeconds)
        try container.encode(activeTasks, forKey: .activeTasks)
    }
}

// MARK: - SessionCreateRequest

public struct SessionCreateRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionCreateRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.create",
        payload: SessionCreateRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionCreateRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionCreateRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.create" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionCreateRequest.type 必須是 session.create")
        }
        let payload = try container.decode(SessionCreateRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionCreateRequestPayload

public struct SessionCreateRequestPayload: Codable, Equatable, Sendable {
    public let title: String?
    public let clientRequestId: String?

    public init(
        title: String? = nil,
        clientRequestId: String? = nil
    ) {
        self.title = title
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case title = "title"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let title = try container.decodeIfPresent(String.self, forKey: .title)
        let clientRequestId = try container.decodeIfPresent(String.self, forKey: .clientRequestId)
        self.init(
            title: title,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SessionCreateResponse

public struct SessionCreateResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionCreateResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.create",
        payload: SessionCreateResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionCreateResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionCreateResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.create" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionCreateResponse.type 必須是 session.create")
        }
        let payload = try container.decode(SessionCreateResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionCreateResponsePayload

public struct SessionCreateResponsePayload: Codable, Equatable, Sendable {
    public let session: SessionSummary

    public init(
        session: SessionSummary
    ) {
        self.session = session
    }

    private enum CodingKeys: String, CodingKey {
        case session = "session"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let session = try container.decode(SessionSummary.self, forKey: .session)
        self.init(
            session: session
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(session, forKey: .session)
    }
}

// MARK: - SessionGetHistoryRequest

public struct SessionGetHistoryRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionGetHistoryRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.get_history",
        payload: SessionGetHistoryRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionGetHistoryRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionGetHistoryRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.get_history" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionGetHistoryRequest.type 必須是 session.get_history")
        }
        let payload = try container.decode(SessionGetHistoryRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionGetHistoryRequestPayload

public struct SessionGetHistoryRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let cursor: String?
    public let limit: Int?

    public init(
        sessionId: String,
        cursor: String? = nil,
        limit: Int? = nil
    ) {
        self.sessionId = sessionId
        self.cursor = cursor
        self.limit = limit
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case cursor = "cursor"
        case limit = "limit"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        let limit = try container.decodeIfPresent(Int.self, forKey: .limit)
        self.init(
            sessionId: sessionId,
            cursor: cursor,
            limit: limit
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encodeIfPresent(cursor, forKey: .cursor)
        try container.encodeIfPresent(limit, forKey: .limit)
    }
}

// MARK: - SessionGetHistoryResponse

public struct SessionGetHistoryResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionGetHistoryResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.get_history",
        payload: SessionGetHistoryResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionGetHistoryResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionGetHistoryResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.get_history" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionGetHistoryResponse.type 必須是 session.get_history")
        }
        let payload = try container.decode(SessionGetHistoryResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionGetHistoryResponsePayload

public struct SessionGetHistoryResponsePayload: Codable, Equatable, Sendable {
    public let entries: [TranscriptEntry]
    public let nextCursor: String?

    public init(
        entries: [TranscriptEntry],
        nextCursor: String? = nil
    ) {
        self.entries = entries
        self.nextCursor = nextCursor
    }

    private enum CodingKeys: String, CodingKey {
        case entries = "entries"
        case nextCursor = "nextCursor"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let entries = try container.decode([TranscriptEntry].self, forKey: .entries)
        let nextCursor = try container.decodeIfPresent(String.self, forKey: .nextCursor)
        self.init(
            entries: entries,
            nextCursor: nextCursor
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(entries, forKey: .entries)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }
}

// MARK: - SessionInterruptRequest

public struct SessionInterruptRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionInterruptRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.interrupt",
        payload: SessionInterruptRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionInterruptRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionInterruptRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.interrupt" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionInterruptRequest.type 必須是 session.interrupt")
        }
        let payload = try container.decode(SessionInterruptRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionInterruptRequestPayload

public struct SessionInterruptRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let reason: String?

    public init(
        sessionId: String,
        reason: String? = nil
    ) {
        self.sessionId = sessionId
        self.reason = reason
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case reason = "reason"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let reason = try container.decodeIfPresent(String.self, forKey: .reason)
        self.init(
            sessionId: sessionId,
            reason: reason
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encodeIfPresent(reason, forKey: .reason)
    }
}

// MARK: - SessionInterruptResponse

public struct SessionInterruptResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionInterruptResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.interrupt",
        payload: SessionInterruptResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionInterruptResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionInterruptResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.interrupt" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionInterruptResponse.type 必須是 session.interrupt")
        }
        let payload = try container.decode(SessionInterruptResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionInterruptResponsePayload

public struct SessionInterruptResponsePayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let interrupted: Bool

    public init(
        sessionId: String,
        interrupted: Bool
    ) {
        self.sessionId = sessionId
        self.interrupted = interrupted
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case interrupted = "interrupted"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let interrupted = try container.decode(Bool.self, forKey: .interrupted)
        self.init(
            sessionId: sessionId,
            interrupted: interrupted
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(interrupted, forKey: .interrupted)
    }
}

// MARK: - SessionListRequest

public struct SessionListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.list",
        payload: SessionListRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionListRequest.type 必須是 session.list")
        }
        let payload = try container.decode(SessionListRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionListRequestPayload

public struct SessionListRequestPayload: Codable, Equatable, Sendable {
    public let cursor: String?
    public let limit: Int?

    public init(
        cursor: String? = nil,
        limit: Int? = nil
    ) {
        self.cursor = cursor
        self.limit = limit
    }

    private enum CodingKeys: String, CodingKey {
        case cursor = "cursor"
        case limit = "limit"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        let limit = try container.decodeIfPresent(Int.self, forKey: .limit)
        self.init(
            cursor: cursor,
            limit: limit
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(cursor, forKey: .cursor)
        try container.encodeIfPresent(limit, forKey: .limit)
    }
}

// MARK: - SessionListResponse

public struct SessionListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.list",
        payload: SessionListResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionListResponse.type 必須是 session.list")
        }
        let payload = try container.decode(SessionListResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionListResponsePayload

public struct SessionListResponsePayload: Codable, Equatable, Sendable {
    public let sessions: [SessionSummary]
    public let nextCursor: String?

    public init(
        sessions: [SessionSummary],
        nextCursor: String? = nil
    ) {
        self.sessions = sessions
        self.nextCursor = nextCursor
    }

    private enum CodingKeys: String, CodingKey {
        case sessions = "sessions"
        case nextCursor = "nextCursor"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessions = try container.decode([SessionSummary].self, forKey: .sessions)
        let nextCursor = try container.decodeIfPresent(String.self, forKey: .nextCursor)
        self.init(
            sessions: sessions,
            nextCursor: nextCursor
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessions, forKey: .sessions)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }
}

// MARK: - SessionSendMessageRequest

public struct SessionSendMessageRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionSendMessageRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.send_message",
        payload: SessionSendMessageRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionSendMessageRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionSendMessageRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.send_message" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionSendMessageRequest.type 必須是 session.send_message")
        }
        let payload = try container.decode(SessionSendMessageRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionSendMessageRequestPayload

public struct SessionSendMessageRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let text: String
    public let delivery: DeliveryMode
    public let clientMessageId: String?

    public init(
        sessionId: String,
        text: String,
        delivery: DeliveryMode,
        clientMessageId: String? = nil
    ) {
        self.sessionId = sessionId
        self.text = text
        self.delivery = delivery
        self.clientMessageId = clientMessageId
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case text = "text"
        case delivery = "delivery"
        case clientMessageId = "clientMessageId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let text = try container.decode(String.self, forKey: .text)
        let delivery = try container.decode(DeliveryMode.self, forKey: .delivery)
        let clientMessageId = try container.decodeIfPresent(String.self, forKey: .clientMessageId)
        self.init(
            sessionId: sessionId,
            text: text,
            delivery: delivery,
            clientMessageId: clientMessageId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(text, forKey: .text)
        try container.encode(delivery, forKey: .delivery)
        try container.encodeIfPresent(clientMessageId, forKey: .clientMessageId)
    }
}

// MARK: - SessionSendMessageResponse

public struct SessionSendMessageResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionSendMessageResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.send_message",
        payload: SessionSendMessageResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionSendMessageResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionSendMessageResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.send_message" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionSendMessageResponse.type 必須是 session.send_message")
        }
        let payload = try container.decode(SessionSendMessageResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionSendMessageResponsePayload

public struct SessionSendMessageResponsePayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let userMessageId: String
    public let turnId: String
    public let disposition: SendMessageDisposition
    public let queuedBehindTurnId: String?

    public init(
        sessionId: String,
        userMessageId: String,
        turnId: String,
        disposition: SendMessageDisposition,
        queuedBehindTurnId: String? = nil
    ) {
        self.sessionId = sessionId
        self.userMessageId = userMessageId
        self.turnId = turnId
        self.disposition = disposition
        self.queuedBehindTurnId = queuedBehindTurnId
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case userMessageId = "userMessageId"
        case turnId = "turnId"
        case disposition = "disposition"
        case queuedBehindTurnId = "queuedBehindTurnId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let userMessageId = try container.decode(String.self, forKey: .userMessageId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let disposition = try container.decode(SendMessageDisposition.self, forKey: .disposition)
        let queuedBehindTurnId = try container.decodeIfPresent(String.self, forKey: .queuedBehindTurnId)
        self.init(
            sessionId: sessionId,
            userMessageId: userMessageId,
            turnId: turnId,
            disposition: disposition,
            queuedBehindTurnId: queuedBehindTurnId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(userMessageId, forKey: .userMessageId)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(disposition, forKey: .disposition)
        try container.encodeIfPresent(queuedBehindTurnId, forKey: .queuedBehindTurnId)
    }
}

// MARK: - SessionSnapshot

public struct SessionSnapshot: Codable, Equatable, Sendable {
    public let session: SessionSummary
    public let entries: [TranscriptEntry]
    public let activeTurn: TurnState?
    public let pendingApproval: ApprovalRequest?
    public let streaming: StreamingMessage?

    public init(
        session: SessionSummary,
        entries: [TranscriptEntry],
        activeTurn: TurnState? = nil,
        pendingApproval: ApprovalRequest? = nil,
        streaming: StreamingMessage? = nil
    ) {
        self.session = session
        self.entries = entries
        self.activeTurn = activeTurn
        self.pendingApproval = pendingApproval
        self.streaming = streaming
    }

    private enum CodingKeys: String, CodingKey {
        case session = "session"
        case entries = "entries"
        case activeTurn = "activeTurn"
        case pendingApproval = "pendingApproval"
        case streaming = "streaming"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let session = try container.decode(SessionSummary.self, forKey: .session)
        let entries = try container.decode([TranscriptEntry].self, forKey: .entries)
        let activeTurn = try container.decodeIfPresent(TurnState.self, forKey: .activeTurn)
        let pendingApproval = try container.decodeIfPresent(ApprovalRequest.self, forKey: .pendingApproval)
        let streaming = try container.decodeIfPresent(StreamingMessage.self, forKey: .streaming)
        self.init(
            session: session,
            entries: entries,
            activeTurn: activeTurn,
            pendingApproval: pendingApproval,
            streaming: streaming
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(session, forKey: .session)
        try container.encode(entries, forKey: .entries)
        try container.encodeIfPresent(activeTurn, forKey: .activeTurn)
        try container.encodeIfPresent(pendingApproval, forKey: .pendingApproval)
        try container.encodeIfPresent(streaming, forKey: .streaming)
    }
}

// MARK: - SessionStatus

public enum SessionStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case idle = "idle"
    case running = "running"
    case waitingApproval = "waiting_approval"
    case archived = "archived"
}

// MARK: - SessionSubscribeRequest

public struct SessionSubscribeRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionSubscribeRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.subscribe",
        payload: SessionSubscribeRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionSubscribeRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionSubscribeRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.subscribe" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionSubscribeRequest.type 必須是 session.subscribe")
        }
        let payload = try container.decode(SessionSubscribeRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionSubscribeRequestPayload

public struct SessionSubscribeRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let lastSeq: Int?
    public let epoch: String?
    public let historyLimit: Int?

    public init(
        sessionId: String,
        lastSeq: Int? = nil,
        epoch: String? = nil,
        historyLimit: Int? = nil
    ) {
        self.sessionId = sessionId
        self.lastSeq = lastSeq
        self.epoch = epoch
        self.historyLimit = historyLimit
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case lastSeq = "lastSeq"
        case epoch = "epoch"
        case historyLimit = "historyLimit"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let lastSeq = try container.decodeIfPresent(Int.self, forKey: .lastSeq)
        let epoch = try container.decodeIfPresent(String.self, forKey: .epoch)
        let historyLimit = try container.decodeIfPresent(Int.self, forKey: .historyLimit)
        self.init(
            sessionId: sessionId,
            lastSeq: lastSeq,
            epoch: epoch,
            historyLimit: historyLimit
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encodeIfPresent(lastSeq, forKey: .lastSeq)
        try container.encodeIfPresent(epoch, forKey: .epoch)
        try container.encodeIfPresent(historyLimit, forKey: .historyLimit)
    }
}

// MARK: - SessionSubscribeResponse

public struct SessionSubscribeResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionSubscribeResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.subscribe",
        payload: SessionSubscribeResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionSubscribeResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionSubscribeResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.subscribe" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionSubscribeResponse.type 必須是 session.subscribe")
        }
        let payload = try container.decode(SessionSubscribeResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionSubscribeResponsePayload

public struct SessionSubscribeResponsePayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let stream: String
    public let seq: Int
    public let epoch: String
    public let resyncRequired: Bool
    public let snapshot: SessionSnapshot?

    public init(
        sessionId: String,
        stream: String,
        seq: Int,
        epoch: String,
        resyncRequired: Bool,
        snapshot: SessionSnapshot? = nil
    ) {
        self.sessionId = sessionId
        self.stream = stream
        self.seq = seq
        self.epoch = epoch
        self.resyncRequired = resyncRequired
        self.snapshot = snapshot
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case stream = "stream"
        case seq = "seq"
        case epoch = "epoch"
        case resyncRequired = "resyncRequired"
        case snapshot = "snapshot"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let epoch = try container.decode(String.self, forKey: .epoch)
        let resyncRequired = try container.decode(Bool.self, forKey: .resyncRequired)
        let snapshot = try container.decodeIfPresent(SessionSnapshot.self, forKey: .snapshot)
        self.init(
            sessionId: sessionId,
            stream: stream,
            seq: seq,
            epoch: epoch,
            resyncRequired: resyncRequired,
            snapshot: snapshot
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(epoch, forKey: .epoch)
        try container.encode(resyncRequired, forKey: .resyncRequired)
        try container.encodeIfPresent(snapshot, forKey: .snapshot)
    }
}

// MARK: - SessionSummary

public struct SessionSummary: Codable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let status: SessionStatus
    public let createdAt: String
    public let updatedAt: String
    public let messageCount: Int

    public init(
        id: String,
        title: String,
        status: SessionStatus,
        createdAt: String,
        updatedAt: String,
        messageCount: Int
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.messageCount = messageCount
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case title = "title"
        case status = "status"
        case createdAt = "createdAt"
        case updatedAt = "updatedAt"
        case messageCount = "messageCount"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let title = try container.decode(String.self, forKey: .title)
        let status = try container.decode(SessionStatus.self, forKey: .status)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let updatedAt = try container.decode(String.self, forKey: .updatedAt)
        let messageCount = try container.decode(Int.self, forKey: .messageCount)
        self.init(
            id: id,
            title: title,
            status: status,
            createdAt: createdAt,
            updatedAt: updatedAt,
            messageCount: messageCount
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(status, forKey: .status)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(messageCount, forKey: .messageCount)
    }
}

// MARK: - SessionUnsubscribeRequest

public struct SessionUnsubscribeRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionUnsubscribeRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.unsubscribe",
        payload: SessionUnsubscribeRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionUnsubscribeRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionUnsubscribeRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.unsubscribe" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionUnsubscribeRequest.type 必須是 session.unsubscribe")
        }
        let payload = try container.decode(SessionUnsubscribeRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionUnsubscribeRequestPayload

public struct SessionUnsubscribeRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String

    public init(
        sessionId: String
    ) {
        self.sessionId = sessionId
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        self.init(
            sessionId: sessionId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
    }
}

// MARK: - SessionUnsubscribeResponse

public struct SessionUnsubscribeResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionUnsubscribeResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.unsubscribe",
        payload: SessionUnsubscribeResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionUnsubscribeResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionUnsubscribeResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.unsubscribe" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionUnsubscribeResponse.type 必須是 session.unsubscribe")
        }
        let payload = try container.decode(SessionUnsubscribeResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SessionUnsubscribeResponsePayload

public struct SessionUnsubscribeResponsePayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let unsubscribed: Bool

    public init(
        sessionId: String,
        unsubscribed: Bool
    ) {
        self.sessionId = sessionId
        self.unsubscribed = unsubscribed
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case unsubscribed = "unsubscribed"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let unsubscribed = try container.decode(Bool.self, forKey: .unsubscribed)
        self.init(
            sessionId: sessionId,
            unsubscribed: unsubscribed
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(unsubscribed, forKey: .unsubscribed)
    }
}

// MARK: - StreamMessageCompletedEvent

public struct StreamMessageCompletedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: StreamMessageCompletedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "stream.message_completed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: StreamMessageCompletedEventPayload
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StreamMessageCompletedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StreamMessageCompletedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "stream.message_completed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StreamMessageCompletedEvent.type 必須是 stream.message_completed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(StreamMessageCompletedEventPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - StreamMessageCompletedEventPayload

public struct StreamMessageCompletedEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let turnId: String
    public let entry: AssistantTranscriptEntry
    public let usage: TokenUsage?

    public init(
        sessionId: String,
        turnId: String,
        entry: AssistantTranscriptEntry,
        usage: TokenUsage? = nil
    ) {
        self.sessionId = sessionId
        self.turnId = turnId
        self.entry = entry
        self.usage = usage
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case turnId = "turnId"
        case entry = "entry"
        case usage = "usage"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let entry = try container.decode(AssistantTranscriptEntry.self, forKey: .entry)
        let usage = try container.decodeIfPresent(TokenUsage.self, forKey: .usage)
        self.init(
            sessionId: sessionId,
            turnId: turnId,
            entry: entry,
            usage: usage
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(entry, forKey: .entry)
        try container.encodeIfPresent(usage, forKey: .usage)
    }
}

// MARK: - StreamTextDeltaEvent

public struct StreamTextDeltaEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: StreamTextDeltaEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "stream.text_delta",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: StreamTextDeltaEventPayload
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StreamTextDeltaEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StreamTextDeltaEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "stream.text_delta" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StreamTextDeltaEvent.type 必須是 stream.text_delta")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(StreamTextDeltaEventPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - StreamTextDeltaEventPayload

public struct StreamTextDeltaEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let turnId: String
    public let messageId: String
    public let delta: String

    public init(
        sessionId: String,
        turnId: String,
        messageId: String,
        delta: String
    ) {
        self.sessionId = sessionId
        self.turnId = turnId
        self.messageId = messageId
        self.delta = delta
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case turnId = "turnId"
        case messageId = "messageId"
        case delta = "delta"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let messageId = try container.decode(String.self, forKey: .messageId)
        let delta = try container.decode(String.self, forKey: .delta)
        self.init(
            sessionId: sessionId,
            turnId: turnId,
            messageId: messageId,
            delta: delta
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(messageId, forKey: .messageId)
        try container.encode(delta, forKey: .delta)
    }
}

// MARK: - StreamToolCallEvent

public struct StreamToolCallEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: StreamToolCallEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "stream.tool_call",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: StreamToolCallEventPayload
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StreamToolCallEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StreamToolCallEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "stream.tool_call" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StreamToolCallEvent.type 必須是 stream.tool_call")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(StreamToolCallEventPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - StreamToolCallEventPayload

public struct StreamToolCallEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let turnId: String
    public let toolCallId: String
    public let name: String
    public let title: String?
    public let input: JSONObject

    public init(
        sessionId: String,
        turnId: String,
        toolCallId: String,
        name: String,
        title: String? = nil,
        input: JSONObject
    ) {
        self.sessionId = sessionId
        self.turnId = turnId
        self.toolCallId = toolCallId
        self.name = name
        self.title = title
        self.input = input
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case turnId = "turnId"
        case toolCallId = "toolCallId"
        case name = "name"
        case title = "title"
        case input = "input"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let toolCallId = try container.decode(String.self, forKey: .toolCallId)
        let name = try container.decode(String.self, forKey: .name)
        let title = try container.decodeIfPresent(String.self, forKey: .title)
        let input = try container.decode(JSONObject.self, forKey: .input)
        self.init(
            sessionId: sessionId,
            turnId: turnId,
            toolCallId: toolCallId,
            name: name,
            title: title,
            input: input
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(toolCallId, forKey: .toolCallId)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encode(input, forKey: .input)
    }
}

// MARK: - StreamToolResultEvent

public struct StreamToolResultEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: StreamToolResultEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "stream.tool_result",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: StreamToolResultEventPayload
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StreamToolResultEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StreamToolResultEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "stream.tool_result" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StreamToolResultEvent.type 必須是 stream.tool_result")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(StreamToolResultEventPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - StreamToolResultEventPayload

public struct StreamToolResultEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let turnId: String
    public let toolCallId: String
    public let status: ToolResultStatus
    public let output: ToolOutput
    public let diagnostics: [ToolDiagnostic]

    public init(
        sessionId: String,
        turnId: String,
        toolCallId: String,
        status: ToolResultStatus,
        output: ToolOutput,
        diagnostics: [ToolDiagnostic]
    ) {
        self.sessionId = sessionId
        self.turnId = turnId
        self.toolCallId = toolCallId
        self.status = status
        self.output = output
        self.diagnostics = diagnostics
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case turnId = "turnId"
        case toolCallId = "toolCallId"
        case status = "status"
        case output = "output"
        case diagnostics = "diagnostics"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let toolCallId = try container.decode(String.self, forKey: .toolCallId)
        let status = try container.decode(ToolResultStatus.self, forKey: .status)
        let output = try container.decode(ToolOutput.self, forKey: .output)
        let diagnostics = try container.decode([ToolDiagnostic].self, forKey: .diagnostics)
        self.init(
            sessionId: sessionId,
            turnId: turnId,
            toolCallId: toolCallId,
            status: status,
            output: output,
            diagnostics: diagnostics
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(toolCallId, forKey: .toolCallId)
        try container.encode(status, forKey: .status)
        try container.encode(output, forKey: .output)
        try container.encode(diagnostics, forKey: .diagnostics)
    }
}

// MARK: - StreamTurnStartedEvent

public struct StreamTurnStartedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: StreamTurnStartedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "stream.turn_started",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: StreamTurnStartedEventPayload
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StreamTurnStartedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StreamTurnStartedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "stream.turn_started" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StreamTurnStartedEvent.type 必須是 stream.turn_started")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(StreamTurnStartedEventPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - StreamTurnStartedEventPayload

public struct StreamTurnStartedEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let turnId: String
    public let triggerMessageId: String
    public let startedAt: String

    public init(
        sessionId: String,
        turnId: String,
        triggerMessageId: String,
        startedAt: String
    ) {
        self.sessionId = sessionId
        self.turnId = turnId
        self.triggerMessageId = triggerMessageId
        self.startedAt = startedAt
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case turnId = "turnId"
        case triggerMessageId = "triggerMessageId"
        case startedAt = "startedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let triggerMessageId = try container.decode(String.self, forKey: .triggerMessageId)
        let startedAt = try container.decode(String.self, forKey: .startedAt)
        self.init(
            sessionId: sessionId,
            turnId: turnId,
            triggerMessageId: triggerMessageId,
            startedAt: startedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(triggerMessageId, forKey: .triggerMessageId)
        try container.encode(startedAt, forKey: .startedAt)
    }
}

// MARK: - StreamTurnStateEvent

public struct StreamTurnStateEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: TurnState

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "stream.turn_state",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: TurnState
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StreamTurnStateEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StreamTurnStateEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "stream.turn_state" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StreamTurnStateEvent.type 必須是 stream.turn_state")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(TurnState.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - StreamUiEvent

public struct StreamUiEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: StreamUiEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "stream.ui",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: StreamUiEventPayload
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StreamUiEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StreamUiEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "stream.ui" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StreamUiEvent.type 必須是 stream.ui")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(StreamUiEventPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - StreamUiEventPayload

public struct StreamUiEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let turnId: String
    public let toolCallId: String?
    public let renderer: String
    public let data: JSONValue

    public init(
        sessionId: String,
        turnId: String,
        toolCallId: String? = nil,
        renderer: String,
        data: JSONValue
    ) {
        self.sessionId = sessionId
        self.turnId = turnId
        self.toolCallId = toolCallId
        self.renderer = renderer
        self.data = data
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case turnId = "turnId"
        case toolCallId = "toolCallId"
        case renderer = "renderer"
        case data = "data"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let toolCallId = try container.decodeIfPresent(String.self, forKey: .toolCallId)
        let renderer = try container.decode(String.self, forKey: .renderer)
        let data = try container.decode(JSONValue.self, forKey: .data)
        self.init(
            sessionId: sessionId,
            turnId: turnId,
            toolCallId: toolCallId,
            renderer: renderer,
            data: data
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(turnId, forKey: .turnId)
        try container.encodeIfPresent(toolCallId, forKey: .toolCallId)
        try container.encode(renderer, forKey: .renderer)
        try container.encode(data, forKey: .data)
    }
}

// MARK: - StreamingMessage

public struct StreamingMessage: Codable, Equatable, Sendable {
    public let messageId: String
    public let turnId: String
    public let text: String
    public let startedAt: String
    public let truncated: Bool?

    public init(
        messageId: String,
        turnId: String,
        text: String,
        startedAt: String,
        truncated: Bool? = nil
    ) {
        self.messageId = messageId
        self.turnId = turnId
        self.text = text
        self.startedAt = startedAt
        self.truncated = truncated
    }

    private enum CodingKeys: String, CodingKey {
        case messageId = "messageId"
        case turnId = "turnId"
        case text = "text"
        case startedAt = "startedAt"
        case truncated = "truncated"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let messageId = try container.decode(String.self, forKey: .messageId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let text = try container.decode(String.self, forKey: .text)
        let startedAt = try container.decode(String.self, forKey: .startedAt)
        let truncated = try container.decodeIfPresent(Bool.self, forKey: .truncated)
        self.init(
            messageId: messageId,
            turnId: turnId,
            text: text,
            startedAt: startedAt,
            truncated: truncated
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(messageId, forKey: .messageId)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(text, forKey: .text)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encodeIfPresent(truncated, forKey: .truncated)
    }
}

// MARK: - SystemHelloRequest

public struct SystemHelloRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemHelloRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.hello",
        payload: SystemHelloRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemHelloRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemHelloRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.hello" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemHelloRequest.type 必須是 system.hello")
        }
        let payload = try container.decode(SystemHelloRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SystemHelloRequestPayload

public struct SystemHelloRequestPayload: Codable, Equatable, Sendable {
    public let auth: HelloAuth?
    public let `protocol`: ProtocolRange
    public let client: ClientInfo
    public let resume: HelloResume?

    public init(
        auth: HelloAuth? = nil,
        `protocol`: ProtocolRange,
        client: ClientInfo,
        resume: HelloResume? = nil
    ) {
        self.auth = auth
        self.`protocol` = `protocol`
        self.client = client
        self.resume = resume
    }

    private enum CodingKeys: String, CodingKey {
        case auth = "auth"
        case `protocol` = "protocol"
        case client = "client"
        case resume = "resume"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let auth = try container.decodeIfPresent(HelloAuth.self, forKey: .auth)
        let `protocol` = try container.decode(ProtocolRange.self, forKey: .`protocol`)
        let client = try container.decode(ClientInfo.self, forKey: .client)
        let resume = try container.decodeIfPresent(HelloResume.self, forKey: .resume)
        self.init(
            auth: auth,
            protocol: `protocol`,
            client: client,
            resume: resume
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(auth, forKey: .auth)
        try container.encode(`protocol`, forKey: .`protocol`)
        try container.encode(client, forKey: .client)
        try container.encodeIfPresent(resume, forKey: .resume)
    }
}

// MARK: - SystemHelloResponse

public struct SystemHelloResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SystemHelloResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.hello",
        payload: SystemHelloResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemHelloResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemHelloResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.hello" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemHelloResponse.type 必須是 system.hello")
        }
        let payload = try container.decode(SystemHelloResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SystemHelloResponsePayload

public struct SystemHelloResponsePayload: Codable, Equatable, Sendable {
    public let `protocol`: ProtocolInfo
    public let server: ServerInfo
    public let connectionId: String
    public let limits: ServerLimits
    public let capabilities: ServerCapabilities
    public let epoch: String

    public init(
        `protocol`: ProtocolInfo,
        server: ServerInfo,
        connectionId: String,
        limits: ServerLimits,
        capabilities: ServerCapabilities,
        epoch: String
    ) {
        self.`protocol` = `protocol`
        self.server = server
        self.connectionId = connectionId
        self.limits = limits
        self.capabilities = capabilities
        self.epoch = epoch
    }

    private enum CodingKeys: String, CodingKey {
        case `protocol` = "protocol"
        case server = "server"
        case connectionId = "connectionId"
        case limits = "limits"
        case capabilities = "capabilities"
        case epoch = "epoch"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let `protocol` = try container.decode(ProtocolInfo.self, forKey: .`protocol`)
        let server = try container.decode(ServerInfo.self, forKey: .server)
        let connectionId = try container.decode(String.self, forKey: .connectionId)
        let limits = try container.decode(ServerLimits.self, forKey: .limits)
        let capabilities = try container.decode(ServerCapabilities.self, forKey: .capabilities)
        let epoch = try container.decode(String.self, forKey: .epoch)
        self.init(
            protocol: `protocol`,
            server: server,
            connectionId: connectionId,
            limits: limits,
            capabilities: capabilities,
            epoch: epoch
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(`protocol`, forKey: .`protocol`)
        try container.encode(server, forKey: .server)
        try container.encode(connectionId, forKey: .connectionId)
        try container.encode(limits, forKey: .limits)
        try container.encode(capabilities, forKey: .capabilities)
        try container.encode(epoch, forKey: .epoch)
    }
}

// MARK: - SystemStatus

public struct SystemStatus: Codable, Equatable, Sendable {
    public let folder: FolderStatus
    public let service: ServiceStatus

    public init(
        folder: FolderStatus,
        service: ServiceStatus
    ) {
        self.folder = folder
        self.service = service
    }

    private enum CodingKeys: String, CodingKey {
        case folder = "folder"
        case service = "service"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let folder = try container.decode(FolderStatus.self, forKey: .folder)
        let service = try container.decode(ServiceStatus.self, forKey: .service)
        self.init(
            folder: folder,
            service: service
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(folder, forKey: .folder)
        try container.encode(service, forKey: .service)
    }
}

// MARK: - SystemStatusEvent

public struct SystemStatusEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: SystemStatus

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "system.status",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: SystemStatus
    ) {
        self.v = v
        self.kind = kind
        self.type = type
        self.stream = stream
        self.seq = seq
        self.emittedAt = emittedAt
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case type = "type"
        case stream = "stream"
        case seq = "seq"
        case emittedAt = "emittedAt"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemStatusEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemStatusEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.status" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemStatusEvent.type 必須是 system.status")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(SystemStatus.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            type: type,
            stream: stream,
            seq: seq,
            emittedAt: emittedAt,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(type, forKey: .type)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(emittedAt, forKey: .emittedAt)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SystemSubscribeRequest

public struct SystemSubscribeRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemSubscribeRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.subscribe",
        payload: SystemSubscribeRequestPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemSubscribeRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemSubscribeRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.subscribe" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemSubscribeRequest.type 必須是 system.subscribe")
        }
        let payload = try container.decode(SystemSubscribeRequestPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SystemSubscribeRequestPayload

public struct SystemSubscribeRequestPayload: Codable, Equatable, Sendable {
    public let lastSeq: Int?
    public let epoch: String?

    public init(
        lastSeq: Int? = nil,
        epoch: String? = nil
    ) {
        self.lastSeq = lastSeq
        self.epoch = epoch
    }

    private enum CodingKeys: String, CodingKey {
        case lastSeq = "lastSeq"
        case epoch = "epoch"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let lastSeq = try container.decodeIfPresent(Int.self, forKey: .lastSeq)
        let epoch = try container.decodeIfPresent(String.self, forKey: .epoch)
        self.init(
            lastSeq: lastSeq,
            epoch: epoch
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(lastSeq, forKey: .lastSeq)
        try container.encodeIfPresent(epoch, forKey: .epoch)
    }
}

// MARK: - SystemSubscribeResponse

public struct SystemSubscribeResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SystemSubscribeResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.subscribe",
        payload: SystemSubscribeResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemSubscribeResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemSubscribeResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.subscribe" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemSubscribeResponse.type 必須是 system.subscribe")
        }
        let payload = try container.decode(SystemSubscribeResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SystemSubscribeResponsePayload

public struct SystemSubscribeResponsePayload: Codable, Equatable, Sendable {
    public let stream: String
    public let seq: Int
    public let epoch: String
    public let resyncRequired: Bool
    public let snapshot: SystemStatus?

    public init(
        stream: String,
        seq: Int,
        epoch: String,
        resyncRequired: Bool,
        snapshot: SystemStatus? = nil
    ) {
        self.stream = stream
        self.seq = seq
        self.epoch = epoch
        self.resyncRequired = resyncRequired
        self.snapshot = snapshot
    }

    private enum CodingKeys: String, CodingKey {
        case stream = "stream"
        case seq = "seq"
        case epoch = "epoch"
        case resyncRequired = "resyncRequired"
        case snapshot = "snapshot"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let epoch = try container.decode(String.self, forKey: .epoch)
        let resyncRequired = try container.decode(Bool.self, forKey: .resyncRequired)
        let snapshot = try container.decodeIfPresent(SystemStatus.self, forKey: .snapshot)
        self.init(
            stream: stream,
            seq: seq,
            epoch: epoch,
            resyncRequired: resyncRequired,
            snapshot: snapshot
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(epoch, forKey: .epoch)
        try container.encode(resyncRequired, forKey: .resyncRequired)
        try container.encodeIfPresent(snapshot, forKey: .snapshot)
    }
}

// MARK: - SystemUnsubscribeRequest

public struct SystemUnsubscribeRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: EmptyPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.unsubscribe",
        payload: EmptyPayload
    ) {
        self.v = v
        self.kind = kind
        self.id = id
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case id = "id"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemUnsubscribeRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemUnsubscribeRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.unsubscribe" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemUnsubscribeRequest.type 必須是 system.unsubscribe")
        }
        let payload = try container.decode(EmptyPayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            id: id,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SystemUnsubscribeResponse

public struct SystemUnsubscribeResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SystemUnsubscribeResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.unsubscribe",
        payload: SystemUnsubscribeResponsePayload
    ) {
        self.v = v
        self.kind = kind
        self.replyTo = replyTo
        self.type = type
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case v = "v"
        case kind = "kind"
        case replyTo = "replyTo"
        case type = "type"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let v = try container.decode(Int.self, forKey: .v)
        guard v == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemUnsubscribeResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemUnsubscribeResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.unsubscribe" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemUnsubscribeResponse.type 必須是 system.unsubscribe")
        }
        let payload = try container.decode(SystemUnsubscribeResponsePayload.self, forKey: .payload)
        self.init(
            v: v,
            kind: kind,
            replyTo: replyTo,
            type: type,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(kind, forKey: .kind)
        try container.encode(replyTo, forKey: .replyTo)
        try container.encode(type, forKey: .type)
        try container.encode(payload, forKey: .payload)
    }
}

// MARK: - SystemUnsubscribeResponsePayload

public struct SystemUnsubscribeResponsePayload: Codable, Equatable, Sendable {
    public let stream: String

    public init(
        stream: String
    ) {
        self.stream = stream
    }

    private enum CodingKeys: String, CodingKey {
        case stream = "stream"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let stream = try container.decode(String.self, forKey: .stream)
        self.init(
            stream: stream
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(stream, forKey: .stream)
    }
}

// MARK: - TokenUsage

public struct TokenUsage: Codable, Equatable, Sendable {
    public let inputTokens: Int?
    public let outputTokens: Int?

    public init(
        inputTokens: Int? = nil,
        outputTokens: Int? = nil
    ) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
    }

    private enum CodingKeys: String, CodingKey {
        case inputTokens = "inputTokens"
        case outputTokens = "outputTokens"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let inputTokens = try container.decodeIfPresent(Int.self, forKey: .inputTokens)
        let outputTokens = try container.decodeIfPresent(Int.self, forKey: .outputTokens)
        self.init(
            inputTokens: inputTokens,
            outputTokens: outputTokens
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(inputTokens, forKey: .inputTokens)
        try container.encodeIfPresent(outputTokens, forKey: .outputTokens)
    }
}

// MARK: - ToolDiagnostic

public struct ToolDiagnostic: Codable, Equatable, Sendable {
    public let code: String
    public let message: String?

    public init(
        code: String,
        message: String? = nil
    ) {
        self.code = code
        self.message = message
    }

    private enum CodingKeys: String, CodingKey {
        case code = "code"
        case message = "message"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let code = try container.decode(String.self, forKey: .code)
        let message = try container.decodeIfPresent(String.self, forKey: .message)
        self.init(
            code: code,
            message: message
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(code, forKey: .code)
        try container.encodeIfPresent(message, forKey: .message)
    }
}

// MARK: - ToolOutput

public struct ToolOutput: Codable, Equatable, Sendable {
    public let text: String?
    public let data: JSONValue?
    public let truncated: Bool?

    public init(
        text: String? = nil,
        data: JSONValue? = nil,
        truncated: Bool? = nil
    ) {
        self.text = text
        self.data = data
        self.truncated = truncated
    }

    private enum CodingKeys: String, CodingKey {
        case text = "text"
        case data = "data"
        case truncated = "truncated"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let text = try container.decodeIfPresent(String.self, forKey: .text)
        let data = try container.decodeIfPresent(JSONValue.self, forKey: .data)
        let truncated = try container.decodeIfPresent(Bool.self, forKey: .truncated)
        self.init(
            text: text,
            data: data,
            truncated: truncated
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(text, forKey: .text)
        try container.encodeIfPresent(data, forKey: .data)
        try container.encodeIfPresent(truncated, forKey: .truncated)
    }
}

// MARK: - ToolResultStatus

public enum ToolResultStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case ok = "ok"
    case error = "error"
}

// MARK: - ToolTranscriptEntry

public struct ToolTranscriptEntry: Codable, Equatable, Sendable {
    public let id: String
    public let role: String
    public let turnId: String
    public let createdAt: String
    public let toolCallId: String
    public let name: String
    public let input: JSONObject
    public let output: ToolOutput?
    public let status: MessageStatus
    public let diagnostics: [ToolDiagnostic]

    public init(
        id: String,
        role: String = "tool",
        turnId: String,
        createdAt: String,
        toolCallId: String,
        name: String,
        input: JSONObject,
        output: ToolOutput? = nil,
        status: MessageStatus,
        diagnostics: [ToolDiagnostic]
    ) {
        self.id = id
        self.role = role
        self.turnId = turnId
        self.createdAt = createdAt
        self.toolCallId = toolCallId
        self.name = name
        self.input = input
        self.output = output
        self.status = status
        self.diagnostics = diagnostics
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case role = "role"
        case turnId = "turnId"
        case createdAt = "createdAt"
        case toolCallId = "toolCallId"
        case name = "name"
        case input = "input"
        case output = "output"
        case status = "status"
        case diagnostics = "diagnostics"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let role = try container.decode(String.self, forKey: .role)
        guard role == "tool" else {
            throw DecodingError.dataCorruptedError(forKey: .role, in: container, debugDescription: "ToolTranscriptEntry.role 必須是 tool")
        }
        let turnId = try container.decode(String.self, forKey: .turnId)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let toolCallId = try container.decode(String.self, forKey: .toolCallId)
        let name = try container.decode(String.self, forKey: .name)
        let input = try container.decode(JSONObject.self, forKey: .input)
        let output = try container.decodeIfPresent(ToolOutput.self, forKey: .output)
        let status = try container.decode(MessageStatus.self, forKey: .status)
        let diagnostics = try container.decode([ToolDiagnostic].self, forKey: .diagnostics)
        self.init(
            id: id,
            role: role,
            turnId: turnId,
            createdAt: createdAt,
            toolCallId: toolCallId,
            name: name,
            input: input,
            output: output,
            status: status,
            diagnostics: diagnostics
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(role, forKey: .role)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(toolCallId, forKey: .toolCallId)
        try container.encode(name, forKey: .name)
        try container.encode(input, forKey: .input)
        try container.encodeIfPresent(output, forKey: .output)
        try container.encode(status, forKey: .status)
        try container.encode(diagnostics, forKey: .diagnostics)
    }
}

// MARK: - TranscriptEntry

public enum TranscriptEntry: Codable, Equatable, Sendable {
    case userTranscriptEntry(UserTranscriptEntry)
    case assistantTranscriptEntry(AssistantTranscriptEntry)
    case toolTranscriptEntry(ToolTranscriptEntry)

    private enum DiscriminatorKeys: String, CodingKey {
        case role
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DiscriminatorKeys.self)
        let role = try container.decodeIfPresent(String.self, forKey: .role)
        switch role {
        case .some("user"):
            self = .userTranscriptEntry(try UserTranscriptEntry(from: decoder))
        case .some("assistant"):
            self = .assistantTranscriptEntry(try AssistantTranscriptEntry(from: decoder))
        case .some("tool"):
            self = .toolTranscriptEntry(try ToolTranscriptEntry(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(forKey: .role, in: container, debugDescription: "不支援的 TranscriptEntry 判別組合：role=\(role ?? "nil")")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .userTranscriptEntry(let value):
            try value.encode(to: encoder)
        case .assistantTranscriptEntry(let value):
            try value.encode(to: encoder)
        case .toolTranscriptEntry(let value):
            try value.encode(to: encoder)
        }
    }
}

// MARK: - TurnError

public struct TurnError: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
    public let retryable: Bool

    public init(
        code: String,
        message: String,
        retryable: Bool
    ) {
        self.code = code
        self.message = message
        self.retryable = retryable
    }

    private enum CodingKeys: String, CodingKey {
        case code = "code"
        case message = "message"
        case retryable = "retryable"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let code = try container.decode(String.self, forKey: .code)
        let message = try container.decode(String.self, forKey: .message)
        let retryable = try container.decode(Bool.self, forKey: .retryable)
        self.init(
            code: code,
            message: message,
            retryable: retryable
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(code, forKey: .code)
        try container.encode(message, forKey: .message)
        try container.encode(retryable, forKey: .retryable)
    }
}

// MARK: - TurnPhase

public enum TurnPhase: String, Codable, Equatable, Sendable, CaseIterable {
    case queued = "queued"
    case running = "running"
    case waitingApproval = "waiting_approval"
    case completed = "completed"
    case failed = "failed"
    case interrupted = "interrupted"
}

// MARK: - TurnState

public struct TurnState: Codable, Equatable, Sendable {
    public let turnId: String
    public let state: TurnPhase
    public let startedAt: String
    public let endedAt: String?
    public let error: TurnError?

    public init(
        turnId: String,
        state: TurnPhase,
        startedAt: String,
        endedAt: String? = nil,
        error: TurnError? = nil
    ) {
        self.turnId = turnId
        self.state = state
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.error = error
    }

    private enum CodingKeys: String, CodingKey {
        case turnId = "turnId"
        case state = "state"
        case startedAt = "startedAt"
        case endedAt = "endedAt"
        case error = "error"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let turnId = try container.decode(String.self, forKey: .turnId)
        let state = try container.decode(TurnPhase.self, forKey: .state)
        let startedAt = try container.decode(String.self, forKey: .startedAt)
        let endedAt = try container.decodeIfPresent(String.self, forKey: .endedAt)
        let error = try container.decodeIfPresent(TurnError.self, forKey: .error)
        self.init(
            turnId: turnId,
            state: state,
            startedAt: startedAt,
            endedAt: endedAt,
            error: error
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(state, forKey: .state)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encodeIfPresent(endedAt, forKey: .endedAt)
        try container.encodeIfPresent(error, forKey: .error)
    }
}

// MARK: - UserTranscriptEntry

public struct UserTranscriptEntry: Codable, Equatable, Sendable {
    public let id: String
    public let role: String
    public let turnId: String
    public let createdAt: String
    public let text: String

    public init(
        id: String,
        role: String = "user",
        turnId: String,
        createdAt: String,
        text: String
    ) {
        self.id = id
        self.role = role
        self.turnId = turnId
        self.createdAt = createdAt
        self.text = text
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case role = "role"
        case turnId = "turnId"
        case createdAt = "createdAt"
        case text = "text"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let role = try container.decode(String.self, forKey: .role)
        guard role == "user" else {
            throw DecodingError.dataCorruptedError(forKey: .role, in: container, debugDescription: "UserTranscriptEntry.role 必須是 user")
        }
        let turnId = try container.decode(String.self, forKey: .turnId)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let text = try container.decode(String.self, forKey: .text)
        self.init(
            id: id,
            role: role,
            turnId: turnId,
            createdAt: createdAt,
            text: text
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(role, forKey: .role)
        try container.encode(turnId, forKey: .turnId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(text, forKey: .text)
    }
}
