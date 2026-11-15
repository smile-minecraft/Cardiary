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

// MARK: - BlobInfo

public struct BlobInfo: Codable, Equatable, Sendable {
    public let blobId: String
    public let mediaType: String
    public let sizeBytes: Int

    public init(
        blobId: String,
        mediaType: String,
        sizeBytes: Int
    ) {
        self.blobId = blobId
        self.mediaType = mediaType
        self.sizeBytes = sizeBytes
    }

    private enum CodingKeys: String, CodingKey {
        case blobId = "blobId"
        case mediaType = "mediaType"
        case sizeBytes = "sizeBytes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let blobId = try container.decode(String.self, forKey: .blobId)
        let mediaType = try container.decode(String.self, forKey: .mediaType)
        let sizeBytes = try container.decode(Int.self, forKey: .sizeBytes)
        self.init(
            blobId: blobId,
            mediaType: mediaType,
            sizeBytes: sizeBytes
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(blobId, forKey: .blobId)
        try container.encode(mediaType, forKey: .mediaType)
        try container.encode(sizeBytes, forKey: .sizeBytes)
    }
}

// MARK: - Card

public struct Card: Codable, Equatable, Sendable {
    public let cardId: String
    public let kind: CardKind
    public let title: String
    public let summary: String?
    public let body: String
    public let tags: [String]
    public let persona: String
    public let createdAt: String
    public let updatedAt: String?
    public let freshness: Int
    public let lifecycle: CardLifecycle
    public let supersededBy: String?
    public let supersedes: String?
    public let sources: [String]
    public let asset: CardAsset?
    public let links: CardLinks
    public let revision: String

    public init(
        cardId: String,
        kind: CardKind,
        title: String,
        summary: String? = nil,
        body: String,
        tags: [String],
        persona: String,
        createdAt: String,
        updatedAt: String? = nil,
        freshness: Int,
        lifecycle: CardLifecycle,
        supersededBy: String? = nil,
        supersedes: String? = nil,
        sources: [String],
        asset: CardAsset? = nil,
        links: CardLinks,
        revision: String
    ) {
        self.cardId = cardId
        self.kind = kind
        self.title = title
        self.summary = summary
        self.body = body
        self.tags = tags
        self.persona = persona
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.freshness = freshness
        self.lifecycle = lifecycle
        self.supersededBy = supersededBy
        self.supersedes = supersedes
        self.sources = sources
        self.asset = asset
        self.links = links
        self.revision = revision
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case kind = "kind"
        case title = "title"
        case summary = "summary"
        case body = "body"
        case tags = "tags"
        case persona = "persona"
        case createdAt = "createdAt"
        case updatedAt = "updatedAt"
        case freshness = "freshness"
        case lifecycle = "lifecycle"
        case supersededBy = "supersededBy"
        case supersedes = "supersedes"
        case sources = "sources"
        case asset = "asset"
        case links = "links"
        case revision = "revision"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let kind = try container.decode(CardKind.self, forKey: .kind)
        let title = try container.decode(String.self, forKey: .title)
        let summary = try container.decodeIfPresent(String.self, forKey: .summary)
        let body = try container.decode(String.self, forKey: .body)
        let tags = try container.decode([String].self, forKey: .tags)
        let persona = try container.decode(String.self, forKey: .persona)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        let freshness = try container.decode(Int.self, forKey: .freshness)
        let lifecycle = try container.decode(CardLifecycle.self, forKey: .lifecycle)
        let supersededBy = try container.decodeIfPresent(String.self, forKey: .supersededBy)
        let supersedes = try container.decodeIfPresent(String.self, forKey: .supersedes)
        let sources = try container.decode([String].self, forKey: .sources)
        let asset = try container.decodeIfPresent(CardAsset.self, forKey: .asset)
        let links = try container.decode(CardLinks.self, forKey: .links)
        let revision = try container.decode(String.self, forKey: .revision)
        self.init(
            cardId: cardId,
            kind: kind,
            title: title,
            summary: summary,
            body: body,
            tags: tags,
            persona: persona,
            createdAt: createdAt,
            updatedAt: updatedAt,
            freshness: freshness,
            lifecycle: lifecycle,
            supersededBy: supersededBy,
            supersedes: supersedes,
            sources: sources,
            asset: asset,
            links: links,
            revision: revision
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(kind, forKey: .kind)
        try container.encode(title, forKey: .title)
        try container.encodeIfPresent(summary, forKey: .summary)
        try container.encode(body, forKey: .body)
        try container.encode(tags, forKey: .tags)
        try container.encode(persona, forKey: .persona)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try container.encode(freshness, forKey: .freshness)
        try container.encode(lifecycle, forKey: .lifecycle)
        try container.encodeIfPresent(supersededBy, forKey: .supersededBy)
        try container.encodeIfPresent(supersedes, forKey: .supersedes)
        try container.encode(sources, forKey: .sources)
        try container.encodeIfPresent(asset, forKey: .asset)
        try container.encode(links, forKey: .links)
        try container.encode(revision, forKey: .revision)
    }
}

// MARK: - CardAsset

public struct CardAsset: Codable, Equatable, Sendable {
    public let blobId: String
    public let mediaType: String
    public let sizeBytes: Int

    public init(
        blobId: String,
        mediaType: String,
        sizeBytes: Int
    ) {
        self.blobId = blobId
        self.mediaType = mediaType
        self.sizeBytes = sizeBytes
    }

    private enum CodingKeys: String, CodingKey {
        case blobId = "blobId"
        case mediaType = "mediaType"
        case sizeBytes = "sizeBytes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let blobId = try container.decode(String.self, forKey: .blobId)
        let mediaType = try container.decode(String.self, forKey: .mediaType)
        let sizeBytes = try container.decode(Int.self, forKey: .sizeBytes)
        self.init(
            blobId: blobId,
            mediaType: mediaType,
            sizeBytes: sizeBytes
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(blobId, forKey: .blobId)
        try container.encode(mediaType, forKey: .mediaType)
        try container.encode(sizeBytes, forKey: .sizeBytes)
    }
}

// MARK: - CardChange

public enum CardChange: String, Codable, Equatable, Sendable, CaseIterable {
    case created = "created"
    case updated = "updated"
    case deleted = "deleted"
    case refreshed = "refreshed"
    case reindexed = "reindexed"
}

// MARK: - CardChangedEvent

public struct CardChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: CardChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "card.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: CardChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardChangedEvent.type 必須是 card.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(CardChangedEventPayload.self, forKey: .payload)
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

// MARK: - CardChangedEventPayload

public struct CardChangedEventPayload: Codable, Equatable, Sendable {
    public let cardId: String
    public let change: CardChange
    public let revision: String?
    public let freshness: Int?

    public init(
        cardId: String,
        change: CardChange,
        revision: String? = nil,
        freshness: Int? = nil
    ) {
        self.cardId = cardId
        self.change = change
        self.revision = revision
        self.freshness = freshness
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case change = "change"
        case revision = "revision"
        case freshness = "freshness"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let change = try container.decode(CardChange.self, forKey: .change)
        let revision = try container.decodeIfPresent(String.self, forKey: .revision)
        let freshness = try container.decodeIfPresent(Int.self, forKey: .freshness)
        self.init(
            cardId: cardId,
            change: change,
            revision: revision,
            freshness: freshness
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(change, forKey: .change)
        try container.encodeIfPresent(revision, forKey: .revision)
        try container.encodeIfPresent(freshness, forKey: .freshness)
    }
}

// MARK: - CardCreateRequest

public struct CardCreateRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardCreateRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.create",
        payload: CardCreateRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardCreateRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardCreateRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.create" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardCreateRequest.type 必須是 card.create")
        }
        let payload = try container.decode(CardCreateRequestPayload.self, forKey: .payload)
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

// MARK: - CardCreateRequestPayload

public struct CardCreateRequestPayload: Codable, Equatable, Sendable {
    public let kind: CardKind
    public let title: String
    public let body: String
    public let summary: String?
    public let tags: [String]?
    public let persona: String?
    public let sources: [String]?
    public let supersedes: String?
    public let assetBlobId: String?
    public let clientRequestId: String

    public init(
        kind: CardKind,
        title: String,
        body: String,
        summary: String? = nil,
        tags: [String]? = nil,
        persona: String? = nil,
        sources: [String]? = nil,
        supersedes: String? = nil,
        assetBlobId: String? = nil,
        clientRequestId: String
    ) {
        self.kind = kind
        self.title = title
        self.body = body
        self.summary = summary
        self.tags = tags
        self.persona = persona
        self.sources = sources
        self.supersedes = supersedes
        self.assetBlobId = assetBlobId
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case kind = "kind"
        case title = "title"
        case body = "body"
        case summary = "summary"
        case tags = "tags"
        case persona = "persona"
        case sources = "sources"
        case supersedes = "supersedes"
        case assetBlobId = "assetBlobId"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(CardKind.self, forKey: .kind)
        let title = try container.decode(String.self, forKey: .title)
        let body = try container.decode(String.self, forKey: .body)
        let summary = try container.decodeIfPresent(String.self, forKey: .summary)
        let tags = try container.decodeIfPresent([String].self, forKey: .tags)
        let persona = try container.decodeIfPresent(String.self, forKey: .persona)
        let sources = try container.decodeIfPresent([String].self, forKey: .sources)
        let supersedes = try container.decodeIfPresent(String.self, forKey: .supersedes)
        let assetBlobId = try container.decodeIfPresent(String.self, forKey: .assetBlobId)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            kind: kind,
            title: title,
            body: body,
            summary: summary,
            tags: tags,
            persona: persona,
            sources: sources,
            supersedes: supersedes,
            assetBlobId: assetBlobId,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(title, forKey: .title)
        try container.encode(body, forKey: .body)
        try container.encodeIfPresent(summary, forKey: .summary)
        try container.encodeIfPresent(tags, forKey: .tags)
        try container.encodeIfPresent(persona, forKey: .persona)
        try container.encodeIfPresent(sources, forKey: .sources)
        try container.encodeIfPresent(supersedes, forKey: .supersedes)
        try container.encodeIfPresent(assetBlobId, forKey: .assetBlobId)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - CardCreateResponse

public struct CardCreateResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardCreateResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.create",
        payload: CardCreateResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardCreateResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardCreateResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.create" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardCreateResponse.type 必須是 card.create")
        }
        let payload = try container.decode(CardCreateResponsePayload.self, forKey: .payload)
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

// MARK: - CardCreateResponsePayload

public struct CardCreateResponsePayload: Codable, Equatable, Sendable {
    public let card: CardSummary

    public init(
        card: CardSummary
    ) {
        self.card = card
    }

    private enum CodingKeys: String, CodingKey {
        case card = "card"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let card = try container.decode(CardSummary.self, forKey: .card)
        self.init(
            card: card
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(card, forKey: .card)
    }
}

// MARK: - CardDeleteRequest

public struct CardDeleteRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardDeleteRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.delete",
        payload: CardDeleteRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardDeleteRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardDeleteRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.delete" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardDeleteRequest.type 必須是 card.delete")
        }
        let payload = try container.decode(CardDeleteRequestPayload.self, forKey: .payload)
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

// MARK: - CardDeleteRequestPayload

public struct CardDeleteRequestPayload: Codable, Equatable, Sendable {
    public let cardId: String
    public let clientRequestId: String

    public init(
        cardId: String,
        clientRequestId: String
    ) {
        self.cardId = cardId
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            cardId: cardId,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - CardDeleteResponse

public struct CardDeleteResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardDeleteResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.delete",
        payload: CardDeleteResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardDeleteResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardDeleteResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.delete" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardDeleteResponse.type 必須是 card.delete")
        }
        let payload = try container.decode(CardDeleteResponsePayload.self, forKey: .payload)
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

// MARK: - CardDeleteResponsePayload

public struct CardDeleteResponsePayload: Codable, Equatable, Sendable {
    public let cardId: String
    public let deletedAssets: Int

    public init(
        cardId: String,
        deletedAssets: Int
    ) {
        self.cardId = cardId
        self.deletedAssets = deletedAssets
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case deletedAssets = "deletedAssets"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let deletedAssets = try container.decode(Int.self, forKey: .deletedAssets)
        self.init(
            cardId: cardId,
            deletedAssets: deletedAssets
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(deletedAssets, forKey: .deletedAssets)
    }
}

// MARK: - CardGetRequest

public struct CardGetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardGetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.get",
        payload: CardGetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardGetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardGetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardGetRequest.type 必須是 card.get")
        }
        let payload = try container.decode(CardGetRequestPayload.self, forKey: .payload)
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

// MARK: - CardGetRequestPayload

public struct CardGetRequestPayload: Codable, Equatable, Sendable {
    public let cardId: String

    public init(
        cardId: String
    ) {
        self.cardId = cardId
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        self.init(
            cardId: cardId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
    }
}

// MARK: - CardGetResponse

public struct CardGetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardGetResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.get",
        payload: CardGetResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardGetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardGetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardGetResponse.type 必須是 card.get")
        }
        let payload = try container.decode(CardGetResponsePayload.self, forKey: .payload)
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

// MARK: - CardGetResponsePayload

public struct CardGetResponsePayload: Codable, Equatable, Sendable {
    public let card: Card

    public init(
        card: Card
    ) {
        self.card = card
    }

    private enum CodingKeys: String, CodingKey {
        case card = "card"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let card = try container.decode(Card.self, forKey: .card)
        self.init(
            card: card
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(card, forKey: .card)
    }
}

// MARK: - CardKind

public enum CardKind: String, Codable, Equatable, Sendable, CaseIterable {
    case note = "note"
    case image = "image"
    case audio = "audio"
    case memory = "memory"
    case summary = "summary"
    case persona = "persona"
    case bedrock = "bedrock"
}

// MARK: - CardLifecycle

public enum CardLifecycle: String, Codable, Equatable, Sendable, CaseIterable {
    case live = "live"
    case cold = "cold"
}

// MARK: - CardLifecycleFilter

public enum CardLifecycleFilter: String, Codable, Equatable, Sendable, CaseIterable {
    case live = "live"
    case cold = "cold"
    case all = "all"
}

// MARK: - CardLinks

public struct CardLinks: Codable, Equatable, Sendable {
    public let outgoing: [String]
    public let backlinks: [String]

    public init(
        outgoing: [String],
        backlinks: [String]
    ) {
        self.outgoing = outgoing
        self.backlinks = backlinks
    }

    private enum CodingKeys: String, CodingKey {
        case outgoing = "outgoing"
        case backlinks = "backlinks"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let outgoing = try container.decode([String].self, forKey: .outgoing)
        let backlinks = try container.decode([String].self, forKey: .backlinks)
        self.init(
            outgoing: outgoing,
            backlinks: backlinks
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(outgoing, forKey: .outgoing)
        try container.encode(backlinks, forKey: .backlinks)
    }
}

// MARK: - CardListRequest

public struct CardListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.list",
        payload: CardListRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardListRequest.type 必須是 card.list")
        }
        let payload = try container.decode(CardListRequestPayload.self, forKey: .payload)
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

// MARK: - CardListRequestPayload

public struct CardListRequestPayload: Codable, Equatable, Sendable {
    public let kinds: [CardKind]?
    public let tags: [String]?
    public let persona: String?
    public let lifecycle: CardLifecycleFilter?
    public let query: String?
    public let includeSuperseded: Bool?
    public let cursor: String?
    public let limit: Int?

    public init(
        kinds: [CardKind]? = nil,
        tags: [String]? = nil,
        persona: String? = nil,
        lifecycle: CardLifecycleFilter? = nil,
        query: String? = nil,
        includeSuperseded: Bool? = nil,
        cursor: String? = nil,
        limit: Int? = nil
    ) {
        self.kinds = kinds
        self.tags = tags
        self.persona = persona
        self.lifecycle = lifecycle
        self.query = query
        self.includeSuperseded = includeSuperseded
        self.cursor = cursor
        self.limit = limit
    }

    private enum CodingKeys: String, CodingKey {
        case kinds = "kinds"
        case tags = "tags"
        case persona = "persona"
        case lifecycle = "lifecycle"
        case query = "query"
        case includeSuperseded = "includeSuperseded"
        case cursor = "cursor"
        case limit = "limit"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kinds = try container.decodeIfPresent([CardKind].self, forKey: .kinds)
        let tags = try container.decodeIfPresent([String].self, forKey: .tags)
        let persona = try container.decodeIfPresent(String.self, forKey: .persona)
        let lifecycle = try container.decodeIfPresent(CardLifecycleFilter.self, forKey: .lifecycle)
        let query = try container.decodeIfPresent(String.self, forKey: .query)
        let includeSuperseded = try container.decodeIfPresent(Bool.self, forKey: .includeSuperseded)
        let cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        let limit = try container.decodeIfPresent(Int.self, forKey: .limit)
        self.init(
            kinds: kinds,
            tags: tags,
            persona: persona,
            lifecycle: lifecycle,
            query: query,
            includeSuperseded: includeSuperseded,
            cursor: cursor,
            limit: limit
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(kinds, forKey: .kinds)
        try container.encodeIfPresent(tags, forKey: .tags)
        try container.encodeIfPresent(persona, forKey: .persona)
        try container.encodeIfPresent(lifecycle, forKey: .lifecycle)
        try container.encodeIfPresent(query, forKey: .query)
        try container.encodeIfPresent(includeSuperseded, forKey: .includeSuperseded)
        try container.encodeIfPresent(cursor, forKey: .cursor)
        try container.encodeIfPresent(limit, forKey: .limit)
    }
}

// MARK: - CardListResponse

public struct CardListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.list",
        payload: CardListResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardListResponse.type 必須是 card.list")
        }
        let payload = try container.decode(CardListResponsePayload.self, forKey: .payload)
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

// MARK: - CardListResponsePayload

public struct CardListResponsePayload: Codable, Equatable, Sendable {
    public let cards: [CardSummary]
    public let nextCursor: String?

    public init(
        cards: [CardSummary],
        nextCursor: String? = nil
    ) {
        self.cards = cards
        self.nextCursor = nextCursor
    }

    private enum CodingKeys: String, CodingKey {
        case cards = "cards"
        case nextCursor = "nextCursor"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cards = try container.decode([CardSummary].self, forKey: .cards)
        let nextCursor = try container.decodeIfPresent(String.self, forKey: .nextCursor)
        self.init(
            cards: cards,
            nextCursor: nextCursor
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cards, forKey: .cards)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }
}

// MARK: - CardPatch

public struct CardPatch: Codable, Equatable, Sendable {
    public let format: CardPatchFormat
    public let text: String

    public init(
        format: CardPatchFormat,
        text: String
    ) {
        self.format = format
        self.text = text
    }

    private enum CodingKeys: String, CodingKey {
        case format = "format"
        case text = "text"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let format = try container.decode(CardPatchFormat.self, forKey: .format)
        let text = try container.decode(String.self, forKey: .text)
        self.init(
            format: format,
            text: text
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(format, forKey: .format)
        try container.encode(text, forKey: .text)
    }
}

// MARK: - CardPatchFormat

public enum CardPatchFormat: String, Codable, Equatable, Sendable, CaseIterable {
    case unified = "unified"
    case replace = "replace"
}

// MARK: - CardPatchRequest

public struct CardPatchRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardPatchRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.patch",
        payload: CardPatchRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardPatchRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardPatchRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.patch" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardPatchRequest.type 必須是 card.patch")
        }
        let payload = try container.decode(CardPatchRequestPayload.self, forKey: .payload)
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

// MARK: - CardPatchRequestPayload

public struct CardPatchRequestPayload: Codable, Equatable, Sendable {
    public let cardId: String
    public let baseRevision: String
    public let patch: CardPatch
    public let clientRequestId: String?

    public init(
        cardId: String,
        baseRevision: String,
        patch: CardPatch,
        clientRequestId: String? = nil
    ) {
        self.cardId = cardId
        self.baseRevision = baseRevision
        self.patch = patch
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case baseRevision = "baseRevision"
        case patch = "patch"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let baseRevision = try container.decode(String.self, forKey: .baseRevision)
        let patch = try container.decode(CardPatch.self, forKey: .patch)
        let clientRequestId = try container.decodeIfPresent(String.self, forKey: .clientRequestId)
        self.init(
            cardId: cardId,
            baseRevision: baseRevision,
            patch: patch,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(baseRevision, forKey: .baseRevision)
        try container.encode(patch, forKey: .patch)
        try container.encodeIfPresent(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - CardPatchResponse

public struct CardPatchResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardPatchResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.patch",
        payload: CardPatchResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardPatchResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardPatchResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.patch" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardPatchResponse.type 必須是 card.patch")
        }
        let payload = try container.decode(CardPatchResponsePayload.self, forKey: .payload)
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

// MARK: - CardPatchResponsePayload

public struct CardPatchResponsePayload: Codable, Equatable, Sendable {
    public let card: Card

    public init(
        card: Card
    ) {
        self.card = card
    }

    private enum CodingKeys: String, CodingKey {
        case card = "card"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let card = try container.decode(Card.self, forKey: .card)
        self.init(
            card: card
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(card, forKey: .card)
    }
}

// MARK: - CardRefreshRequest

public struct CardRefreshRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardRefreshRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.refresh",
        payload: CardRefreshRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardRefreshRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardRefreshRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.refresh" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardRefreshRequest.type 必須是 card.refresh")
        }
        let payload = try container.decode(CardRefreshRequestPayload.self, forKey: .payload)
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

// MARK: - CardRefreshRequestPayload

public struct CardRefreshRequestPayload: Codable, Equatable, Sendable {
    public let cardId: String

    public init(
        cardId: String
    ) {
        self.cardId = cardId
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        self.init(
            cardId: cardId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
    }
}

// MARK: - CardRefreshResponse

public struct CardRefreshResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardRefreshResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.refresh",
        payload: CardRefreshResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardRefreshResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardRefreshResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.refresh" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardRefreshResponse.type 必須是 card.refresh")
        }
        let payload = try container.decode(CardRefreshResponsePayload.self, forKey: .payload)
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

// MARK: - CardRefreshResponsePayload

public struct CardRefreshResponsePayload: Codable, Equatable, Sendable {
    public let cardId: String
    public let freshness: Int

    public init(
        cardId: String,
        freshness: Int
    ) {
        self.cardId = cardId
        self.freshness = freshness
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case freshness = "freshness"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let freshness = try container.decode(Int.self, forKey: .freshness)
        self.init(
            cardId: cardId,
            freshness: freshness
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(freshness, forKey: .freshness)
    }
}

// MARK: - CardSearchHit

public struct CardSearchHit: Codable, Equatable, Sendable {
    public let card: CardSummary
    public let score: Double
    public let snippet: String

    public init(
        card: CardSummary,
        score: Double,
        snippet: String
    ) {
        self.card = card
        self.score = score
        self.snippet = snippet
    }

    private enum CodingKeys: String, CodingKey {
        case card = "card"
        case score = "score"
        case snippet = "snippet"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let card = try container.decode(CardSummary.self, forKey: .card)
        let score = try container.decode(Double.self, forKey: .score)
        let snippet = try container.decode(String.self, forKey: .snippet)
        self.init(
            card: card,
            score: score,
            snippet: snippet
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(card, forKey: .card)
        try container.encode(score, forKey: .score)
        try container.encode(snippet, forKey: .snippet)
    }
}

// MARK: - CardSearchRequest

public struct CardSearchRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardSearchRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.search",
        payload: CardSearchRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardSearchRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardSearchRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.search" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardSearchRequest.type 必須是 card.search")
        }
        let payload = try container.decode(CardSearchRequestPayload.self, forKey: .payload)
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

// MARK: - CardSearchRequestPayload

public struct CardSearchRequestPayload: Codable, Equatable, Sendable {
    public let query: String
    public let kinds: [CardKind]?
    public let tags: [String]?
    public let includeSuperseded: Bool?
    public let limit: Int?
    public let cursor: String?

    public init(
        query: String,
        kinds: [CardKind]? = nil,
        tags: [String]? = nil,
        includeSuperseded: Bool? = nil,
        limit: Int? = nil,
        cursor: String? = nil
    ) {
        self.query = query
        self.kinds = kinds
        self.tags = tags
        self.includeSuperseded = includeSuperseded
        self.limit = limit
        self.cursor = cursor
    }

    private enum CodingKeys: String, CodingKey {
        case query = "query"
        case kinds = "kinds"
        case tags = "tags"
        case includeSuperseded = "includeSuperseded"
        case limit = "limit"
        case cursor = "cursor"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let query = try container.decode(String.self, forKey: .query)
        let kinds = try container.decodeIfPresent([CardKind].self, forKey: .kinds)
        let tags = try container.decodeIfPresent([String].self, forKey: .tags)
        let includeSuperseded = try container.decodeIfPresent(Bool.self, forKey: .includeSuperseded)
        let limit = try container.decodeIfPresent(Int.self, forKey: .limit)
        let cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        self.init(
            query: query,
            kinds: kinds,
            tags: tags,
            includeSuperseded: includeSuperseded,
            limit: limit,
            cursor: cursor
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(query, forKey: .query)
        try container.encodeIfPresent(kinds, forKey: .kinds)
        try container.encodeIfPresent(tags, forKey: .tags)
        try container.encodeIfPresent(includeSuperseded, forKey: .includeSuperseded)
        try container.encodeIfPresent(limit, forKey: .limit)
        try container.encodeIfPresent(cursor, forKey: .cursor)
    }
}

// MARK: - CardSearchResponse

public struct CardSearchResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardSearchResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.search",
        payload: CardSearchResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardSearchResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardSearchResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.search" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardSearchResponse.type 必須是 card.search")
        }
        let payload = try container.decode(CardSearchResponsePayload.self, forKey: .payload)
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

// MARK: - CardSearchResponsePayload

public struct CardSearchResponsePayload: Codable, Equatable, Sendable {
    public let hits: [CardSearchHit]
    public let nextCursor: String?

    public init(
        hits: [CardSearchHit],
        nextCursor: String? = nil
    ) {
        self.hits = hits
        self.nextCursor = nextCursor
    }

    private enum CodingKeys: String, CodingKey {
        case hits = "hits"
        case nextCursor = "nextCursor"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let hits = try container.decode([CardSearchHit].self, forKey: .hits)
        let nextCursor = try container.decodeIfPresent(String.self, forKey: .nextCursor)
        self.init(
            hits: hits,
            nextCursor: nextCursor
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(hits, forKey: .hits)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }
}

// MARK: - CardSummary

public struct CardSummary: Codable, Equatable, Sendable {
    public let cardId: String
    public let kind: CardKind
    public let title: String
    public let summary: String?
    public let tags: [String]
    public let persona: String
    public let createdAt: String
    public let updatedAt: String?
    public let freshness: Int
    public let lifecycle: CardLifecycle
    public let supersededBy: String?
    public let asset: CardAsset?
    public let broken: Bool?
    public let brokenReason: String?

    public init(
        cardId: String,
        kind: CardKind,
        title: String,
        summary: String? = nil,
        tags: [String],
        persona: String,
        createdAt: String,
        updatedAt: String? = nil,
        freshness: Int,
        lifecycle: CardLifecycle,
        supersededBy: String? = nil,
        asset: CardAsset? = nil,
        broken: Bool? = nil,
        brokenReason: String? = nil
    ) {
        self.cardId = cardId
        self.kind = kind
        self.title = title
        self.summary = summary
        self.tags = tags
        self.persona = persona
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.freshness = freshness
        self.lifecycle = lifecycle
        self.supersededBy = supersededBy
        self.asset = asset
        self.broken = broken
        self.brokenReason = brokenReason
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case kind = "kind"
        case title = "title"
        case summary = "summary"
        case tags = "tags"
        case persona = "persona"
        case createdAt = "createdAt"
        case updatedAt = "updatedAt"
        case freshness = "freshness"
        case lifecycle = "lifecycle"
        case supersededBy = "supersededBy"
        case asset = "asset"
        case broken = "broken"
        case brokenReason = "brokenReason"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let kind = try container.decode(CardKind.self, forKey: .kind)
        let title = try container.decode(String.self, forKey: .title)
        let summary = try container.decodeIfPresent(String.self, forKey: .summary)
        let tags = try container.decode([String].self, forKey: .tags)
        let persona = try container.decode(String.self, forKey: .persona)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        let freshness = try container.decode(Int.self, forKey: .freshness)
        let lifecycle = try container.decode(CardLifecycle.self, forKey: .lifecycle)
        let supersededBy = try container.decodeIfPresent(String.self, forKey: .supersededBy)
        let asset = try container.decodeIfPresent(CardAsset.self, forKey: .asset)
        let broken = try container.decodeIfPresent(Bool.self, forKey: .broken)
        let brokenReason = try container.decodeIfPresent(String.self, forKey: .brokenReason)
        self.init(
            cardId: cardId,
            kind: kind,
            title: title,
            summary: summary,
            tags: tags,
            persona: persona,
            createdAt: createdAt,
            updatedAt: updatedAt,
            freshness: freshness,
            lifecycle: lifecycle,
            supersededBy: supersededBy,
            asset: asset,
            broken: broken,
            brokenReason: brokenReason
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(kind, forKey: .kind)
        try container.encode(title, forKey: .title)
        try container.encodeIfPresent(summary, forKey: .summary)
        try container.encode(tags, forKey: .tags)
        try container.encode(persona, forKey: .persona)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try container.encode(freshness, forKey: .freshness)
        try container.encode(lifecycle, forKey: .lifecycle)
        try container.encodeIfPresent(supersededBy, forKey: .supersededBy)
        try container.encodeIfPresent(asset, forKey: .asset)
        try container.encodeIfPresent(broken, forKey: .broken)
        try container.encodeIfPresent(brokenReason, forKey: .brokenReason)
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
    case sessionArchiveRequest(SessionArchiveRequest)
    case sessionUnarchiveRequest(SessionUnarchiveRequest)
    case sessionDeletionPreviewRequest(SessionDeletionPreviewRequest)
    case sessionDeleteRequest(SessionDeleteRequest)
    case cardListRequest(CardListRequest)
    case cardGetRequest(CardGetRequest)
    case cardCreateRequest(CardCreateRequest)
    case cardPatchRequest(CardPatchRequest)
    case cardDeleteRequest(CardDeleteRequest)
    case cardSearchRequest(CardSearchRequest)
    case cardRefreshRequest(CardRefreshRequest)
    case mediaImportRequest(MediaImportRequest)
    case contextGetRequest(ContextGetRequest)
    case contextAddCardRequest(ContextAddCardRequest)
    case contextRemoveCardRequest(ContextRemoveCardRequest)
    case contextCompactRequest(ContextCompactRequest)
    case systemSettingsGetRequest(SystemSettingsGetRequest)
    case systemSettingsSetRequest(SystemSettingsSetRequest)
    case systemModulesGetRequest(SystemModulesGetRequest)
    case systemModulesSetEnabledRequest(SystemModulesSetEnabledRequest)
    case systemModelsGetRequest(SystemModelsGetRequest)
    case systemModelsSetRequest(SystemModelsSetRequest)
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
        case .some("session.archive"):
            self = .sessionArchiveRequest(try SessionArchiveRequest(from: decoder))
        case .some("session.unarchive"):
            self = .sessionUnarchiveRequest(try SessionUnarchiveRequest(from: decoder))
        case .some("session.deletion_preview"):
            self = .sessionDeletionPreviewRequest(try SessionDeletionPreviewRequest(from: decoder))
        case .some("session.delete"):
            self = .sessionDeleteRequest(try SessionDeleteRequest(from: decoder))
        case .some("card.list"):
            self = .cardListRequest(try CardListRequest(from: decoder))
        case .some("card.get"):
            self = .cardGetRequest(try CardGetRequest(from: decoder))
        case .some("card.create"):
            self = .cardCreateRequest(try CardCreateRequest(from: decoder))
        case .some("card.patch"):
            self = .cardPatchRequest(try CardPatchRequest(from: decoder))
        case .some("card.delete"):
            self = .cardDeleteRequest(try CardDeleteRequest(from: decoder))
        case .some("card.search"):
            self = .cardSearchRequest(try CardSearchRequest(from: decoder))
        case .some("card.refresh"):
            self = .cardRefreshRequest(try CardRefreshRequest(from: decoder))
        case .some("media.import"):
            self = .mediaImportRequest(try MediaImportRequest(from: decoder))
        case .some("context.get"):
            self = .contextGetRequest(try ContextGetRequest(from: decoder))
        case .some("context.add_card"):
            self = .contextAddCardRequest(try ContextAddCardRequest(from: decoder))
        case .some("context.remove_card"):
            self = .contextRemoveCardRequest(try ContextRemoveCardRequest(from: decoder))
        case .some("context.compact"):
            self = .contextCompactRequest(try ContextCompactRequest(from: decoder))
        case .some("system.settings.get"):
            self = .systemSettingsGetRequest(try SystemSettingsGetRequest(from: decoder))
        case .some("system.settings.set"):
            self = .systemSettingsSetRequest(try SystemSettingsSetRequest(from: decoder))
        case .some("system.modules.get"):
            self = .systemModulesGetRequest(try SystemModulesGetRequest(from: decoder))
        case .some("system.modules.set_enabled"):
            self = .systemModulesSetEnabledRequest(try SystemModulesSetEnabledRequest(from: decoder))
        case .some("system.models.get"):
            self = .systemModelsGetRequest(try SystemModelsGetRequest(from: decoder))
        case .some("system.models.set"):
            self = .systemModelsSetRequest(try SystemModelsSetRequest(from: decoder))
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
        case .sessionArchiveRequest(let value):
            try value.encode(to: encoder)
        case .sessionUnarchiveRequest(let value):
            try value.encode(to: encoder)
        case .sessionDeletionPreviewRequest(let value):
            try value.encode(to: encoder)
        case .sessionDeleteRequest(let value):
            try value.encode(to: encoder)
        case .cardListRequest(let value):
            try value.encode(to: encoder)
        case .cardGetRequest(let value):
            try value.encode(to: encoder)
        case .cardCreateRequest(let value):
            try value.encode(to: encoder)
        case .cardPatchRequest(let value):
            try value.encode(to: encoder)
        case .cardDeleteRequest(let value):
            try value.encode(to: encoder)
        case .cardSearchRequest(let value):
            try value.encode(to: encoder)
        case .cardRefreshRequest(let value):
            try value.encode(to: encoder)
        case .mediaImportRequest(let value):
            try value.encode(to: encoder)
        case .contextGetRequest(let value):
            try value.encode(to: encoder)
        case .contextAddCardRequest(let value):
            try value.encode(to: encoder)
        case .contextRemoveCardRequest(let value):
            try value.encode(to: encoder)
        case .contextCompactRequest(let value):
            try value.encode(to: encoder)
        case .systemSettingsGetRequest(let value):
            try value.encode(to: encoder)
        case .systemSettingsSetRequest(let value):
            try value.encode(to: encoder)
        case .systemModulesGetRequest(let value):
            try value.encode(to: encoder)
        case .systemModulesSetEnabledRequest(let value):
            try value.encode(to: encoder)
        case .systemModelsGetRequest(let value):
            try value.encode(to: encoder)
        case .systemModelsSetRequest(let value):
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

// MARK: - ContextAddCardRequest

public struct ContextAddCardRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: ContextAddCardRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "context.add_card",
        payload: ContextAddCardRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextAddCardRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextAddCardRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.add_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextAddCardRequest.type 必須是 context.add_card")
        }
        let payload = try container.decode(ContextAddCardRequestPayload.self, forKey: .payload)
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

// MARK: - ContextAddCardRequestPayload

public struct ContextAddCardRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let cardId: String

    public init(
        sessionId: String,
        cardId: String
    ) {
        self.sessionId = sessionId
        self.cardId = cardId
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case cardId = "cardId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let cardId = try container.decode(String.self, forKey: .cardId)
        self.init(
            sessionId: sessionId,
            cardId: cardId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(cardId, forKey: .cardId)
    }
}

// MARK: - ContextAddCardResponse

public struct ContextAddCardResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: ContextAddCardResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "context.add_card",
        payload: ContextAddCardResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextAddCardResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextAddCardResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.add_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextAddCardResponse.type 必須是 context.add_card")
        }
        let payload = try container.decode(ContextAddCardResponsePayload.self, forKey: .payload)
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

// MARK: - ContextAddCardResponsePayload

public struct ContextAddCardResponsePayload: Codable, Equatable, Sendable {
    public let context: ContextView

    public init(
        context: ContextView
    ) {
        self.context = context
    }

    private enum CodingKeys: String, CodingKey {
        case context = "context"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let context = try container.decode(ContextView.self, forKey: .context)
        self.init(
            context: context
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(context, forKey: .context)
    }
}

// MARK: - ContextChangedEvent

public struct ContextChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: ContextChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "context.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: ContextChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextChangedEvent.type 必須是 context.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(ContextChangedEventPayload.self, forKey: .payload)
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

// MARK: - ContextChangedEventPayload

public struct ContextChangedEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let context: ContextView

    public init(
        sessionId: String,
        context: ContextView
    ) {
        self.sessionId = sessionId
        self.context = context
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case context = "context"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let context = try container.decode(ContextView.self, forKey: .context)
        self.init(
            sessionId: sessionId,
            context: context
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(context, forKey: .context)
    }
}

// MARK: - ContextCompactRequest

public struct ContextCompactRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: ContextCompactRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "context.compact",
        payload: ContextCompactRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextCompactRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextCompactRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.compact" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextCompactRequest.type 必須是 context.compact")
        }
        let payload = try container.decode(ContextCompactRequestPayload.self, forKey: .payload)
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

// MARK: - ContextCompactRequestPayload

public struct ContextCompactRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let instructions: String?

    public init(
        sessionId: String,
        instructions: String? = nil
    ) {
        self.sessionId = sessionId
        self.instructions = instructions
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case instructions = "instructions"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let instructions = try container.decodeIfPresent(String.self, forKey: .instructions)
        self.init(
            sessionId: sessionId,
            instructions: instructions
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encodeIfPresent(instructions, forKey: .instructions)
    }
}

// MARK: - ContextCompactResponse

public struct ContextCompactResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: ContextCompactResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "context.compact",
        payload: ContextCompactResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextCompactResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextCompactResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.compact" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextCompactResponse.type 必須是 context.compact")
        }
        let payload = try container.decode(ContextCompactResponsePayload.self, forKey: .payload)
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

// MARK: - ContextCompactResponsePayload

public struct ContextCompactResponsePayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let scheduled: Bool

    public init(
        sessionId: String,
        scheduled: Bool
    ) {
        self.sessionId = sessionId
        self.scheduled = scheduled
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case scheduled = "scheduled"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let scheduled = try container.decode(Bool.self, forKey: .scheduled)
        self.init(
            sessionId: sessionId,
            scheduled: scheduled
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(scheduled, forKey: .scheduled)
    }
}

// MARK: - ContextCompactedEvent

public struct ContextCompactedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: ContextCompactedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "context.compacted",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: ContextCompactedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextCompactedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextCompactedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.compacted" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextCompactedEvent.type 必須是 context.compacted")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(ContextCompactedEventPayload.self, forKey: .payload)
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

// MARK: - ContextCompactedEventPayload

public struct ContextCompactedEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let summaryCardId: String
    public let beforeTokens: Int
    public let afterTokens: Int
    public let compactedAt: String

    public init(
        sessionId: String,
        summaryCardId: String,
        beforeTokens: Int,
        afterTokens: Int,
        compactedAt: String
    ) {
        self.sessionId = sessionId
        self.summaryCardId = summaryCardId
        self.beforeTokens = beforeTokens
        self.afterTokens = afterTokens
        self.compactedAt = compactedAt
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case summaryCardId = "summaryCardId"
        case beforeTokens = "beforeTokens"
        case afterTokens = "afterTokens"
        case compactedAt = "compactedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let summaryCardId = try container.decode(String.self, forKey: .summaryCardId)
        let beforeTokens = try container.decode(Int.self, forKey: .beforeTokens)
        let afterTokens = try container.decode(Int.self, forKey: .afterTokens)
        let compactedAt = try container.decode(String.self, forKey: .compactedAt)
        self.init(
            sessionId: sessionId,
            summaryCardId: summaryCardId,
            beforeTokens: beforeTokens,
            afterTokens: afterTokens,
            compactedAt: compactedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(summaryCardId, forKey: .summaryCardId)
        try container.encode(beforeTokens, forKey: .beforeTokens)
        try container.encode(afterTokens, forKey: .afterTokens)
        try container.encode(compactedAt, forKey: .compactedAt)
    }
}

// MARK: - ContextEntry

public struct ContextEntry: Codable, Equatable, Sendable {
    public let entryId: String
    public let layer: ContextLayer
    public let cardId: String?
    public let title: String
    public let tokenEstimate: Int
    public let state: ContextEntryState
    public let position: Int

    public init(
        entryId: String,
        layer: ContextLayer,
        cardId: String? = nil,
        title: String,
        tokenEstimate: Int,
        state: ContextEntryState,
        position: Int
    ) {
        self.entryId = entryId
        self.layer = layer
        self.cardId = cardId
        self.title = title
        self.tokenEstimate = tokenEstimate
        self.state = state
        self.position = position
    }

    private enum CodingKeys: String, CodingKey {
        case entryId = "entryId"
        case layer = "layer"
        case cardId = "cardId"
        case title = "title"
        case tokenEstimate = "tokenEstimate"
        case state = "state"
        case position = "position"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let entryId = try container.decode(String.self, forKey: .entryId)
        let layer = try container.decode(ContextLayer.self, forKey: .layer)
        let cardId = try container.decodeIfPresent(String.self, forKey: .cardId)
        let title = try container.decode(String.self, forKey: .title)
        let tokenEstimate = try container.decode(Int.self, forKey: .tokenEstimate)
        let state = try container.decode(ContextEntryState.self, forKey: .state)
        let position = try container.decode(Int.self, forKey: .position)
        self.init(
            entryId: entryId,
            layer: layer,
            cardId: cardId,
            title: title,
            tokenEstimate: tokenEstimate,
            state: state,
            position: position
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(entryId, forKey: .entryId)
        try container.encode(layer, forKey: .layer)
        try container.encodeIfPresent(cardId, forKey: .cardId)
        try container.encode(title, forKey: .title)
        try container.encode(tokenEstimate, forKey: .tokenEstimate)
        try container.encode(state, forKey: .state)
        try container.encode(position, forKey: .position)
    }
}

// MARK: - ContextEntryState

public enum ContextEntryState: String, Codable, Equatable, Sendable, CaseIterable {
    case active = "active"
    case pendingRemoval = "pending-removal"
}

// MARK: - ContextGetRequest

public struct ContextGetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: ContextGetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "context.get",
        payload: ContextGetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextGetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextGetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextGetRequest.type 必須是 context.get")
        }
        let payload = try container.decode(ContextGetRequestPayload.self, forKey: .payload)
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

// MARK: - ContextGetRequestPayload

public struct ContextGetRequestPayload: Codable, Equatable, Sendable {
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

// MARK: - ContextGetResponse

public struct ContextGetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: ContextGetResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "context.get",
        payload: ContextGetResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextGetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextGetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextGetResponse.type 必須是 context.get")
        }
        let payload = try container.decode(ContextGetResponsePayload.self, forKey: .payload)
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

// MARK: - ContextGetResponsePayload

public struct ContextGetResponsePayload: Codable, Equatable, Sendable {
    public let context: ContextView

    public init(
        context: ContextView
    ) {
        self.context = context
    }

    private enum CodingKeys: String, CodingKey {
        case context = "context"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let context = try container.decode(ContextView.self, forKey: .context)
        self.init(
            context: context
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(context, forKey: .context)
    }
}

// MARK: - ContextLayer

public enum ContextLayer: String, Codable, Equatable, Sendable, CaseIterable {
    case bedrock = "bedrock"
    case persona = "persona"
    case coreMemory = "core-memory"
    case openingMemory = "opening-memory"
    case shortTermMemory = "short-term-memory"
    case otherCards = "other-cards"
    case workingContext = "working-context"
    case volatileState = "volatile-state"
}

// MARK: - ContextRemoveCardRequest

public struct ContextRemoveCardRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: ContextRemoveCardRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "context.remove_card",
        payload: ContextRemoveCardRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextRemoveCardRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextRemoveCardRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.remove_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextRemoveCardRequest.type 必須是 context.remove_card")
        }
        let payload = try container.decode(ContextRemoveCardRequestPayload.self, forKey: .payload)
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

// MARK: - ContextRemoveCardRequestPayload

public struct ContextRemoveCardRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let cardId: String

    public init(
        sessionId: String,
        cardId: String
    ) {
        self.sessionId = sessionId
        self.cardId = cardId
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case cardId = "cardId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let cardId = try container.decode(String.self, forKey: .cardId)
        self.init(
            sessionId: sessionId,
            cardId: cardId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(cardId, forKey: .cardId)
    }
}

// MARK: - ContextRemoveCardResponse

public struct ContextRemoveCardResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: ContextRemoveCardResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "context.remove_card",
        payload: ContextRemoveCardResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "ContextRemoveCardResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "ContextRemoveCardResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "context.remove_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "ContextRemoveCardResponse.type 必須是 context.remove_card")
        }
        let payload = try container.decode(ContextRemoveCardResponsePayload.self, forKey: .payload)
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

// MARK: - ContextRemoveCardResponsePayload

public struct ContextRemoveCardResponsePayload: Codable, Equatable, Sendable {
    public let context: ContextView

    public init(
        context: ContextView
    ) {
        self.context = context
    }

    private enum CodingKeys: String, CodingKey {
        case context = "context"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let context = try container.decode(ContextView.self, forKey: .context)
        self.init(
            context: context
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(context, forKey: .context)
    }
}

// MARK: - ContextView

public struct ContextView: Codable, Equatable, Sendable {
    public let sessionId: String
    public let version: Int
    public let entries: [ContextEntry]
    public let usedTokens: Int
    public let budgetTokens: Int
    public let contextWindow: Int
    public let compactionThreshold: Double
    public let lastCompactedAt: String?

    public init(
        sessionId: String,
        version: Int,
        entries: [ContextEntry],
        usedTokens: Int,
        budgetTokens: Int,
        contextWindow: Int,
        compactionThreshold: Double,
        lastCompactedAt: String? = nil
    ) {
        self.sessionId = sessionId
        self.version = version
        self.entries = entries
        self.usedTokens = usedTokens
        self.budgetTokens = budgetTokens
        self.contextWindow = contextWindow
        self.compactionThreshold = compactionThreshold
        self.lastCompactedAt = lastCompactedAt
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case version = "version"
        case entries = "entries"
        case usedTokens = "usedTokens"
        case budgetTokens = "budgetTokens"
        case contextWindow = "contextWindow"
        case compactionThreshold = "compactionThreshold"
        case lastCompactedAt = "lastCompactedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let version = try container.decode(Int.self, forKey: .version)
        let entries = try container.decode([ContextEntry].self, forKey: .entries)
        let usedTokens = try container.decode(Int.self, forKey: .usedTokens)
        let budgetTokens = try container.decode(Int.self, forKey: .budgetTokens)
        let contextWindow = try container.decode(Int.self, forKey: .contextWindow)
        let compactionThreshold = try container.decode(Double.self, forKey: .compactionThreshold)
        let lastCompactedAt = try container.decodeIfPresent(String.self, forKey: .lastCompactedAt)
        self.init(
            sessionId: sessionId,
            version: version,
            entries: entries,
            usedTokens: usedTokens,
            budgetTokens: budgetTokens,
            contextWindow: contextWindow,
            compactionThreshold: compactionThreshold,
            lastCompactedAt: lastCompactedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(version, forKey: .version)
        try container.encode(entries, forKey: .entries)
        try container.encode(usedTokens, forKey: .usedTokens)
        try container.encode(budgetTokens, forKey: .budgetTokens)
        try container.encode(contextWindow, forKey: .contextWindow)
        try container.encode(compactionThreshold, forKey: .compactionThreshold)
        try container.encodeIfPresent(lastCompactedAt, forKey: .lastCompactedAt)
    }
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
    case steer = "steer"
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

// MARK: - MediaImportRequest

public struct MediaImportRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: MediaImportRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "media.import",
        payload: MediaImportRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "MediaImportRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "MediaImportRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "media.import" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "MediaImportRequest.type 必須是 media.import")
        }
        let payload = try container.decode(MediaImportRequestPayload.self, forKey: .payload)
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

// MARK: - MediaImportRequestPayload

public struct MediaImportRequestPayload: Codable, Equatable, Sendable {
    public let blobId: String
    public let locale: String?
    public let ocrLocales: [String]?
    public let title: String?
    public let tags: [String]?
    public let persona: String?

    public init(
        blobId: String,
        locale: String? = nil,
        ocrLocales: [String]? = nil,
        title: String? = nil,
        tags: [String]? = nil,
        persona: String? = nil
    ) {
        self.blobId = blobId
        self.locale = locale
        self.ocrLocales = ocrLocales
        self.title = title
        self.tags = tags
        self.persona = persona
    }

    private enum CodingKeys: String, CodingKey {
        case blobId = "blobId"
        case locale = "locale"
        case ocrLocales = "ocrLocales"
        case title = "title"
        case tags = "tags"
        case persona = "persona"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let blobId = try container.decode(String.self, forKey: .blobId)
        let locale = try container.decodeIfPresent(String.self, forKey: .locale)
        let ocrLocales = try container.decodeIfPresent([String].self, forKey: .ocrLocales)
        let title = try container.decodeIfPresent(String.self, forKey: .title)
        let tags = try container.decodeIfPresent([String].self, forKey: .tags)
        let persona = try container.decodeIfPresent(String.self, forKey: .persona)
        self.init(
            blobId: blobId,
            locale: locale,
            ocrLocales: ocrLocales,
            title: title,
            tags: tags,
            persona: persona
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(blobId, forKey: .blobId)
        try container.encodeIfPresent(locale, forKey: .locale)
        try container.encodeIfPresent(ocrLocales, forKey: .ocrLocales)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(tags, forKey: .tags)
        try container.encodeIfPresent(persona, forKey: .persona)
    }
}

// MARK: - MediaImportResponse

public struct MediaImportResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: MediaImportResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "media.import",
        payload: MediaImportResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "MediaImportResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "MediaImportResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "media.import" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "MediaImportResponse.type 必須是 media.import")
        }
        let payload = try container.decode(MediaImportResponsePayload.self, forKey: .payload)
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

// MARK: - MediaImportResponsePayload

public struct MediaImportResponsePayload: Codable, Equatable, Sendable {
    public let cardId: String
    public let kind: MediaKind
    public let textStandIn: MediaTextStandIn
    public let deduped: Bool

    public init(
        cardId: String,
        kind: MediaKind,
        textStandIn: MediaTextStandIn,
        deduped: Bool
    ) {
        self.cardId = cardId
        self.kind = kind
        self.textStandIn = textStandIn
        self.deduped = deduped
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case kind = "kind"
        case textStandIn = "textStandIn"
        case deduped = "deduped"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let kind = try container.decode(MediaKind.self, forKey: .kind)
        let textStandIn = try container.decode(MediaTextStandIn.self, forKey: .textStandIn)
        let deduped = try container.decode(Bool.self, forKey: .deduped)
        self.init(
            cardId: cardId,
            kind: kind,
            textStandIn: textStandIn,
            deduped: deduped
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(kind, forKey: .kind)
        try container.encode(textStandIn, forKey: .textStandIn)
        try container.encode(deduped, forKey: .deduped)
    }
}

// MARK: - MediaKind

public enum MediaKind: String, Codable, Equatable, Sendable, CaseIterable {
    case image = "image"
    case audio = "audio"
}

// MARK: - MediaLocalTextSource

public enum MediaLocalTextSource: String, Codable, Equatable, Sendable, CaseIterable {
    case local = "local"
    case none = "none"
}

// MARK: - MediaModelTextSource

public enum MediaModelTextSource: String, Codable, Equatable, Sendable, CaseIterable {
    case smallModel = "small-model"
    case none = "none"
}

// MARK: - MediaTextStandIn

public struct MediaTextStandIn: Codable, Equatable, Sendable {
    public let sources: MediaTextStandInSources
    public let missingParts: [String]

    public init(
        sources: MediaTextStandInSources,
        missingParts: [String]
    ) {
        self.sources = sources
        self.missingParts = missingParts
    }

    private enum CodingKeys: String, CodingKey {
        case sources = "sources"
        case missingParts = "missingParts"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sources = try container.decode(MediaTextStandInSources.self, forKey: .sources)
        let missingParts = try container.decode([String].self, forKey: .missingParts)
        self.init(
            sources: sources,
            missingParts: missingParts
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sources, forKey: .sources)
        try container.encode(missingParts, forKey: .missingParts)
    }
}

// MARK: - MediaTextStandInSources

public struct MediaTextStandInSources: Codable, Equatable, Sendable {
    public let ocr: MediaLocalTextSource
    public let description: MediaModelTextSource
    public let transcript: MediaLocalTextSource
    public let summary: MediaModelTextSource

    public init(
        ocr: MediaLocalTextSource,
        description: MediaModelTextSource,
        transcript: MediaLocalTextSource,
        summary: MediaModelTextSource
    ) {
        self.ocr = ocr
        self.description = description
        self.transcript = transcript
        self.summary = summary
    }

    private enum CodingKeys: String, CodingKey {
        case ocr = "ocr"
        case description = "description"
        case transcript = "transcript"
        case summary = "summary"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ocr = try container.decode(MediaLocalTextSource.self, forKey: .ocr)
        let description = try container.decode(MediaModelTextSource.self, forKey: .description)
        let transcript = try container.decode(MediaLocalTextSource.self, forKey: .transcript)
        let summary = try container.decode(MediaModelTextSource.self, forKey: .summary)
        self.init(
            ocr: ocr,
            description: description,
            transcript: transcript,
            summary: summary
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(ocr, forKey: .ocr)
        try container.encode(description, forKey: .description)
        try container.encode(transcript, forKey: .transcript)
        try container.encode(summary, forKey: .summary)
    }
}

// MARK: - MessageStatus

public enum MessageStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case streaming = "streaming"
    case complete = "complete"
    case interrupted = "interrupted"
    case failed = "failed"
}

// MARK: - ModelInfo

public struct ModelInfo: Codable, Equatable, Sendable {
    public let modelId: String
    public let displayName: String?
    public let contextWindow: Int
    public let maxOutputTokens: Int?
    public let input: [ModelInputKind]

    public init(
        modelId: String,
        displayName: String? = nil,
        contextWindow: Int,
        maxOutputTokens: Int? = nil,
        input: [ModelInputKind]
    ) {
        self.modelId = modelId
        self.displayName = displayName
        self.contextWindow = contextWindow
        self.maxOutputTokens = maxOutputTokens
        self.input = input
    }

    private enum CodingKeys: String, CodingKey {
        case modelId = "modelId"
        case displayName = "displayName"
        case contextWindow = "contextWindow"
        case maxOutputTokens = "maxOutputTokens"
        case input = "input"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let modelId = try container.decode(String.self, forKey: .modelId)
        let displayName = try container.decodeIfPresent(String.self, forKey: .displayName)
        let contextWindow = try container.decode(Int.self, forKey: .contextWindow)
        let maxOutputTokens = try container.decodeIfPresent(Int.self, forKey: .maxOutputTokens)
        let input = try container.decode([ModelInputKind].self, forKey: .input)
        self.init(
            modelId: modelId,
            displayName: displayName,
            contextWindow: contextWindow,
            maxOutputTokens: maxOutputTokens,
            input: input
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(modelId, forKey: .modelId)
        try container.encodeIfPresent(displayName, forKey: .displayName)
        try container.encode(contextWindow, forKey: .contextWindow)
        try container.encodeIfPresent(maxOutputTokens, forKey: .maxOutputTokens)
        try container.encode(input, forKey: .input)
    }
}

// MARK: - ModelInputKind

public enum ModelInputKind: String, Codable, Equatable, Sendable, CaseIterable {
    case text = "text"
    case image = "image"
    case audio = "audio"
}

// MARK: - ModelProviderInfo

public struct ModelProviderInfo: Codable, Equatable, Sendable {
    public let providerId: String
    public let kind: ModelProviderKind
    public let displayName: String
    public let baseUrl: String?
    public let credentialRef: String?
    public let models: [ModelInfo]

    public init(
        providerId: String,
        kind: ModelProviderKind,
        displayName: String,
        baseUrl: String? = nil,
        credentialRef: String? = nil,
        models: [ModelInfo]
    ) {
        self.providerId = providerId
        self.kind = kind
        self.displayName = displayName
        self.baseUrl = baseUrl
        self.credentialRef = credentialRef
        self.models = models
    }

    private enum CodingKeys: String, CodingKey {
        case providerId = "providerId"
        case kind = "kind"
        case displayName = "displayName"
        case baseUrl = "baseUrl"
        case credentialRef = "credentialRef"
        case models = "models"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let providerId = try container.decode(String.self, forKey: .providerId)
        let kind = try container.decode(ModelProviderKind.self, forKey: .kind)
        let displayName = try container.decode(String.self, forKey: .displayName)
        let baseUrl = try container.decodeIfPresent(String.self, forKey: .baseUrl)
        let credentialRef = try container.decodeIfPresent(String.self, forKey: .credentialRef)
        let models = try container.decode([ModelInfo].self, forKey: .models)
        self.init(
            providerId: providerId,
            kind: kind,
            displayName: displayName,
            baseUrl: baseUrl,
            credentialRef: credentialRef,
            models: models
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(providerId, forKey: .providerId)
        try container.encode(kind, forKey: .kind)
        try container.encode(displayName, forKey: .displayName)
        try container.encodeIfPresent(baseUrl, forKey: .baseUrl)
        try container.encodeIfPresent(credentialRef, forKey: .credentialRef)
        try container.encode(models, forKey: .models)
    }
}

// MARK: - ModelProviderKind

public enum ModelProviderKind: String, Codable, Equatable, Sendable, CaseIterable {
    case apiKey = "api-key"
    case aggregator = "aggregator"
    case local = "local"
}

// MARK: - ModelRef

public struct ModelRef: Codable, Equatable, Sendable {
    public let providerId: String
    public let modelId: String

    public init(
        providerId: String,
        modelId: String
    ) {
        self.providerId = providerId
        self.modelId = modelId
    }

    private enum CodingKeys: String, CodingKey {
        case providerId = "providerId"
        case modelId = "modelId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let providerId = try container.decode(String.self, forKey: .providerId)
        let modelId = try container.decode(String.self, forKey: .modelId)
        self.init(
            providerId: providerId,
            modelId: modelId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(providerId, forKey: .providerId)
        try container.encode(modelId, forKey: .modelId)
    }
}

// MARK: - ModelRole

public enum ModelRole: String, Codable, Equatable, Sendable, CaseIterable {
    case main = "main"
    case small = "small"
    case writing = "writing"
    case systemOne = "system-one"
}

// MARK: - ModelRoleMode

public enum ModelRoleMode: String, Codable, Equatable, Sendable, CaseIterable {
    case model = "model"
    case unset = "unset"
    case none = "none"
}

// MARK: - ModelRoleSelection

public struct ModelRoleSelection: Codable, Equatable, Sendable {
    public let role: ModelRole
    public let mode: ModelRoleMode
    public let ref: ModelRef?

    public init(
        role: ModelRole,
        mode: ModelRoleMode,
        ref: ModelRef? = nil
    ) {
        self.role = role
        self.mode = mode
        self.ref = ref
    }

    private enum CodingKeys: String, CodingKey {
        case role = "role"
        case mode = "mode"
        case ref = "ref"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let role = try container.decode(ModelRole.self, forKey: .role)
        let mode = try container.decode(ModelRoleMode.self, forKey: .mode)
        let ref = try container.decodeIfPresent(ModelRef.self, forKey: .ref)
        self.init(
            role: role,
            mode: mode,
            ref: ref
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(role, forKey: .role)
        try container.encode(mode, forKey: .mode)
        try container.encodeIfPresent(ref, forKey: .ref)
    }
}

// MARK: - ModelRoleSource

public enum ModelRoleSource: String, Codable, Equatable, Sendable, CaseIterable {
    case configured = "configured"
    case fallbackMain = "fallback-main"
    case fallbackSmall = "fallback-small"
    case none = "none"
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

// MARK: - ModuleInfo

public struct ModuleInfo: Codable, Equatable, Sendable {
    public let moduleId: String
    public let name: String
    public let version: String
    public let enabled: Bool
    public let state: ModuleState
    public let failure: String?
    public let protocolPrefixes: [String]
    public let settings: [ModuleSettingDeclaration]

    public init(
        moduleId: String,
        name: String,
        version: String,
        enabled: Bool,
        state: ModuleState,
        failure: String? = nil,
        protocolPrefixes: [String],
        settings: [ModuleSettingDeclaration]
    ) {
        self.moduleId = moduleId
        self.name = name
        self.version = version
        self.enabled = enabled
        self.state = state
        self.failure = failure
        self.protocolPrefixes = protocolPrefixes
        self.settings = settings
    }

    private enum CodingKeys: String, CodingKey {
        case moduleId = "moduleId"
        case name = "name"
        case version = "version"
        case enabled = "enabled"
        case state = "state"
        case failure = "failure"
        case protocolPrefixes = "protocolPrefixes"
        case settings = "settings"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let moduleId = try container.decode(String.self, forKey: .moduleId)
        let name = try container.decode(String.self, forKey: .name)
        let version = try container.decode(String.self, forKey: .version)
        let enabled = try container.decode(Bool.self, forKey: .enabled)
        let state = try container.decode(ModuleState.self, forKey: .state)
        let failure = try container.decodeIfPresent(String.self, forKey: .failure)
        let protocolPrefixes = try container.decode([String].self, forKey: .protocolPrefixes)
        let settings = try container.decode([ModuleSettingDeclaration].self, forKey: .settings)
        self.init(
            moduleId: moduleId,
            name: name,
            version: version,
            enabled: enabled,
            state: state,
            failure: failure,
            protocolPrefixes: protocolPrefixes,
            settings: settings
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(moduleId, forKey: .moduleId)
        try container.encode(name, forKey: .name)
        try container.encode(version, forKey: .version)
        try container.encode(enabled, forKey: .enabled)
        try container.encode(state, forKey: .state)
        try container.encodeIfPresent(failure, forKey: .failure)
        try container.encode(protocolPrefixes, forKey: .protocolPrefixes)
        try container.encode(settings, forKey: .settings)
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

// MARK: - ModuleSettingDeclaration

public struct ModuleSettingDeclaration: Codable, Equatable, Sendable {
    public let key: String
    public let title: String
    public let kind: SettingKind
    public let level: SettingLevel
    public let description: String?

    public init(
        key: String,
        title: String,
        kind: SettingKind,
        level: SettingLevel,
        description: String? = nil
    ) {
        self.key = key
        self.title = title
        self.kind = kind
        self.level = level
        self.description = description
    }

    private enum CodingKeys: String, CodingKey {
        case key = "key"
        case title = "title"
        case kind = "kind"
        case level = "level"
        case description = "description"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let key = try container.decode(String.self, forKey: .key)
        let title = try container.decode(String.self, forKey: .title)
        let kind = try container.decode(SettingKind.self, forKey: .kind)
        let level = try container.decode(SettingLevel.self, forKey: .level)
        let description = try container.decodeIfPresent(String.self, forKey: .description)
        self.init(
            key: key,
            title: title,
            kind: kind,
            level: level,
            description: description
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(key, forKey: .key)
        try container.encode(title, forKey: .title)
        try container.encode(kind, forKey: .kind)
        try container.encode(level, forKey: .level)
        try container.encodeIfPresent(description, forKey: .description)
    }
}

// MARK: - ModuleState

public enum ModuleState: String, Codable, Equatable, Sendable, CaseIterable {
    case loaded = "loaded"
    case active = "active"
    case inactive = "inactive"
    case failed = "failed"
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

// MARK: - ResolvedModelRole

public struct ResolvedModelRole: Codable, Equatable, Sendable {
    public let role: ModelRole
    public let source: ModelRoleSource
    public let ref: ModelRef?

    public init(
        role: ModelRole,
        source: ModelRoleSource,
        ref: ModelRef? = nil
    ) {
        self.role = role
        self.source = source
        self.ref = ref
    }

    private enum CodingKeys: String, CodingKey {
        case role = "role"
        case source = "source"
        case ref = "ref"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let role = try container.decode(ModelRole.self, forKey: .role)
        let source = try container.decode(ModelRoleSource.self, forKey: .source)
        let ref = try container.decodeIfPresent(ModelRef.self, forKey: .ref)
        self.init(
            role: role,
            source: source,
            ref: ref
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(role, forKey: .role)
        try container.encode(source, forKey: .source)
        try container.encodeIfPresent(ref, forKey: .ref)
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
    public let cards: Bool?
    public let context: Bool?
    public let archive: Bool?
    public let media: Bool?
    public let blobs: Bool?

    public init(
        modules: Bool,
        files: Bool,
        cards: Bool? = nil,
        context: Bool? = nil,
        archive: Bool? = nil,
        media: Bool? = nil,
        blobs: Bool? = nil
    ) {
        self.modules = modules
        self.files = files
        self.cards = cards
        self.context = context
        self.archive = archive
        self.media = media
        self.blobs = blobs
    }

    private enum CodingKeys: String, CodingKey {
        case modules = "modules"
        case files = "files"
        case cards = "cards"
        case context = "context"
        case archive = "archive"
        case media = "media"
        case blobs = "blobs"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let modules = try container.decode(Bool.self, forKey: .modules)
        let files = try container.decode(Bool.self, forKey: .files)
        let cards = try container.decodeIfPresent(Bool.self, forKey: .cards)
        let context = try container.decodeIfPresent(Bool.self, forKey: .context)
        let archive = try container.decodeIfPresent(Bool.self, forKey: .archive)
        let media = try container.decodeIfPresent(Bool.self, forKey: .media)
        let blobs = try container.decodeIfPresent(Bool.self, forKey: .blobs)
        self.init(
            modules: modules,
            files: files,
            cards: cards,
            context: context,
            archive: archive,
            media: media,
            blobs: blobs
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(modules, forKey: .modules)
        try container.encode(files, forKey: .files)
        try container.encodeIfPresent(cards, forKey: .cards)
        try container.encodeIfPresent(context, forKey: .context)
        try container.encodeIfPresent(archive, forKey: .archive)
        try container.encodeIfPresent(media, forKey: .media)
        try container.encodeIfPresent(blobs, forKey: .blobs)
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
    case sessionArchiveResponse(SessionArchiveResponse)
    case sessionUnarchiveResponse(SessionUnarchiveResponse)
    case sessionDeletionPreviewResponse(SessionDeletionPreviewResponse)
    case sessionDeleteResponse(SessionDeleteResponse)
    case cardListResponse(CardListResponse)
    case cardGetResponse(CardGetResponse)
    case cardCreateResponse(CardCreateResponse)
    case cardPatchResponse(CardPatchResponse)
    case cardDeleteResponse(CardDeleteResponse)
    case cardSearchResponse(CardSearchResponse)
    case cardRefreshResponse(CardRefreshResponse)
    case mediaImportResponse(MediaImportResponse)
    case contextGetResponse(ContextGetResponse)
    case contextAddCardResponse(ContextAddCardResponse)
    case contextRemoveCardResponse(ContextRemoveCardResponse)
    case contextCompactResponse(ContextCompactResponse)
    case systemSettingsGetResponse(SystemSettingsGetResponse)
    case systemSettingsSetResponse(SystemSettingsSetResponse)
    case systemModulesGetResponse(SystemModulesGetResponse)
    case systemModulesSetEnabledResponse(SystemModulesSetEnabledResponse)
    case systemModelsGetResponse(SystemModelsGetResponse)
    case systemModelsSetResponse(SystemModelsSetResponse)
    case streamTurnStartedEvent(StreamTurnStartedEvent)
    case streamTextDeltaEvent(StreamTextDeltaEvent)
    case streamMessageCompletedEvent(StreamMessageCompletedEvent)
    case streamToolCallEvent(StreamToolCallEvent)
    case streamToolResultEvent(StreamToolResultEvent)
    case streamTurnStateEvent(StreamTurnStateEvent)
    case streamUiEvent(StreamUiEvent)
    case cardChangedEvent(CardChangedEvent)
    case contextChangedEvent(ContextChangedEvent)
    case contextCompactedEvent(ContextCompactedEvent)
    case sessionArchivedEvent(SessionArchivedEvent)
    case sessionUnarchivedEvent(SessionUnarchivedEvent)
    case sessionDeletedEvent(SessionDeletedEvent)
    case systemSettingsChangedEvent(SystemSettingsChangedEvent)
    case systemModulesChangedEvent(SystemModulesChangedEvent)
    case systemModelsChangedEvent(SystemModelsChangedEvent)
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
        case (.some("response"), .some("session.archive")):
            self = .sessionArchiveResponse(try SessionArchiveResponse(from: decoder))
        case (.some("response"), .some("session.unarchive")):
            self = .sessionUnarchiveResponse(try SessionUnarchiveResponse(from: decoder))
        case (.some("response"), .some("session.deletion_preview")):
            self = .sessionDeletionPreviewResponse(try SessionDeletionPreviewResponse(from: decoder))
        case (.some("response"), .some("session.delete")):
            self = .sessionDeleteResponse(try SessionDeleteResponse(from: decoder))
        case (.some("response"), .some("card.list")):
            self = .cardListResponse(try CardListResponse(from: decoder))
        case (.some("response"), .some("card.get")):
            self = .cardGetResponse(try CardGetResponse(from: decoder))
        case (.some("response"), .some("card.create")):
            self = .cardCreateResponse(try CardCreateResponse(from: decoder))
        case (.some("response"), .some("card.patch")):
            self = .cardPatchResponse(try CardPatchResponse(from: decoder))
        case (.some("response"), .some("card.delete")):
            self = .cardDeleteResponse(try CardDeleteResponse(from: decoder))
        case (.some("response"), .some("card.search")):
            self = .cardSearchResponse(try CardSearchResponse(from: decoder))
        case (.some("response"), .some("card.refresh")):
            self = .cardRefreshResponse(try CardRefreshResponse(from: decoder))
        case (.some("response"), .some("media.import")):
            self = .mediaImportResponse(try MediaImportResponse(from: decoder))
        case (.some("response"), .some("context.get")):
            self = .contextGetResponse(try ContextGetResponse(from: decoder))
        case (.some("response"), .some("context.add_card")):
            self = .contextAddCardResponse(try ContextAddCardResponse(from: decoder))
        case (.some("response"), .some("context.remove_card")):
            self = .contextRemoveCardResponse(try ContextRemoveCardResponse(from: decoder))
        case (.some("response"), .some("context.compact")):
            self = .contextCompactResponse(try ContextCompactResponse(from: decoder))
        case (.some("response"), .some("system.settings.get")):
            self = .systemSettingsGetResponse(try SystemSettingsGetResponse(from: decoder))
        case (.some("response"), .some("system.settings.set")):
            self = .systemSettingsSetResponse(try SystemSettingsSetResponse(from: decoder))
        case (.some("response"), .some("system.modules.get")):
            self = .systemModulesGetResponse(try SystemModulesGetResponse(from: decoder))
        case (.some("response"), .some("system.modules.set_enabled")):
            self = .systemModulesSetEnabledResponse(try SystemModulesSetEnabledResponse(from: decoder))
        case (.some("response"), .some("system.models.get")):
            self = .systemModelsGetResponse(try SystemModelsGetResponse(from: decoder))
        case (.some("response"), .some("system.models.set")):
            self = .systemModelsSetResponse(try SystemModelsSetResponse(from: decoder))
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
        case (.some("event"), .some("card.changed")):
            self = .cardChangedEvent(try CardChangedEvent(from: decoder))
        case (.some("event"), .some("context.changed")):
            self = .contextChangedEvent(try ContextChangedEvent(from: decoder))
        case (.some("event"), .some("context.compacted")):
            self = .contextCompactedEvent(try ContextCompactedEvent(from: decoder))
        case (.some("event"), .some("session.archived")):
            self = .sessionArchivedEvent(try SessionArchivedEvent(from: decoder))
        case (.some("event"), .some("session.unarchived")):
            self = .sessionUnarchivedEvent(try SessionUnarchivedEvent(from: decoder))
        case (.some("event"), .some("session.deleted")):
            self = .sessionDeletedEvent(try SessionDeletedEvent(from: decoder))
        case (.some("event"), .some("system.settings.changed")):
            self = .systemSettingsChangedEvent(try SystemSettingsChangedEvent(from: decoder))
        case (.some("event"), .some("system.modules.changed")):
            self = .systemModulesChangedEvent(try SystemModulesChangedEvent(from: decoder))
        case (.some("event"), .some("system.models.changed")):
            self = .systemModelsChangedEvent(try SystemModelsChangedEvent(from: decoder))
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
        case .sessionArchiveResponse(let value):
            try value.encode(to: encoder)
        case .sessionUnarchiveResponse(let value):
            try value.encode(to: encoder)
        case .sessionDeletionPreviewResponse(let value):
            try value.encode(to: encoder)
        case .sessionDeleteResponse(let value):
            try value.encode(to: encoder)
        case .cardListResponse(let value):
            try value.encode(to: encoder)
        case .cardGetResponse(let value):
            try value.encode(to: encoder)
        case .cardCreateResponse(let value):
            try value.encode(to: encoder)
        case .cardPatchResponse(let value):
            try value.encode(to: encoder)
        case .cardDeleteResponse(let value):
            try value.encode(to: encoder)
        case .cardSearchResponse(let value):
            try value.encode(to: encoder)
        case .cardRefreshResponse(let value):
            try value.encode(to: encoder)
        case .mediaImportResponse(let value):
            try value.encode(to: encoder)
        case .contextGetResponse(let value):
            try value.encode(to: encoder)
        case .contextAddCardResponse(let value):
            try value.encode(to: encoder)
        case .contextRemoveCardResponse(let value):
            try value.encode(to: encoder)
        case .contextCompactResponse(let value):
            try value.encode(to: encoder)
        case .systemSettingsGetResponse(let value):
            try value.encode(to: encoder)
        case .systemSettingsSetResponse(let value):
            try value.encode(to: encoder)
        case .systemModulesGetResponse(let value):
            try value.encode(to: encoder)
        case .systemModulesSetEnabledResponse(let value):
            try value.encode(to: encoder)
        case .systemModelsGetResponse(let value):
            try value.encode(to: encoder)
        case .systemModelsSetResponse(let value):
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
        case .cardChangedEvent(let value):
            try value.encode(to: encoder)
        case .contextChangedEvent(let value):
            try value.encode(to: encoder)
        case .contextCompactedEvent(let value):
            try value.encode(to: encoder)
        case .sessionArchivedEvent(let value):
            try value.encode(to: encoder)
        case .sessionUnarchivedEvent(let value):
            try value.encode(to: encoder)
        case .sessionDeletedEvent(let value):
            try value.encode(to: encoder)
        case .systemSettingsChangedEvent(let value):
            try value.encode(to: encoder)
        case .systemModulesChangedEvent(let value):
            try value.encode(to: encoder)
        case .systemModelsChangedEvent(let value):
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
    public let maxBlobBytes: Int?

    public init(
        maxFrameBytes: Int,
        replayWindow: Int,
        heartbeatSeconds: Int,
        maxBlobBytes: Int? = nil
    ) {
        self.maxFrameBytes = maxFrameBytes
        self.replayWindow = replayWindow
        self.heartbeatSeconds = heartbeatSeconds
        self.maxBlobBytes = maxBlobBytes
    }

    private enum CodingKeys: String, CodingKey {
        case maxFrameBytes = "maxFrameBytes"
        case replayWindow = "replayWindow"
        case heartbeatSeconds = "heartbeatSeconds"
        case maxBlobBytes = "maxBlobBytes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let maxFrameBytes = try container.decode(Int.self, forKey: .maxFrameBytes)
        let replayWindow = try container.decode(Int.self, forKey: .replayWindow)
        let heartbeatSeconds = try container.decode(Int.self, forKey: .heartbeatSeconds)
        let maxBlobBytes = try container.decodeIfPresent(Int.self, forKey: .maxBlobBytes)
        self.init(
            maxFrameBytes: maxFrameBytes,
            replayWindow: replayWindow,
            heartbeatSeconds: heartbeatSeconds,
            maxBlobBytes: maxBlobBytes
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(maxFrameBytes, forKey: .maxFrameBytes)
        try container.encode(replayWindow, forKey: .replayWindow)
        try container.encode(heartbeatSeconds, forKey: .heartbeatSeconds)
        try container.encodeIfPresent(maxBlobBytes, forKey: .maxBlobBytes)
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

// MARK: - SessionArchive

public struct SessionArchive: Codable, Equatable, Sendable {
    public let archivedAt: String
    public let purgeAt: String

    public init(
        archivedAt: String,
        purgeAt: String
    ) {
        self.archivedAt = archivedAt
        self.purgeAt = purgeAt
    }

    private enum CodingKeys: String, CodingKey {
        case archivedAt = "archivedAt"
        case purgeAt = "purgeAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let archivedAt = try container.decode(String.self, forKey: .archivedAt)
        let purgeAt = try container.decode(String.self, forKey: .purgeAt)
        self.init(
            archivedAt: archivedAt,
            purgeAt: purgeAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(archivedAt, forKey: .archivedAt)
        try container.encode(purgeAt, forKey: .purgeAt)
    }
}

// MARK: - SessionArchiveRequest

public struct SessionArchiveRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionArchiveRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.archive",
        payload: SessionArchiveRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionArchiveRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionArchiveRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.archive" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionArchiveRequest.type 必須是 session.archive")
        }
        let payload = try container.decode(SessionArchiveRequestPayload.self, forKey: .payload)
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

// MARK: - SessionArchiveRequestPayload

public struct SessionArchiveRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let purgeAfterDays: Int?

    public init(
        sessionId: String,
        purgeAfterDays: Int? = nil
    ) {
        self.sessionId = sessionId
        self.purgeAfterDays = purgeAfterDays
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case purgeAfterDays = "purgeAfterDays"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let purgeAfterDays = try container.decodeIfPresent(Int.self, forKey: .purgeAfterDays)
        self.init(
            sessionId: sessionId,
            purgeAfterDays: purgeAfterDays
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encodeIfPresent(purgeAfterDays, forKey: .purgeAfterDays)
    }
}

// MARK: - SessionArchiveResponse

public struct SessionArchiveResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionArchiveResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.archive",
        payload: SessionArchiveResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionArchiveResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionArchiveResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.archive" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionArchiveResponse.type 必須是 session.archive")
        }
        let payload = try container.decode(SessionArchiveResponsePayload.self, forKey: .payload)
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

// MARK: - SessionArchiveResponsePayload

public struct SessionArchiveResponsePayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let archive: SessionArchive

    public init(
        sessionId: String,
        archive: SessionArchive
    ) {
        self.sessionId = sessionId
        self.archive = archive
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case archive = "archive"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let archive = try container.decode(SessionArchive.self, forKey: .archive)
        self.init(
            sessionId: sessionId,
            archive: archive
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(archive, forKey: .archive)
    }
}

// MARK: - SessionArchivedEvent

public struct SessionArchivedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: SessionArchivedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "session.archived",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: SessionArchivedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionArchivedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionArchivedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.archived" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionArchivedEvent.type 必須是 session.archived")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(SessionArchivedEventPayload.self, forKey: .payload)
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

// MARK: - SessionArchivedEventPayload

public struct SessionArchivedEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let archive: SessionArchive

    public init(
        sessionId: String,
        archive: SessionArchive
    ) {
        self.sessionId = sessionId
        self.archive = archive
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case archive = "archive"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let archive = try container.decode(SessionArchive.self, forKey: .archive)
        self.init(
            sessionId: sessionId,
            archive: archive
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(archive, forKey: .archive)
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

// MARK: - SessionDeleteRequest

public struct SessionDeleteRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionDeleteRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.delete",
        payload: SessionDeleteRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionDeleteRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionDeleteRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.delete" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionDeleteRequest.type 必須是 session.delete")
        }
        let payload = try container.decode(SessionDeleteRequestPayload.self, forKey: .payload)
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

// MARK: - SessionDeleteRequestPayload

public struct SessionDeleteRequestPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let clientRequestId: String

    public init(
        sessionId: String,
        clientRequestId: String
    ) {
        self.sessionId = sessionId
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            sessionId: sessionId,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SessionDeleteResponse

public struct SessionDeleteResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionDeleteResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.delete",
        payload: SessionDeleteResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionDeleteResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionDeleteResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.delete" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionDeleteResponse.type 必須是 session.delete")
        }
        let payload = try container.decode(SessionDeleteResponsePayload.self, forKey: .payload)
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

// MARK: - SessionDeleteResponsePayload

public struct SessionDeleteResponsePayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let deletedSessionIds: [String]
    public let deletedCards: Int
    public let deletedAssets: Int

    public init(
        sessionId: String,
        deletedSessionIds: [String],
        deletedCards: Int,
        deletedAssets: Int
    ) {
        self.sessionId = sessionId
        self.deletedSessionIds = deletedSessionIds
        self.deletedCards = deletedCards
        self.deletedAssets = deletedAssets
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case deletedSessionIds = "deletedSessionIds"
        case deletedCards = "deletedCards"
        case deletedAssets = "deletedAssets"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let deletedSessionIds = try container.decode([String].self, forKey: .deletedSessionIds)
        let deletedCards = try container.decode(Int.self, forKey: .deletedCards)
        let deletedAssets = try container.decode(Int.self, forKey: .deletedAssets)
        self.init(
            sessionId: sessionId,
            deletedSessionIds: deletedSessionIds,
            deletedCards: deletedCards,
            deletedAssets: deletedAssets
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(deletedSessionIds, forKey: .deletedSessionIds)
        try container.encode(deletedCards, forKey: .deletedCards)
        try container.encode(deletedAssets, forKey: .deletedAssets)
    }
}

// MARK: - SessionDeletedEvent

public struct SessionDeletedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: SessionDeletedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "session.deleted",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: SessionDeletedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionDeletedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionDeletedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.deleted" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionDeletedEvent.type 必須是 session.deleted")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(SessionDeletedEventPayload.self, forKey: .payload)
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

// MARK: - SessionDeletedEventPayload

public struct SessionDeletedEventPayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let deletedSessionIds: [String]
    public let deletedCards: Int
    public let deletedAssets: Int

    public init(
        sessionId: String,
        deletedSessionIds: [String],
        deletedCards: Int,
        deletedAssets: Int
    ) {
        self.sessionId = sessionId
        self.deletedSessionIds = deletedSessionIds
        self.deletedCards = deletedCards
        self.deletedAssets = deletedAssets
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case deletedSessionIds = "deletedSessionIds"
        case deletedCards = "deletedCards"
        case deletedAssets = "deletedAssets"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let deletedSessionIds = try container.decode([String].self, forKey: .deletedSessionIds)
        let deletedCards = try container.decode(Int.self, forKey: .deletedCards)
        let deletedAssets = try container.decode(Int.self, forKey: .deletedAssets)
        self.init(
            sessionId: sessionId,
            deletedSessionIds: deletedSessionIds,
            deletedCards: deletedCards,
            deletedAssets: deletedAssets
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(deletedSessionIds, forKey: .deletedSessionIds)
        try container.encode(deletedCards, forKey: .deletedCards)
        try container.encode(deletedAssets, forKey: .deletedAssets)
    }
}

// MARK: - SessionDeletionPreviewRequest

public struct SessionDeletionPreviewRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionDeletionPreviewRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.deletion_preview",
        payload: SessionDeletionPreviewRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionDeletionPreviewRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionDeletionPreviewRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.deletion_preview" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionDeletionPreviewRequest.type 必須是 session.deletion_preview")
        }
        let payload = try container.decode(SessionDeletionPreviewRequestPayload.self, forKey: .payload)
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

// MARK: - SessionDeletionPreviewRequestPayload

public struct SessionDeletionPreviewRequestPayload: Codable, Equatable, Sendable {
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

// MARK: - SessionDeletionPreviewResponse

public struct SessionDeletionPreviewResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionDeletionPreviewResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.deletion_preview",
        payload: SessionDeletionPreviewResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionDeletionPreviewResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionDeletionPreviewResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.deletion_preview" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionDeletionPreviewResponse.type 必須是 session.deletion_preview")
        }
        let payload = try container.decode(SessionDeletionPreviewResponsePayload.self, forKey: .payload)
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

// MARK: - SessionDeletionPreviewResponsePayload

public struct SessionDeletionPreviewResponsePayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let subtreeSessionIds: [String]
    public let exclusiveCards: Int
    public let sharedCards: Int
    public let assets: Int

    public init(
        sessionId: String,
        subtreeSessionIds: [String],
        exclusiveCards: Int,
        sharedCards: Int,
        assets: Int
    ) {
        self.sessionId = sessionId
        self.subtreeSessionIds = subtreeSessionIds
        self.exclusiveCards = exclusiveCards
        self.sharedCards = sharedCards
        self.assets = assets
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case subtreeSessionIds = "subtreeSessionIds"
        case exclusiveCards = "exclusiveCards"
        case sharedCards = "sharedCards"
        case assets = "assets"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let subtreeSessionIds = try container.decode([String].self, forKey: .subtreeSessionIds)
        let exclusiveCards = try container.decode(Int.self, forKey: .exclusiveCards)
        let sharedCards = try container.decode(Int.self, forKey: .sharedCards)
        let assets = try container.decode(Int.self, forKey: .assets)
        self.init(
            sessionId: sessionId,
            subtreeSessionIds: subtreeSessionIds,
            exclusiveCards: exclusiveCards,
            sharedCards: sharedCards,
            assets: assets
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(subtreeSessionIds, forKey: .subtreeSessionIds)
        try container.encode(exclusiveCards, forKey: .exclusiveCards)
        try container.encode(sharedCards, forKey: .sharedCards)
        try container.encode(assets, forKey: .assets)
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
    public let archive: SessionArchive?

    public init(
        id: String,
        title: String,
        status: SessionStatus,
        createdAt: String,
        updatedAt: String,
        messageCount: Int,
        archive: SessionArchive? = nil
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.messageCount = messageCount
        self.archive = archive
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case title = "title"
        case status = "status"
        case createdAt = "createdAt"
        case updatedAt = "updatedAt"
        case messageCount = "messageCount"
        case archive = "archive"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let title = try container.decode(String.self, forKey: .title)
        let status = try container.decode(SessionStatus.self, forKey: .status)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let updatedAt = try container.decode(String.self, forKey: .updatedAt)
        let messageCount = try container.decode(Int.self, forKey: .messageCount)
        let archive = try container.decodeIfPresent(SessionArchive.self, forKey: .archive)
        self.init(
            id: id,
            title: title,
            status: status,
            createdAt: createdAt,
            updatedAt: updatedAt,
            messageCount: messageCount,
            archive: archive
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
        try container.encodeIfPresent(archive, forKey: .archive)
    }
}

// MARK: - SessionUnarchiveRequest

public struct SessionUnarchiveRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SessionUnarchiveRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "session.unarchive",
        payload: SessionUnarchiveRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionUnarchiveRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionUnarchiveRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.unarchive" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionUnarchiveRequest.type 必須是 session.unarchive")
        }
        let payload = try container.decode(SessionUnarchiveRequestPayload.self, forKey: .payload)
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

// MARK: - SessionUnarchiveRequestPayload

public struct SessionUnarchiveRequestPayload: Codable, Equatable, Sendable {
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

// MARK: - SessionUnarchiveResponse

public struct SessionUnarchiveResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SessionUnarchiveResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "session.unarchive",
        payload: SessionUnarchiveResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionUnarchiveResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionUnarchiveResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.unarchive" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionUnarchiveResponse.type 必須是 session.unarchive")
        }
        let payload = try container.decode(SessionUnarchiveResponsePayload.self, forKey: .payload)
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

// MARK: - SessionUnarchiveResponsePayload

public struct SessionUnarchiveResponsePayload: Codable, Equatable, Sendable {
    public let sessionId: String
    public let unarchived: Bool

    public init(
        sessionId: String,
        unarchived: Bool
    ) {
        self.sessionId = sessionId
        self.unarchived = unarchived
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId = "sessionId"
        case unarchived = "unarchived"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let unarchived = try container.decode(Bool.self, forKey: .unarchived)
        self.init(
            sessionId: sessionId,
            unarchived: unarchived
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(unarchived, forKey: .unarchived)
    }
}

// MARK: - SessionUnarchivedEvent

public struct SessionUnarchivedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: SessionUnarchivedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "session.unarchived",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: SessionUnarchivedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SessionUnarchivedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SessionUnarchivedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "session.unarchived" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SessionUnarchivedEvent.type 必須是 session.unarchived")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(SessionUnarchivedEventPayload.self, forKey: .payload)
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

// MARK: - SessionUnarchivedEventPayload

public struct SessionUnarchivedEventPayload: Codable, Equatable, Sendable {
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

// MARK: - SettingChange

public struct SettingChange: Codable, Equatable, Sendable {
    public let key: String
    public let value: JSONValue

    public init(
        key: String,
        value: JSONValue
    ) {
        self.key = key
        self.value = value
    }

    private enum CodingKeys: String, CodingKey {
        case key = "key"
        case value = "value"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let key = try container.decode(String.self, forKey: .key)
        let value = try container.decode(JSONValue.self, forKey: .value)
        self.init(
            key: key,
            value: value
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(key, forKey: .key)
        try container.encode(value, forKey: .value)
    }
}

// MARK: - SettingItem

public struct SettingItem: Codable, Equatable, Sendable {
    public let key: String
    public let value: JSONValue
    public let level: SettingLevel
    public let title: String?
    public let description: String?
    public let updatedAt: String

    public init(
        key: String,
        value: JSONValue,
        level: SettingLevel,
        title: String? = nil,
        description: String? = nil,
        updatedAt: String
    ) {
        self.key = key
        self.value = value
        self.level = level
        self.title = title
        self.description = description
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case key = "key"
        case value = "value"
        case level = "level"
        case title = "title"
        case description = "description"
        case updatedAt = "updatedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let key = try container.decode(String.self, forKey: .key)
        let value = try container.decode(JSONValue.self, forKey: .value)
        let level = try container.decode(SettingLevel.self, forKey: .level)
        let title = try container.decodeIfPresent(String.self, forKey: .title)
        let description = try container.decodeIfPresent(String.self, forKey: .description)
        let updatedAt = try container.decode(String.self, forKey: .updatedAt)
        self.init(
            key: key,
            value: value,
            level: level,
            title: title,
            description: description,
            updatedAt: updatedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(key, forKey: .key)
        try container.encode(value, forKey: .value)
        try container.encode(level, forKey: .level)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encode(updatedAt, forKey: .updatedAt)
    }
}

// MARK: - SettingKind

public enum SettingKind: String, Codable, Equatable, Sendable, CaseIterable {
    case string = "string"
    case number = "number"
    case integer = "integer"
    case boolean = "boolean"
    case `enum` = "enum"
    case stringList = "string-list"
    case path = "path"
}

// MARK: - SettingLevel

public enum SettingLevel: String, Codable, Equatable, Sendable, CaseIterable {
    case free = "free"
    case approval = "approval"
    case humanOnly = "human-only"
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

// MARK: - SystemModelsChangedEvent

public struct SystemModelsChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: SystemModelsState

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "system.models.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: SystemModelsState
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModelsChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModelsChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.models.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModelsChangedEvent.type 必須是 system.models.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(SystemModelsState.self, forKey: .payload)
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

// MARK: - SystemModelsGetRequest

public struct SystemModelsGetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemModelsGetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.models.get",
        payload: SystemModelsGetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModelsGetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModelsGetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.models.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModelsGetRequest.type 必須是 system.models.get")
        }
        let payload = try container.decode(SystemModelsGetRequestPayload.self, forKey: .payload)
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

// MARK: - SystemModelsGetRequestPayload

public struct SystemModelsGetRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - SystemModelsGetResponse

public struct SystemModelsGetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SystemModelsState

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.models.get",
        payload: SystemModelsState
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModelsGetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModelsGetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.models.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModelsGetResponse.type 必須是 system.models.get")
        }
        let payload = try container.decode(SystemModelsState.self, forKey: .payload)
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

// MARK: - SystemModelsSetRequest

public struct SystemModelsSetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemModelsSetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.models.set",
        payload: SystemModelsSetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModelsSetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModelsSetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.models.set" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModelsSetRequest.type 必須是 system.models.set")
        }
        let payload = try container.decode(SystemModelsSetRequestPayload.self, forKey: .payload)
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

// MARK: - SystemModelsSetRequestPayload

public struct SystemModelsSetRequestPayload: Codable, Equatable, Sendable {
    public let providers: [ModelProviderInfo]?
    public let roles: [ModelRoleSelection]?
    public let clientRequestId: String

    public init(
        providers: [ModelProviderInfo]? = nil,
        roles: [ModelRoleSelection]? = nil,
        clientRequestId: String
    ) {
        self.providers = providers
        self.roles = roles
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case providers = "providers"
        case roles = "roles"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let providers = try container.decodeIfPresent([ModelProviderInfo].self, forKey: .providers)
        let roles = try container.decodeIfPresent([ModelRoleSelection].self, forKey: .roles)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            providers: providers,
            roles: roles,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(providers, forKey: .providers)
        try container.encodeIfPresent(roles, forKey: .roles)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SystemModelsSetResponse

public struct SystemModelsSetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SystemModelsState

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.models.set",
        payload: SystemModelsState
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModelsSetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModelsSetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.models.set" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModelsSetResponse.type 必須是 system.models.set")
        }
        let payload = try container.decode(SystemModelsState.self, forKey: .payload)
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

// MARK: - SystemModelsState

public struct SystemModelsState: Codable, Equatable, Sendable {
    public let providers: [ModelProviderInfo]
    public let roles: [ModelRoleSelection]
    public let resolved: [ResolvedModelRole]

    public init(
        providers: [ModelProviderInfo],
        roles: [ModelRoleSelection],
        resolved: [ResolvedModelRole]
    ) {
        self.providers = providers
        self.roles = roles
        self.resolved = resolved
    }

    private enum CodingKeys: String, CodingKey {
        case providers = "providers"
        case roles = "roles"
        case resolved = "resolved"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let providers = try container.decode([ModelProviderInfo].self, forKey: .providers)
        let roles = try container.decode([ModelRoleSelection].self, forKey: .roles)
        let resolved = try container.decode([ResolvedModelRole].self, forKey: .resolved)
        self.init(
            providers: providers,
            roles: roles,
            resolved: resolved
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(providers, forKey: .providers)
        try container.encode(roles, forKey: .roles)
        try container.encode(resolved, forKey: .resolved)
    }
}

// MARK: - SystemModulesChangedEvent

public struct SystemModulesChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: SystemModulesChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "system.modules.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: SystemModulesChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModulesChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModulesChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.modules.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModulesChangedEvent.type 必須是 system.modules.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(SystemModulesChangedEventPayload.self, forKey: .payload)
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

// MARK: - SystemModulesChangedEventPayload

public struct SystemModulesChangedEventPayload: Codable, Equatable, Sendable {
    public let module: ModuleInfo

    public init(
        module: ModuleInfo
    ) {
        self.module = module
    }

    private enum CodingKeys: String, CodingKey {
        case module = "module"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let module = try container.decode(ModuleInfo.self, forKey: .module)
        self.init(
            module: module
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(module, forKey: .module)
    }
}

// MARK: - SystemModulesGetRequest

public struct SystemModulesGetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemModulesGetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.modules.get",
        payload: SystemModulesGetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModulesGetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModulesGetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.modules.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModulesGetRequest.type 必須是 system.modules.get")
        }
        let payload = try container.decode(SystemModulesGetRequestPayload.self, forKey: .payload)
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

// MARK: - SystemModulesGetRequestPayload

public struct SystemModulesGetRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - SystemModulesGetResponse

public struct SystemModulesGetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SystemModulesGetResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.modules.get",
        payload: SystemModulesGetResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModulesGetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModulesGetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.modules.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModulesGetResponse.type 必須是 system.modules.get")
        }
        let payload = try container.decode(SystemModulesGetResponsePayload.self, forKey: .payload)
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

// MARK: - SystemModulesGetResponsePayload

public struct SystemModulesGetResponsePayload: Codable, Equatable, Sendable {
    public let modules: [ModuleInfo]

    public init(
        modules: [ModuleInfo]
    ) {
        self.modules = modules
    }

    private enum CodingKeys: String, CodingKey {
        case modules = "modules"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let modules = try container.decode([ModuleInfo].self, forKey: .modules)
        self.init(
            modules: modules
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(modules, forKey: .modules)
    }
}

// MARK: - SystemModulesSetEnabledRequest

public struct SystemModulesSetEnabledRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemModulesSetEnabledRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.modules.set_enabled",
        payload: SystemModulesSetEnabledRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModulesSetEnabledRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModulesSetEnabledRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.modules.set_enabled" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModulesSetEnabledRequest.type 必須是 system.modules.set_enabled")
        }
        let payload = try container.decode(SystemModulesSetEnabledRequestPayload.self, forKey: .payload)
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

// MARK: - SystemModulesSetEnabledRequestPayload

public struct SystemModulesSetEnabledRequestPayload: Codable, Equatable, Sendable {
    public let moduleId: String
    public let enabled: Bool
    public let clientRequestId: String

    public init(
        moduleId: String,
        enabled: Bool,
        clientRequestId: String
    ) {
        self.moduleId = moduleId
        self.enabled = enabled
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case moduleId = "moduleId"
        case enabled = "enabled"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let moduleId = try container.decode(String.self, forKey: .moduleId)
        let enabled = try container.decode(Bool.self, forKey: .enabled)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            moduleId: moduleId,
            enabled: enabled,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(moduleId, forKey: .moduleId)
        try container.encode(enabled, forKey: .enabled)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SystemModulesSetEnabledResponse

public struct SystemModulesSetEnabledResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SystemModulesSetEnabledResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.modules.set_enabled",
        payload: SystemModulesSetEnabledResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemModulesSetEnabledResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemModulesSetEnabledResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.modules.set_enabled" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemModulesSetEnabledResponse.type 必須是 system.modules.set_enabled")
        }
        let payload = try container.decode(SystemModulesSetEnabledResponsePayload.self, forKey: .payload)
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

// MARK: - SystemModulesSetEnabledResponsePayload

public struct SystemModulesSetEnabledResponsePayload: Codable, Equatable, Sendable {
    public let module: ModuleInfo

    public init(
        module: ModuleInfo
    ) {
        self.module = module
    }

    private enum CodingKeys: String, CodingKey {
        case module = "module"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let module = try container.decode(ModuleInfo.self, forKey: .module)
        self.init(
            module: module
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(module, forKey: .module)
    }
}

// MARK: - SystemSettingsChangedEvent

public struct SystemSettingsChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: SystemSettingsChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "system.settings.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: SystemSettingsChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemSettingsChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemSettingsChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.settings.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemSettingsChangedEvent.type 必須是 system.settings.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(SystemSettingsChangedEventPayload.self, forKey: .payload)
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

// MARK: - SystemSettingsChangedEventPayload

public struct SystemSettingsChangedEventPayload: Codable, Equatable, Sendable {
    public let changes: [SettingItem]
    public let changedBy: String
    public let changedAt: String

    public init(
        changes: [SettingItem],
        changedBy: String,
        changedAt: String
    ) {
        self.changes = changes
        self.changedBy = changedBy
        self.changedAt = changedAt
    }

    private enum CodingKeys: String, CodingKey {
        case changes = "changes"
        case changedBy = "changedBy"
        case changedAt = "changedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let changes = try container.decode([SettingItem].self, forKey: .changes)
        let changedBy = try container.decode(String.self, forKey: .changedBy)
        let changedAt = try container.decode(String.self, forKey: .changedAt)
        self.init(
            changes: changes,
            changedBy: changedBy,
            changedAt: changedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(changes, forKey: .changes)
        try container.encode(changedBy, forKey: .changedBy)
        try container.encode(changedAt, forKey: .changedAt)
    }
}

// MARK: - SystemSettingsGetRequest

public struct SystemSettingsGetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemSettingsGetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.settings.get",
        payload: SystemSettingsGetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemSettingsGetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemSettingsGetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.settings.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemSettingsGetRequest.type 必須是 system.settings.get")
        }
        let payload = try container.decode(SystemSettingsGetRequestPayload.self, forKey: .payload)
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

// MARK: - SystemSettingsGetRequestPayload

public struct SystemSettingsGetRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - SystemSettingsGetResponse

public struct SystemSettingsGetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SystemSettingsGetResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.settings.get",
        payload: SystemSettingsGetResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemSettingsGetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemSettingsGetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.settings.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemSettingsGetResponse.type 必須是 system.settings.get")
        }
        let payload = try container.decode(SystemSettingsGetResponsePayload.self, forKey: .payload)
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

// MARK: - SystemSettingsGetResponsePayload

public struct SystemSettingsGetResponsePayload: Codable, Equatable, Sendable {
    public let settings: [SettingItem]

    public init(
        settings: [SettingItem]
    ) {
        self.settings = settings
    }

    private enum CodingKeys: String, CodingKey {
        case settings = "settings"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let settings = try container.decode([SettingItem].self, forKey: .settings)
        self.init(
            settings: settings
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(settings, forKey: .settings)
    }
}

// MARK: - SystemSettingsSetRequest

public struct SystemSettingsSetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemSettingsSetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.settings.set",
        payload: SystemSettingsSetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemSettingsSetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemSettingsSetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.settings.set" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemSettingsSetRequest.type 必須是 system.settings.set")
        }
        let payload = try container.decode(SystemSettingsSetRequestPayload.self, forKey: .payload)
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

// MARK: - SystemSettingsSetRequestPayload

public struct SystemSettingsSetRequestPayload: Codable, Equatable, Sendable {
    public let changes: [SettingChange]
    public let clientRequestId: String

    public init(
        changes: [SettingChange],
        clientRequestId: String
    ) {
        self.changes = changes
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case changes = "changes"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let changes = try container.decode([SettingChange].self, forKey: .changes)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            changes: changes,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(changes, forKey: .changes)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SystemSettingsSetResponse

public struct SystemSettingsSetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SystemSettingsSetResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.settings.set",
        payload: SystemSettingsSetResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemSettingsSetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemSettingsSetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.settings.set" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemSettingsSetResponse.type 必須是 system.settings.set")
        }
        let payload = try container.decode(SystemSettingsSetResponsePayload.self, forKey: .payload)
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

// MARK: - SystemSettingsSetResponsePayload

public struct SystemSettingsSetResponsePayload: Codable, Equatable, Sendable {
    public let applied: [SettingItem]
    public let requiresApproval: Bool
    public let approvalId: String?

    public init(
        applied: [SettingItem],
        requiresApproval: Bool,
        approvalId: String? = nil
    ) {
        self.applied = applied
        self.requiresApproval = requiresApproval
        self.approvalId = approvalId
    }

    private enum CodingKeys: String, CodingKey {
        case applied = "applied"
        case requiresApproval = "requiresApproval"
        case approvalId = "approvalId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let applied = try container.decode([SettingItem].self, forKey: .applied)
        let requiresApproval = try container.decode(Bool.self, forKey: .requiresApproval)
        let approvalId = try container.decodeIfPresent(String.self, forKey: .approvalId)
        self.init(
            applied: applied,
            requiresApproval: requiresApproval,
            approvalId: approvalId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(applied, forKey: .applied)
        try container.encode(requiresApproval, forKey: .requiresApproval)
        try container.encodeIfPresent(approvalId, forKey: .approvalId)
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
    public let details: TurnErrorDetails?

    public init(
        code: String,
        message: String,
        retryable: Bool,
        details: TurnErrorDetails? = nil
    ) {
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details
    }

    private enum CodingKeys: String, CodingKey {
        case code = "code"
        case message = "message"
        case retryable = "retryable"
        case details = "details"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let code = try container.decode(String.self, forKey: .code)
        let message = try container.decode(String.self, forKey: .message)
        let retryable = try container.decode(Bool.self, forKey: .retryable)
        let details = try container.decodeIfPresent(TurnErrorDetails.self, forKey: .details)
        self.init(
            code: code,
            message: message,
            retryable: retryable,
            details: details
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(code, forKey: .code)
        try container.encode(message, forKey: .message)
        try container.encode(retryable, forKey: .retryable)
        try container.encodeIfPresent(details, forKey: .details)
    }
}

// MARK: - TurnErrorDetails

public struct TurnErrorDetails: Codable, Equatable, Sendable {
    public let reason: String?
    public let retryAfterMs: Int?
    public let field: String?

    public init(
        reason: String? = nil,
        retryAfterMs: Int? = nil,
        field: String? = nil
    ) {
        self.reason = reason
        self.retryAfterMs = retryAfterMs
        self.field = field
    }

    private enum CodingKeys: String, CodingKey {
        case reason = "reason"
        case retryAfterMs = "retryAfterMs"
        case field = "field"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let reason = try container.decodeIfPresent(String.self, forKey: .reason)
        let retryAfterMs = try container.decodeIfPresent(Int.self, forKey: .retryAfterMs)
        let field = try container.decodeIfPresent(String.self, forKey: .field)
        self.init(
            reason: reason,
            retryAfterMs: retryAfterMs,
            field: field
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(reason, forKey: .reason)
        try container.encodeIfPresent(retryAfterMs, forKey: .retryAfterMs)
        try container.encodeIfPresent(field, forKey: .field)
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
