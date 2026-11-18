// 這個檔案由 packages/protocol/schema/protocol.schema.json 產生，不要手改。
// 重新產生：pnpm --filter @cardiary/protocol generate
//
// JSONValue 與 JSONObject 由同一個 target 的 JSONValue.swift 提供。

import Foundation

// MARK: - AgentKind

public enum AgentKind: String, Codable, Equatable, Sendable, CaseIterable {
    case opencode = "opencode"
    case claudeCode = "claude-code"
}

// MARK: - AgentListRequest

public struct AgentListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: AgentListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "agent.list",
        payload: AgentListRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "AgentListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "AgentListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "agent.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "AgentListRequest.type 必須是 agent.list")
        }
        let payload = try container.decode(AgentListRequestPayload.self, forKey: .payload)
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

// MARK: - AgentListRequestPayload

public struct AgentListRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - AgentListResponse

public struct AgentListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: AgentListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "agent.list",
        payload: AgentListResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "AgentListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "AgentListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "agent.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "AgentListResponse.type 必須是 agent.list")
        }
        let payload = try container.decode(AgentListResponsePayload.self, forKey: .payload)
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

// MARK: - AgentListResponsePayload

public struct AgentListResponsePayload: Codable, Equatable, Sendable {
    public let agents: [AgentSessionInfo]

    public init(
        agents: [AgentSessionInfo]
    ) {
        self.agents = agents
    }

    private enum CodingKeys: String, CodingKey {
        case agents = "agents"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let agents = try container.decode([AgentSessionInfo].self, forKey: .agents)
        self.init(
            agents: agents
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(agents, forKey: .agents)
    }
}

// MARK: - AgentPendingPermission

public struct AgentPendingPermission: Codable, Equatable, Sendable {
    public let approvalId: String
    public let toolName: String
    public let description: String?

    public init(
        approvalId: String,
        toolName: String,
        description: String? = nil
    ) {
        self.approvalId = approvalId
        self.toolName = toolName
        self.description = description
    }

    private enum CodingKeys: String, CodingKey {
        case approvalId = "approvalId"
        case toolName = "toolName"
        case description = "description"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let approvalId = try container.decode(String.self, forKey: .approvalId)
        let toolName = try container.decode(String.self, forKey: .toolName)
        let description = try container.decodeIfPresent(String.self, forKey: .description)
        self.init(
            approvalId: approvalId,
            toolName: toolName,
            description: description
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(approvalId, forKey: .approvalId)
        try container.encode(toolName, forKey: .toolName)
        try container.encodeIfPresent(description, forKey: .description)
    }
}

// MARK: - AgentProgress

public struct AgentProgress: Codable, Equatable, Sendable {
    public let step: String
    public let label: String
    public let completed: Int
    public let total: Int

    public init(
        step: String,
        label: String,
        completed: Int,
        total: Int
    ) {
        self.step = step
        self.label = label
        self.completed = completed
        self.total = total
    }

    private enum CodingKeys: String, CodingKey {
        case step = "step"
        case label = "label"
        case completed = "completed"
        case total = "total"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let step = try container.decode(String.self, forKey: .step)
        let label = try container.decode(String.self, forKey: .label)
        let completed = try container.decode(Int.self, forKey: .completed)
        let total = try container.decode(Int.self, forKey: .total)
        self.init(
            step: step,
            label: label,
            completed: completed,
            total: total
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(step, forKey: .step)
        try container.encode(label, forKey: .label)
        try container.encode(completed, forKey: .completed)
        try container.encode(total, forKey: .total)
    }
}

// MARK: - AgentSessionInfo

public struct AgentSessionInfo: Codable, Equatable, Sendable {
    public let agentSessionId: String
    public let agentKind: AgentKind
    public let status: AgentStatus
    public let workingDirectory: String
    public let progress: AgentProgress?
    public let message: String?
    public let resultUnknown: Bool?
    public let pendingPermission: AgentPendingPermission?
    public let startedAt: String

    public init(
        agentSessionId: String,
        agentKind: AgentKind,
        status: AgentStatus,
        workingDirectory: String,
        progress: AgentProgress? = nil,
        message: String? = nil,
        resultUnknown: Bool? = nil,
        pendingPermission: AgentPendingPermission? = nil,
        startedAt: String
    ) {
        self.agentSessionId = agentSessionId
        self.agentKind = agentKind
        self.status = status
        self.workingDirectory = workingDirectory
        self.progress = progress
        self.message = message
        self.resultUnknown = resultUnknown
        self.pendingPermission = pendingPermission
        self.startedAt = startedAt
    }

    private enum CodingKeys: String, CodingKey {
        case agentSessionId = "agentSessionId"
        case agentKind = "agentKind"
        case status = "status"
        case workingDirectory = "workingDirectory"
        case progress = "progress"
        case message = "message"
        case resultUnknown = "resultUnknown"
        case pendingPermission = "pendingPermission"
        case startedAt = "startedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let agentSessionId = try container.decode(String.self, forKey: .agentSessionId)
        let agentKind = try container.decode(AgentKind.self, forKey: .agentKind)
        let status = try container.decode(AgentStatus.self, forKey: .status)
        let workingDirectory = try container.decode(String.self, forKey: .workingDirectory)
        let progress = try container.decodeIfPresent(AgentProgress.self, forKey: .progress)
        let message = try container.decodeIfPresent(String.self, forKey: .message)
        let resultUnknown = try container.decodeIfPresent(Bool.self, forKey: .resultUnknown)
        let pendingPermission = try container.decodeIfPresent(AgentPendingPermission.self, forKey: .pendingPermission)
        let startedAt = try container.decode(String.self, forKey: .startedAt)
        self.init(
            agentSessionId: agentSessionId,
            agentKind: agentKind,
            status: status,
            workingDirectory: workingDirectory,
            progress: progress,
            message: message,
            resultUnknown: resultUnknown,
            pendingPermission: pendingPermission,
            startedAt: startedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(agentSessionId, forKey: .agentSessionId)
        try container.encode(agentKind, forKey: .agentKind)
        try container.encode(status, forKey: .status)
        try container.encode(workingDirectory, forKey: .workingDirectory)
        try container.encodeIfPresent(progress, forKey: .progress)
        try container.encodeIfPresent(message, forKey: .message)
        try container.encodeIfPresent(resultUnknown, forKey: .resultUnknown)
        try container.encodeIfPresent(pendingPermission, forKey: .pendingPermission)
        try container.encode(startedAt, forKey: .startedAt)
    }
}

// MARK: - AgentStartRequest

public struct AgentStartRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: AgentStartRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "agent.start",
        payload: AgentStartRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "AgentStartRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "AgentStartRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "agent.start" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "AgentStartRequest.type 必須是 agent.start")
        }
        let payload = try container.decode(AgentStartRequestPayload.self, forKey: .payload)
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

// MARK: - AgentStartRequestPayload

public struct AgentStartRequestPayload: Codable, Equatable, Sendable {
    public let agentKind: AgentKind
    public let workingDirectory: String
    public let prompt: String?
    public let clientRequestId: String?

    public init(
        agentKind: AgentKind,
        workingDirectory: String,
        prompt: String? = nil,
        clientRequestId: String? = nil
    ) {
        self.agentKind = agentKind
        self.workingDirectory = workingDirectory
        self.prompt = prompt
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case agentKind = "agentKind"
        case workingDirectory = "workingDirectory"
        case prompt = "prompt"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let agentKind = try container.decode(AgentKind.self, forKey: .agentKind)
        let workingDirectory = try container.decode(String.self, forKey: .workingDirectory)
        let prompt = try container.decodeIfPresent(String.self, forKey: .prompt)
        let clientRequestId = try container.decodeIfPresent(String.self, forKey: .clientRequestId)
        self.init(
            agentKind: agentKind,
            workingDirectory: workingDirectory,
            prompt: prompt,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(agentKind, forKey: .agentKind)
        try container.encode(workingDirectory, forKey: .workingDirectory)
        try container.encodeIfPresent(prompt, forKey: .prompt)
        try container.encodeIfPresent(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - AgentStartResponse

public struct AgentStartResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: AgentStartResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "agent.start",
        payload: AgentStartResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "AgentStartResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "AgentStartResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "agent.start" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "AgentStartResponse.type 必須是 agent.start")
        }
        let payload = try container.decode(AgentStartResponsePayload.self, forKey: .payload)
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

// MARK: - AgentStartResponsePayload

public struct AgentStartResponsePayload: Codable, Equatable, Sendable {
    public let agentSessionId: String
    public let approvalId: String?

    public init(
        agentSessionId: String,
        approvalId: String? = nil
    ) {
        self.agentSessionId = agentSessionId
        self.approvalId = approvalId
    }

    private enum CodingKeys: String, CodingKey {
        case agentSessionId = "agentSessionId"
        case approvalId = "approvalId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let agentSessionId = try container.decode(String.self, forKey: .agentSessionId)
        let approvalId = try container.decodeIfPresent(String.self, forKey: .approvalId)
        self.init(
            agentSessionId: agentSessionId,
            approvalId: approvalId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(agentSessionId, forKey: .agentSessionId)
        try container.encodeIfPresent(approvalId, forKey: .approvalId)
    }
}

// MARK: - AgentStateChangedEvent

public struct AgentStateChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: AgentStateChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "agent.state_changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: AgentStateChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "AgentStateChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "AgentStateChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "agent.state_changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "AgentStateChangedEvent.type 必須是 agent.state_changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(AgentStateChangedEventPayload.self, forKey: .payload)
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

// MARK: - AgentStateChangedEventPayload

public struct AgentStateChangedEventPayload: Codable, Equatable, Sendable {
    public let agentSessionId: String
    public let agentKind: AgentKind
    public let status: AgentStatus
    public let progress: AgentProgress?
    public let message: String?
    public let resultUnknown: Bool?
    public let pendingPermission: AgentPendingPermission?

    public init(
        agentSessionId: String,
        agentKind: AgentKind,
        status: AgentStatus,
        progress: AgentProgress? = nil,
        message: String? = nil,
        resultUnknown: Bool? = nil,
        pendingPermission: AgentPendingPermission? = nil
    ) {
        self.agentSessionId = agentSessionId
        self.agentKind = agentKind
        self.status = status
        self.progress = progress
        self.message = message
        self.resultUnknown = resultUnknown
        self.pendingPermission = pendingPermission
    }

    private enum CodingKeys: String, CodingKey {
        case agentSessionId = "agentSessionId"
        case agentKind = "agentKind"
        case status = "status"
        case progress = "progress"
        case message = "message"
        case resultUnknown = "resultUnknown"
        case pendingPermission = "pendingPermission"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let agentSessionId = try container.decode(String.self, forKey: .agentSessionId)
        let agentKind = try container.decode(AgentKind.self, forKey: .agentKind)
        let status = try container.decode(AgentStatus.self, forKey: .status)
        let progress = try container.decodeIfPresent(AgentProgress.self, forKey: .progress)
        let message = try container.decodeIfPresent(String.self, forKey: .message)
        let resultUnknown = try container.decodeIfPresent(Bool.self, forKey: .resultUnknown)
        let pendingPermission = try container.decodeIfPresent(AgentPendingPermission.self, forKey: .pendingPermission)
        self.init(
            agentSessionId: agentSessionId,
            agentKind: agentKind,
            status: status,
            progress: progress,
            message: message,
            resultUnknown: resultUnknown,
            pendingPermission: pendingPermission
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(agentSessionId, forKey: .agentSessionId)
        try container.encode(agentKind, forKey: .agentKind)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(progress, forKey: .progress)
        try container.encodeIfPresent(message, forKey: .message)
        try container.encodeIfPresent(resultUnknown, forKey: .resultUnknown)
        try container.encodeIfPresent(pendingPermission, forKey: .pendingPermission)
    }
}

// MARK: - AgentStatus

public enum AgentStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case starting = "starting"
    case running = "running"
    case waitingApproval = "waiting-approval"
    case stopped = "stopped"
    case failed = "failed"
}

// MARK: - AgentStopRequest

public struct AgentStopRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: AgentStopRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "agent.stop",
        payload: AgentStopRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "AgentStopRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "AgentStopRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "agent.stop" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "AgentStopRequest.type 必須是 agent.stop")
        }
        let payload = try container.decode(AgentStopRequestPayload.self, forKey: .payload)
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

// MARK: - AgentStopRequestPayload

public struct AgentStopRequestPayload: Codable, Equatable, Sendable {
    public let agentSessionId: String

    public init(
        agentSessionId: String
    ) {
        self.agentSessionId = agentSessionId
    }

    private enum CodingKeys: String, CodingKey {
        case agentSessionId = "agentSessionId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let agentSessionId = try container.decode(String.self, forKey: .agentSessionId)
        self.init(
            agentSessionId: agentSessionId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(agentSessionId, forKey: .agentSessionId)
    }
}

// MARK: - AgentStopResponse

public struct AgentStopResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: AgentStopResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "agent.stop",
        payload: AgentStopResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "AgentStopResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "AgentStopResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "agent.stop" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "AgentStopResponse.type 必須是 agent.stop")
        }
        let payload = try container.decode(AgentStopResponsePayload.self, forKey: .payload)
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

// MARK: - AgentStopResponsePayload

public struct AgentStopResponsePayload: Codable, Equatable, Sendable {
    public let agentSessionId: String
    public let stopped: Bool

    public init(
        agentSessionId: String,
        stopped: Bool
    ) {
        self.agentSessionId = agentSessionId
        self.stopped = stopped
    }

    private enum CodingKeys: String, CodingKey {
        case agentSessionId = "agentSessionId"
        case stopped = "stopped"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let agentSessionId = try container.decode(String.self, forKey: .agentSessionId)
        let stopped = try container.decode(Bool.self, forKey: .stopped)
        self.init(
            agentSessionId: agentSessionId,
            stopped: stopped
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(agentSessionId, forKey: .agentSessionId)
        try container.encode(stopped, forKey: .stopped)
    }
}

// MARK: - AllowAllGrantState

public struct AllowAllGrantState: Codable, Equatable, Sendable {
    public let tools: [String]
    public let paths: [String]
    public let domains: [String]
    public let expiresAt: String

    public init(
        tools: [String],
        paths: [String],
        domains: [String],
        expiresAt: String
    ) {
        self.tools = tools
        self.paths = paths
        self.domains = domains
        self.expiresAt = expiresAt
    }

    private enum CodingKeys: String, CodingKey {
        case tools = "tools"
        case paths = "paths"
        case domains = "domains"
        case expiresAt = "expiresAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let tools = try container.decode([String].self, forKey: .tools)
        let paths = try container.decode([String].self, forKey: .paths)
        let domains = try container.decode([String].self, forKey: .domains)
        let expiresAt = try container.decode(String.self, forKey: .expiresAt)
        self.init(
            tools: tools,
            paths: paths,
            domains: domains,
            expiresAt: expiresAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(tools, forKey: .tools)
        try container.encode(paths, forKey: .paths)
        try container.encode(domains, forKey: .domains)
        try container.encode(expiresAt, forKey: .expiresAt)
    }
}

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
    public let sourceScheduleName: String?

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
        expiresAt: String? = nil,
        sourceScheduleName: String? = nil
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
        self.sourceScheduleName = sourceScheduleName
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
        case sourceScheduleName = "sourceScheduleName"
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
        let sourceScheduleName = try container.decodeIfPresent(String.self, forKey: .sourceScheduleName)
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
            expiresAt: expiresAt,
            sourceScheduleName: sourceScheduleName
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
        try container.encodeIfPresent(sourceScheduleName, forKey: .sourceScheduleName)
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

// MARK: - BoardChange

public enum BoardChange: String, Codable, Equatable, Sendable, CaseIterable {
    case created = "created"
    case updated = "updated"
    case deleted = "deleted"
}

// MARK: - BoardChangedEvent

public struct BoardChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: BoardChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "board.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: BoardChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardChangedEvent.type 必須是 board.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(BoardChangedEventPayload.self, forKey: .payload)
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

// MARK: - BoardChangedEventPayload

public struct BoardChangedEventPayload: Codable, Equatable, Sendable {
    public let boardId: String
    public let change: BoardChange
    public let board: BoardDocument?
    public let cardIds: [String]?

    public init(
        boardId: String,
        change: BoardChange,
        board: BoardDocument? = nil,
        cardIds: [String]? = nil
    ) {
        self.boardId = boardId
        self.change = change
        self.board = board
        self.cardIds = cardIds
    }

    private enum CodingKeys: String, CodingKey {
        case boardId = "boardId"
        case change = "change"
        case board = "board"
        case cardIds = "cardIds"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let boardId = try container.decode(String.self, forKey: .boardId)
        let change = try container.decode(BoardChange.self, forKey: .change)
        let board = try container.decodeIfPresent(BoardDocument.self, forKey: .board)
        let cardIds = try container.decodeIfPresent([String].self, forKey: .cardIds)
        self.init(
            boardId: boardId,
            change: change,
            board: board,
            cardIds: cardIds
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(boardId, forKey: .boardId)
        try container.encode(change, forKey: .change)
        try container.encodeIfPresent(board, forKey: .board)
        try container.encodeIfPresent(cardIds, forKey: .cardIds)
    }
}

// MARK: - BoardCreateCardFromSelectionRequest

public struct BoardCreateCardFromSelectionRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: BoardCreateCardFromSelectionRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "board.create_card_from_selection",
        payload: BoardCreateCardFromSelectionRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardCreateCardFromSelectionRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardCreateCardFromSelectionRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.create_card_from_selection" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardCreateCardFromSelectionRequest.type 必須是 board.create_card_from_selection")
        }
        let payload = try container.decode(BoardCreateCardFromSelectionRequestPayload.self, forKey: .payload)
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

// MARK: - BoardCreateCardFromSelectionRequestPayload

public struct BoardCreateCardFromSelectionRequestPayload: Codable, Equatable, Sendable {
    public let boardId: String
    public let cardIds: [String]
    public let title: String
    public let body: String
    public let itemId: String
    public let position: BoardPoint
    public let clientRequestId: String

    public init(
        boardId: String,
        cardIds: [String],
        title: String,
        body: String,
        itemId: String,
        position: BoardPoint,
        clientRequestId: String
    ) {
        self.boardId = boardId
        self.cardIds = cardIds
        self.title = title
        self.body = body
        self.itemId = itemId
        self.position = position
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case boardId = "boardId"
        case cardIds = "cardIds"
        case title = "title"
        case body = "body"
        case itemId = "itemId"
        case position = "position"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let boardId = try container.decode(String.self, forKey: .boardId)
        let cardIds = try container.decode([String].self, forKey: .cardIds)
        let title = try container.decode(String.self, forKey: .title)
        let body = try container.decode(String.self, forKey: .body)
        let itemId = try container.decode(String.self, forKey: .itemId)
        let position = try container.decode(BoardPoint.self, forKey: .position)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            boardId: boardId,
            cardIds: cardIds,
            title: title,
            body: body,
            itemId: itemId,
            position: position,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(boardId, forKey: .boardId)
        try container.encode(cardIds, forKey: .cardIds)
        try container.encode(title, forKey: .title)
        try container.encode(body, forKey: .body)
        try container.encode(itemId, forKey: .itemId)
        try container.encode(position, forKey: .position)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - BoardCreateCardFromSelectionResponse

public struct BoardCreateCardFromSelectionResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: BoardCreateCardFromSelectionResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "board.create_card_from_selection",
        payload: BoardCreateCardFromSelectionResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardCreateCardFromSelectionResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardCreateCardFromSelectionResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.create_card_from_selection" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardCreateCardFromSelectionResponse.type 必須是 board.create_card_from_selection")
        }
        let payload = try container.decode(BoardCreateCardFromSelectionResponsePayload.self, forKey: .payload)
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

// MARK: - BoardCreateCardFromSelectionResponsePayload

public struct BoardCreateCardFromSelectionResponsePayload: Codable, Equatable, Sendable {
    public let board: BoardDocument
    public let cardId: String

    public init(
        board: BoardDocument,
        cardId: String
    ) {
        self.board = board
        self.cardId = cardId
    }

    private enum CodingKeys: String, CodingKey {
        case board = "board"
        case cardId = "cardId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let board = try container.decode(BoardDocument.self, forKey: .board)
        let cardId = try container.decode(String.self, forKey: .cardId)
        self.init(
            board: board,
            cardId: cardId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(board, forKey: .board)
        try container.encode(cardId, forKey: .cardId)
    }
}

// MARK: - BoardCreateRequest

public struct BoardCreateRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: BoardCreateRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "board.create",
        payload: BoardCreateRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardCreateRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardCreateRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.create" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardCreateRequest.type 必須是 board.create")
        }
        let payload = try container.decode(BoardCreateRequestPayload.self, forKey: .payload)
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

// MARK: - BoardCreateRequestPayload

public struct BoardCreateRequestPayload: Codable, Equatable, Sendable {
    public let boardId: String
    public let title: String
    public let clientRequestId: String

    public init(
        boardId: String,
        title: String,
        clientRequestId: String
    ) {
        self.boardId = boardId
        self.title = title
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case boardId = "boardId"
        case title = "title"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let boardId = try container.decode(String.self, forKey: .boardId)
        let title = try container.decode(String.self, forKey: .title)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            boardId: boardId,
            title: title,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(boardId, forKey: .boardId)
        try container.encode(title, forKey: .title)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - BoardCreateResponse

public struct BoardCreateResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: BoardCreateResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "board.create",
        payload: BoardCreateResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardCreateResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardCreateResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.create" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardCreateResponse.type 必須是 board.create")
        }
        let payload = try container.decode(BoardCreateResponsePayload.self, forKey: .payload)
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

// MARK: - BoardCreateResponsePayload

public struct BoardCreateResponsePayload: Codable, Equatable, Sendable {
    public let board: BoardDocument

    public init(
        board: BoardDocument
    ) {
        self.board = board
    }

    private enum CodingKeys: String, CodingKey {
        case board = "board"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let board = try container.decode(BoardDocument.self, forKey: .board)
        self.init(
            board: board
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(board, forKey: .board)
    }
}

// MARK: - BoardDeleteRequest

public struct BoardDeleteRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: BoardDeleteRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "board.delete",
        payload: BoardDeleteRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardDeleteRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardDeleteRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.delete" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardDeleteRequest.type 必須是 board.delete")
        }
        let payload = try container.decode(BoardDeleteRequestPayload.self, forKey: .payload)
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

// MARK: - BoardDeleteRequestPayload

public struct BoardDeleteRequestPayload: Codable, Equatable, Sendable {
    public let boardId: String

    public init(
        boardId: String
    ) {
        self.boardId = boardId
    }

    private enum CodingKeys: String, CodingKey {
        case boardId = "boardId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let boardId = try container.decode(String.self, forKey: .boardId)
        self.init(
            boardId: boardId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(boardId, forKey: .boardId)
    }
}

// MARK: - BoardDeleteResponse

public struct BoardDeleteResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: BoardDeleteResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "board.delete",
        payload: BoardDeleteResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardDeleteResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardDeleteResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.delete" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardDeleteResponse.type 必須是 board.delete")
        }
        let payload = try container.decode(BoardDeleteResponsePayload.self, forKey: .payload)
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

// MARK: - BoardDeleteResponsePayload

public struct BoardDeleteResponsePayload: Codable, Equatable, Sendable {
    public let deleted: Bool

    public init(
        deleted: Bool
    ) {
        self.deleted = deleted
    }

    private enum CodingKeys: String, CodingKey {
        case deleted = "deleted"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let deleted = try container.decode(Bool.self, forKey: .deleted)
        self.init(
            deleted: deleted
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deleted, forKey: .deleted)
    }
}

// MARK: - BoardDocument

public struct BoardDocument: Codable, Equatable, Sendable {
    public let schema: Int
    public let id: String
    public let title: String
    public let createdAt: String
    public let updatedAt: String
    public let items: [BoardItem]
    public let inbox: [BoardItem]
    public let edges: [BoardEdge]
    public let groups: [BoardGroup]

    public init(
        schema: Int = 1,
        id: String,
        title: String,
        createdAt: String,
        updatedAt: String,
        items: [BoardItem],
        inbox: [BoardItem],
        edges: [BoardEdge],
        groups: [BoardGroup]
    ) {
        self.schema = schema
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.items = items
        self.inbox = inbox
        self.edges = edges
        self.groups = groups
    }

    private enum CodingKeys: String, CodingKey {
        case schema = "schema"
        case id = "id"
        case title = "title"
        case createdAt = "createdAt"
        case updatedAt = "updatedAt"
        case items = "items"
        case inbox = "inbox"
        case edges = "edges"
        case groups = "groups"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let schema = try container.decode(Int.self, forKey: .schema)
        guard schema == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .schema, in: container, debugDescription: "BoardDocument.schema 必須是 1")
        }
        let id = try container.decode(String.self, forKey: .id)
        let title = try container.decode(String.self, forKey: .title)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let updatedAt = try container.decode(String.self, forKey: .updatedAt)
        let items = try container.decode([BoardItem].self, forKey: .items)
        let inbox = try container.decode([BoardItem].self, forKey: .inbox)
        let edges = try container.decode([BoardEdge].self, forKey: .edges)
        let groups = try container.decode([BoardGroup].self, forKey: .groups)
        self.init(
            schema: schema,
            id: id,
            title: title,
            createdAt: createdAt,
            updatedAt: updatedAt,
            items: items,
            inbox: inbox,
            edges: edges,
            groups: groups
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schema, forKey: .schema)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(items, forKey: .items)
        try container.encode(inbox, forKey: .inbox)
        try container.encode(edges, forKey: .edges)
        try container.encode(groups, forKey: .groups)
    }
}

// MARK: - BoardEdge

public struct BoardEdge: Codable, Equatable, Sendable {
    public let id: String
    public let from: String
    public let to: String
    public let label: String?

    public init(
        id: String,
        from: String,
        to: String,
        label: String? = nil
    ) {
        self.id = id
        self.from = from
        self.to = to
        self.label = label
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case from = "from"
        case to = "to"
        case label = "label"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let from = try container.decode(String.self, forKey: .from)
        let to = try container.decode(String.self, forKey: .to)
        let label = try container.decodeIfPresent(String.self, forKey: .label)
        self.init(
            id: id,
            from: from,
            to: to,
            label: label
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(from, forKey: .from)
        try container.encode(to, forKey: .to)
        try container.encodeIfPresent(label, forKey: .label)
    }
}

// MARK: - BoardGetRequest

public struct BoardGetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: BoardGetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "board.get",
        payload: BoardGetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardGetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardGetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardGetRequest.type 必須是 board.get")
        }
        let payload = try container.decode(BoardGetRequestPayload.self, forKey: .payload)
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

// MARK: - BoardGetRequestPayload

public struct BoardGetRequestPayload: Codable, Equatable, Sendable {
    public let boardId: String

    public init(
        boardId: String
    ) {
        self.boardId = boardId
    }

    private enum CodingKeys: String, CodingKey {
        case boardId = "boardId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let boardId = try container.decode(String.self, forKey: .boardId)
        self.init(
            boardId: boardId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(boardId, forKey: .boardId)
    }
}

// MARK: - BoardGetResponse

public struct BoardGetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: BoardGetResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "board.get",
        payload: BoardGetResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardGetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardGetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardGetResponse.type 必須是 board.get")
        }
        let payload = try container.decode(BoardGetResponsePayload.self, forKey: .payload)
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

// MARK: - BoardGetResponsePayload

public struct BoardGetResponsePayload: Codable, Equatable, Sendable {
    public let board: BoardDocument

    public init(
        board: BoardDocument
    ) {
        self.board = board
    }

    private enum CodingKeys: String, CodingKey {
        case board = "board"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let board = try container.decode(BoardDocument.self, forKey: .board)
        self.init(
            board: board
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(board, forKey: .board)
    }
}

// MARK: - BoardGroup

public struct BoardGroup: Codable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let parentId: String?

    public init(
        id: String,
        label: String,
        parentId: String? = nil
    ) {
        self.id = id
        self.label = label
        self.parentId = parentId
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case label = "label"
        case parentId = "parentId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let label = try container.decode(String.self, forKey: .label)
        let parentId = try container.decodeIfPresent(String.self, forKey: .parentId)
        self.init(
            id: id,
            label: label,
            parentId: parentId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(label, forKey: .label)
        try container.encodeIfPresent(parentId, forKey: .parentId)
    }
}

// MARK: - BoardItem

public struct BoardItem: Codable, Equatable, Sendable {
    public let id: String
    public let cardId: String
    public let position: BoardPoint
    public let size: BoardSize
    public let pinned: Bool
    public let origin: BoardItemOrigin
    public let projectedBy: BoardProjectedBy?
    public let groupId: String?

    public init(
        id: String,
        cardId: String,
        position: BoardPoint,
        size: BoardSize,
        pinned: Bool,
        origin: BoardItemOrigin,
        projectedBy: BoardProjectedBy? = nil,
        groupId: String? = nil
    ) {
        self.id = id
        self.cardId = cardId
        self.position = position
        self.size = size
        self.pinned = pinned
        self.origin = origin
        self.projectedBy = projectedBy
        self.groupId = groupId
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case cardId = "cardId"
        case position = "position"
        case size = "size"
        case pinned = "pinned"
        case origin = "origin"
        case projectedBy = "projectedBy"
        case groupId = "groupId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let position = try container.decode(BoardPoint.self, forKey: .position)
        let size = try container.decode(BoardSize.self, forKey: .size)
        let pinned = try container.decode(Bool.self, forKey: .pinned)
        let origin = try container.decode(BoardItemOrigin.self, forKey: .origin)
        let projectedBy = try container.decodeIfPresent(BoardProjectedBy.self, forKey: .projectedBy)
        let groupId = try container.decodeIfPresent(String.self, forKey: .groupId)
        self.init(
            id: id,
            cardId: cardId,
            position: position,
            size: size,
            pinned: pinned,
            origin: origin,
            projectedBy: projectedBy,
            groupId: groupId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(position, forKey: .position)
        try container.encode(size, forKey: .size)
        try container.encode(pinned, forKey: .pinned)
        try container.encode(origin, forKey: .origin)
        try container.encodeIfPresent(projectedBy, forKey: .projectedBy)
        try container.encodeIfPresent(groupId, forKey: .groupId)
    }
}

// MARK: - BoardItemOrigin

public enum BoardItemOrigin: String, Codable, Equatable, Sendable, CaseIterable {
    case canvas = "canvas"
    case inbox = "inbox"
}

// MARK: - BoardListRequest

public struct BoardListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: BoardListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "board.list",
        payload: BoardListRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardListRequest.type 必須是 board.list")
        }
        let payload = try container.decode(BoardListRequestPayload.self, forKey: .payload)
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

// MARK: - BoardListRequestPayload

public struct BoardListRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - BoardListResponse

public struct BoardListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: BoardListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "board.list",
        payload: BoardListResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardListResponse.type 必須是 board.list")
        }
        let payload = try container.decode(BoardListResponsePayload.self, forKey: .payload)
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

// MARK: - BoardListResponsePayload

public struct BoardListResponsePayload: Codable, Equatable, Sendable {
    public let boards: [BoardSummary]

    public init(
        boards: [BoardSummary]
    ) {
        self.boards = boards
    }

    private enum CodingKeys: String, CodingKey {
        case boards = "boards"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let boards = try container.decode([BoardSummary].self, forKey: .boards)
        self.init(
            boards: boards
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(boards, forKey: .boards)
    }
}

// MARK: - BoardPoint

public struct BoardPoint: Codable, Equatable, Sendable {
    public let x: Int
    public let y: Int

    public init(
        x: Int,
        y: Int
    ) {
        self.x = x
        self.y = y
    }

    private enum CodingKeys: String, CodingKey {
        case x = "x"
        case y = "y"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let x = try container.decode(Int.self, forKey: .x)
        let y = try container.decode(Int.self, forKey: .y)
        self.init(
            x: x,
            y: y
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(x, forKey: .x)
        try container.encode(y, forKey: .y)
    }
}

// MARK: - BoardProjectCardRequest

public struct BoardProjectCardRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: BoardProjectCardRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "board.project_card",
        payload: BoardProjectCardRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardProjectCardRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardProjectCardRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.project_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardProjectCardRequest.type 必須是 board.project_card")
        }
        let payload = try container.decode(BoardProjectCardRequestPayload.self, forKey: .payload)
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

// MARK: - BoardProjectCardRequestPayload

public struct BoardProjectCardRequestPayload: Codable, Equatable, Sendable {
    public let boardId: String
    public let itemId: String
    public let cardId: String
    public let position: BoardPoint
    public let size: BoardSize?
    public let groupId: String?
    public let pinned: Bool?

    public init(
        boardId: String,
        itemId: String,
        cardId: String,
        position: BoardPoint,
        size: BoardSize? = nil,
        groupId: String? = nil,
        pinned: Bool? = nil
    ) {
        self.boardId = boardId
        self.itemId = itemId
        self.cardId = cardId
        self.position = position
        self.size = size
        self.groupId = groupId
        self.pinned = pinned
    }

    private enum CodingKeys: String, CodingKey {
        case boardId = "boardId"
        case itemId = "itemId"
        case cardId = "cardId"
        case position = "position"
        case size = "size"
        case groupId = "groupId"
        case pinned = "pinned"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let boardId = try container.decode(String.self, forKey: .boardId)
        let itemId = try container.decode(String.self, forKey: .itemId)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let position = try container.decode(BoardPoint.self, forKey: .position)
        let size = try container.decodeIfPresent(BoardSize.self, forKey: .size)
        let groupId = try container.decodeIfPresent(String.self, forKey: .groupId)
        let pinned = try container.decodeIfPresent(Bool.self, forKey: .pinned)
        self.init(
            boardId: boardId,
            itemId: itemId,
            cardId: cardId,
            position: position,
            size: size,
            groupId: groupId,
            pinned: pinned
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(boardId, forKey: .boardId)
        try container.encode(itemId, forKey: .itemId)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(position, forKey: .position)
        try container.encodeIfPresent(size, forKey: .size)
        try container.encodeIfPresent(groupId, forKey: .groupId)
        try container.encodeIfPresent(pinned, forKey: .pinned)
    }
}

// MARK: - BoardProjectCardResponse

public struct BoardProjectCardResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: BoardProjectCardResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "board.project_card",
        payload: BoardProjectCardResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardProjectCardResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardProjectCardResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.project_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardProjectCardResponse.type 必須是 board.project_card")
        }
        let payload = try container.decode(BoardProjectCardResponsePayload.self, forKey: .payload)
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

// MARK: - BoardProjectCardResponsePayload

public struct BoardProjectCardResponsePayload: Codable, Equatable, Sendable {
    public let board: BoardDocument

    public init(
        board: BoardDocument
    ) {
        self.board = board
    }

    private enum CodingKeys: String, CodingKey {
        case board = "board"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let board = try container.decode(BoardDocument.self, forKey: .board)
        self.init(
            board: board
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(board, forKey: .board)
    }
}

// MARK: - BoardProjectedBy

public enum BoardProjectedBy: String, Codable, Equatable, Sendable, CaseIterable {
    case user = "user"
    case agent = "agent"
}

// MARK: - BoardSaveRequest

public struct BoardSaveRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: BoardSaveRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "board.save",
        payload: BoardSaveRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardSaveRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardSaveRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.save" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardSaveRequest.type 必須是 board.save")
        }
        let payload = try container.decode(BoardSaveRequestPayload.self, forKey: .payload)
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

// MARK: - BoardSaveRequestPayload

public struct BoardSaveRequestPayload: Codable, Equatable, Sendable {
    public let board: BoardDocument
    public let baseUpdatedAt: String
    public let clientRequestId: String?

    public init(
        board: BoardDocument,
        baseUpdatedAt: String,
        clientRequestId: String? = nil
    ) {
        self.board = board
        self.baseUpdatedAt = baseUpdatedAt
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case board = "board"
        case baseUpdatedAt = "baseUpdatedAt"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let board = try container.decode(BoardDocument.self, forKey: .board)
        let baseUpdatedAt = try container.decode(String.self, forKey: .baseUpdatedAt)
        let clientRequestId = try container.decodeIfPresent(String.self, forKey: .clientRequestId)
        self.init(
            board: board,
            baseUpdatedAt: baseUpdatedAt,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(board, forKey: .board)
        try container.encode(baseUpdatedAt, forKey: .baseUpdatedAt)
        try container.encodeIfPresent(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - BoardSaveResponse

public struct BoardSaveResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: BoardSaveResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "board.save",
        payload: BoardSaveResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardSaveResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardSaveResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.save" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardSaveResponse.type 必須是 board.save")
        }
        let payload = try container.decode(BoardSaveResponsePayload.self, forKey: .payload)
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

// MARK: - BoardSaveResponsePayload

public struct BoardSaveResponsePayload: Codable, Equatable, Sendable {
    public let board: BoardDocument

    public init(
        board: BoardDocument
    ) {
        self.board = board
    }

    private enum CodingKeys: String, CodingKey {
        case board = "board"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let board = try container.decode(BoardDocument.self, forKey: .board)
        self.init(
            board: board
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(board, forKey: .board)
    }
}

// MARK: - BoardSize

public struct BoardSize: Codable, Equatable, Sendable {
    public let width: Int
    public let height: Int

    public init(
        width: Int,
        height: Int
    ) {
        self.width = width
        self.height = height
    }

    private enum CodingKeys: String, CodingKey {
        case width = "width"
        case height = "height"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let width = try container.decode(Int.self, forKey: .width)
        let height = try container.decode(Int.self, forKey: .height)
        self.init(
            width: width,
            height: height
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(width, forKey: .width)
        try container.encode(height, forKey: .height)
    }
}

// MARK: - BoardSummary

public struct BoardSummary: Codable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let updatedAt: String
    public let itemCount: Int

    public init(
        id: String,
        title: String,
        updatedAt: String,
        itemCount: Int
    ) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
        self.itemCount = itemCount
    }

    private enum CodingKeys: String, CodingKey {
        case id = "id"
        case title = "title"
        case updatedAt = "updatedAt"
        case itemCount = "itemCount"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let title = try container.decode(String.self, forKey: .title)
        let updatedAt = try container.decode(String.self, forKey: .updatedAt)
        let itemCount = try container.decode(Int.self, forKey: .itemCount)
        self.init(
            id: id,
            title: title,
            updatedAt: updatedAt,
            itemCount: itemCount
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(itemCount, forKey: .itemCount)
    }
}

// MARK: - BoardUnprojectCardRequest

public struct BoardUnprojectCardRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: BoardUnprojectCardRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "board.unproject_card",
        payload: BoardUnprojectCardRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardUnprojectCardRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardUnprojectCardRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.unproject_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardUnprojectCardRequest.type 必須是 board.unproject_card")
        }
        let payload = try container.decode(BoardUnprojectCardRequestPayload.self, forKey: .payload)
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

// MARK: - BoardUnprojectCardRequestPayload

public struct BoardUnprojectCardRequestPayload: Codable, Equatable, Sendable {
    public let boardId: String
    public let itemId: String

    public init(
        boardId: String,
        itemId: String
    ) {
        self.boardId = boardId
        self.itemId = itemId
    }

    private enum CodingKeys: String, CodingKey {
        case boardId = "boardId"
        case itemId = "itemId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let boardId = try container.decode(String.self, forKey: .boardId)
        let itemId = try container.decode(String.self, forKey: .itemId)
        self.init(
            boardId: boardId,
            itemId: itemId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(boardId, forKey: .boardId)
        try container.encode(itemId, forKey: .itemId)
    }
}

// MARK: - BoardUnprojectCardResponse

public struct BoardUnprojectCardResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: BoardUnprojectCardResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "board.unproject_card",
        payload: BoardUnprojectCardResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "BoardUnprojectCardResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "BoardUnprojectCardResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "board.unproject_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "BoardUnprojectCardResponse.type 必須是 board.unproject_card")
        }
        let payload = try container.decode(BoardUnprojectCardResponsePayload.self, forKey: .payload)
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

// MARK: - BoardUnprojectCardResponsePayload

public struct BoardUnprojectCardResponsePayload: Codable, Equatable, Sendable {
    public let board: BoardDocument

    public init(
        board: BoardDocument
    ) {
        self.board = board
    }

    private enum CodingKeys: String, CodingKey {
        case board = "board"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let board = try container.decode(BoardDocument.self, forKey: .board)
        self.init(
            board: board
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(board, forKey: .board)
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

// MARK: - CardPatchAcceptRequest

public struct CardPatchAcceptRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardPatchAcceptRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.patch.accept",
        payload: CardPatchAcceptRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardPatchAcceptRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardPatchAcceptRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.patch.accept" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardPatchAcceptRequest.type 必須是 card.patch.accept")
        }
        let payload = try container.decode(CardPatchAcceptRequestPayload.self, forKey: .payload)
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

// MARK: - CardPatchAcceptRequestPayload

public struct CardPatchAcceptRequestPayload: Codable, Equatable, Sendable {
    public let patchId: String
    public let clientRequestId: String

    public init(
        patchId: String,
        clientRequestId: String
    ) {
        self.patchId = patchId
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case patchId = "patchId"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let patchId = try container.decode(String.self, forKey: .patchId)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            patchId: patchId,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(patchId, forKey: .patchId)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - CardPatchAcceptResponse

public struct CardPatchAcceptResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardPatchAcceptResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.patch.accept",
        payload: CardPatchAcceptResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardPatchAcceptResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardPatchAcceptResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.patch.accept" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardPatchAcceptResponse.type 必須是 card.patch.accept")
        }
        let payload = try container.decode(CardPatchAcceptResponsePayload.self, forKey: .payload)
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

// MARK: - CardPatchAcceptResponsePayload

public struct CardPatchAcceptResponsePayload: Codable, Equatable, Sendable {
    public let patch: PendingCardPatch
    public let card: Card

    public init(
        patch: PendingCardPatch,
        card: Card
    ) {
        self.patch = patch
        self.card = card
    }

    private enum CodingKeys: String, CodingKey {
        case patch = "patch"
        case card = "card"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let patch = try container.decode(PendingCardPatch.self, forKey: .patch)
        let card = try container.decode(Card.self, forKey: .card)
        self.init(
            patch: patch,
            card: card
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(patch, forKey: .patch)
        try container.encode(card, forKey: .card)
    }
}

// MARK: - CardPatchFormat

public enum CardPatchFormat: String, Codable, Equatable, Sendable, CaseIterable {
    case unified = "unified"
    case replace = "replace"
}

// MARK: - CardPatchRejectRequest

public struct CardPatchRejectRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardPatchRejectRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.patch.reject",
        payload: CardPatchRejectRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardPatchRejectRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardPatchRejectRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.patch.reject" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardPatchRejectRequest.type 必須是 card.patch.reject")
        }
        let payload = try container.decode(CardPatchRejectRequestPayload.self, forKey: .payload)
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

// MARK: - CardPatchRejectRequestPayload

public struct CardPatchRejectRequestPayload: Codable, Equatable, Sendable {
    public let patchId: String
    public let clientRequestId: String

    public init(
        patchId: String,
        clientRequestId: String
    ) {
        self.patchId = patchId
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case patchId = "patchId"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let patchId = try container.decode(String.self, forKey: .patchId)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            patchId: patchId,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(patchId, forKey: .patchId)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - CardPatchRejectResponse

public struct CardPatchRejectResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardPatchRejectResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.patch.reject",
        payload: CardPatchRejectResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardPatchRejectResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardPatchRejectResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.patch.reject" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardPatchRejectResponse.type 必須是 card.patch.reject")
        }
        let payload = try container.decode(CardPatchRejectResponsePayload.self, forKey: .payload)
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

// MARK: - CardPatchRejectResponsePayload

public struct CardPatchRejectResponsePayload: Codable, Equatable, Sendable {
    public let patch: PendingCardPatch

    public init(
        patch: PendingCardPatch
    ) {
        self.patch = patch
    }

    private enum CodingKeys: String, CodingKey {
        case patch = "patch"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let patch = try container.decode(PendingCardPatch.self, forKey: .patch)
        self.init(
            patch: patch
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(patch, forKey: .patch)
    }
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

// MARK: - CardPatchesListRequest

public struct CardPatchesListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardPatchesListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.patches.list",
        payload: CardPatchesListRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardPatchesListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardPatchesListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.patches.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardPatchesListRequest.type 必須是 card.patches.list")
        }
        let payload = try container.decode(CardPatchesListRequestPayload.self, forKey: .payload)
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

// MARK: - CardPatchesListRequestPayload

public struct CardPatchesListRequestPayload: Codable, Equatable, Sendable {
    public let cardId: String
    public let status: PendingPatchStatus?

    public init(
        cardId: String,
        status: PendingPatchStatus? = nil
    ) {
        self.cardId = cardId
        self.status = status
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case status = "status"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let status = try container.decodeIfPresent(PendingPatchStatus.self, forKey: .status)
        self.init(
            cardId: cardId,
            status: status
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encodeIfPresent(status, forKey: .status)
    }
}

// MARK: - CardPatchesListResponse

public struct CardPatchesListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardPatchesListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.patches.list",
        payload: CardPatchesListResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardPatchesListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardPatchesListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.patches.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardPatchesListResponse.type 必須是 card.patches.list")
        }
        let payload = try container.decode(CardPatchesListResponsePayload.self, forKey: .payload)
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

// MARK: - CardPatchesListResponsePayload

public struct CardPatchesListResponsePayload: Codable, Equatable, Sendable {
    public let patches: [PendingCardPatch]

    public init(
        patches: [PendingCardPatch]
    ) {
        self.patches = patches
    }

    private enum CodingKeys: String, CodingKey {
        case patches = "patches"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let patches = try container.decode([PendingCardPatch].self, forKey: .patches)
        self.init(
            patches: patches
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(patches, forKey: .patches)
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

// MARK: - CardVersion

public struct CardVersion: Codable, Equatable, Sendable {
    public let versionId: String
    public let cardId: String
    public let seq: Int
    public let kind: CardVersionKind
    public let revision: String
    public let bodyHash: String
    public let baseRevision: String?
    public let patchFormat: String?
    public let patchText: String?
    public let createdAt: String
    public let mergedCount: Int?
    public let mergedSeqRange: String?

    public init(
        versionId: String,
        cardId: String,
        seq: Int,
        kind: CardVersionKind,
        revision: String,
        bodyHash: String,
        baseRevision: String? = nil,
        patchFormat: String? = nil,
        patchText: String? = nil,
        createdAt: String,
        mergedCount: Int? = nil,
        mergedSeqRange: String? = nil
    ) {
        self.versionId = versionId
        self.cardId = cardId
        self.seq = seq
        self.kind = kind
        self.revision = revision
        self.bodyHash = bodyHash
        self.baseRevision = baseRevision
        self.patchFormat = patchFormat
        self.patchText = patchText
        self.createdAt = createdAt
        self.mergedCount = mergedCount
        self.mergedSeqRange = mergedSeqRange
    }

    private enum CodingKeys: String, CodingKey {
        case versionId = "versionId"
        case cardId = "cardId"
        case seq = "seq"
        case kind = "kind"
        case revision = "revision"
        case bodyHash = "bodyHash"
        case baseRevision = "baseRevision"
        case patchFormat = "patchFormat"
        case patchText = "patchText"
        case createdAt = "createdAt"
        case mergedCount = "mergedCount"
        case mergedSeqRange = "mergedSeqRange"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let versionId = try container.decode(String.self, forKey: .versionId)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let seq = try container.decode(Int.self, forKey: .seq)
        let kind = try container.decode(CardVersionKind.self, forKey: .kind)
        let revision = try container.decode(String.self, forKey: .revision)
        let bodyHash = try container.decode(String.self, forKey: .bodyHash)
        let baseRevision = try container.decodeIfPresent(String.self, forKey: .baseRevision)
        let patchFormat = try container.decodeIfPresent(String.self, forKey: .patchFormat)
        let patchText = try container.decodeIfPresent(String.self, forKey: .patchText)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let mergedCount = try container.decodeIfPresent(Int.self, forKey: .mergedCount)
        let mergedSeqRange = try container.decodeIfPresent(String.self, forKey: .mergedSeqRange)
        self.init(
            versionId: versionId,
            cardId: cardId,
            seq: seq,
            kind: kind,
            revision: revision,
            bodyHash: bodyHash,
            baseRevision: baseRevision,
            patchFormat: patchFormat,
            patchText: patchText,
            createdAt: createdAt,
            mergedCount: mergedCount,
            mergedSeqRange: mergedSeqRange
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(versionId, forKey: .versionId)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(seq, forKey: .seq)
        try container.encode(kind, forKey: .kind)
        try container.encode(revision, forKey: .revision)
        try container.encode(bodyHash, forKey: .bodyHash)
        try container.encodeIfPresent(baseRevision, forKey: .baseRevision)
        try container.encodeIfPresent(patchFormat, forKey: .patchFormat)
        try container.encodeIfPresent(patchText, forKey: .patchText)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(mergedCount, forKey: .mergedCount)
        try container.encodeIfPresent(mergedSeqRange, forKey: .mergedSeqRange)
    }
}

// MARK: - CardVersionGetRequest

public struct CardVersionGetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardVersionGetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.version.get",
        payload: CardVersionGetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardVersionGetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardVersionGetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.version.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardVersionGetRequest.type 必須是 card.version.get")
        }
        let payload = try container.decode(CardVersionGetRequestPayload.self, forKey: .payload)
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

// MARK: - CardVersionGetRequestPayload

public struct CardVersionGetRequestPayload: Codable, Equatable, Sendable {
    public let cardId: String
    public let versionId: String

    public init(
        cardId: String,
        versionId: String
    ) {
        self.cardId = cardId
        self.versionId = versionId
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case versionId = "versionId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let versionId = try container.decode(String.self, forKey: .versionId)
        self.init(
            cardId: cardId,
            versionId: versionId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(versionId, forKey: .versionId)
    }
}

// MARK: - CardVersionGetResponse

public struct CardVersionGetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardVersionGetResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.version.get",
        payload: CardVersionGetResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardVersionGetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardVersionGetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.version.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardVersionGetResponse.type 必須是 card.version.get")
        }
        let payload = try container.decode(CardVersionGetResponsePayload.self, forKey: .payload)
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

// MARK: - CardVersionGetResponsePayload

public struct CardVersionGetResponsePayload: Codable, Equatable, Sendable {
    public let body: String

    public init(
        body: String
    ) {
        self.body = body
    }

    private enum CodingKeys: String, CodingKey {
        case body = "body"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let body = try container.decode(String.self, forKey: .body)
        self.init(
            body: body
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(body, forKey: .body)
    }
}

// MARK: - CardVersionKind

public enum CardVersionKind: String, Codable, Equatable, Sendable, CaseIterable {
    case create = "create"
    case patch = "patch"
    case checkpoint = "checkpoint"
    case restore = "restore"
    case merge = "merge"
}

// MARK: - CardVersionRestoreRequest

public struct CardVersionRestoreRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardVersionRestoreRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.version.restore",
        payload: CardVersionRestoreRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardVersionRestoreRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardVersionRestoreRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.version.restore" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardVersionRestoreRequest.type 必須是 card.version.restore")
        }
        let payload = try container.decode(CardVersionRestoreRequestPayload.self, forKey: .payload)
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

// MARK: - CardVersionRestoreRequestPayload

public struct CardVersionRestoreRequestPayload: Codable, Equatable, Sendable {
    public let cardId: String
    public let versionId: String
    public let baseRevision: String
    public let clientRequestId: String

    public init(
        cardId: String,
        versionId: String,
        baseRevision: String,
        clientRequestId: String
    ) {
        self.cardId = cardId
        self.versionId = versionId
        self.baseRevision = baseRevision
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case cardId = "cardId"
        case versionId = "versionId"
        case baseRevision = "baseRevision"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let versionId = try container.decode(String.self, forKey: .versionId)
        let baseRevision = try container.decode(String.self, forKey: .baseRevision)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            cardId: cardId,
            versionId: versionId,
            baseRevision: baseRevision,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(versionId, forKey: .versionId)
        try container.encode(baseRevision, forKey: .baseRevision)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - CardVersionRestoreResponse

public struct CardVersionRestoreResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardVersionRestoreResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.version.restore",
        payload: CardVersionRestoreResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardVersionRestoreResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardVersionRestoreResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.version.restore" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardVersionRestoreResponse.type 必須是 card.version.restore")
        }
        let payload = try container.decode(CardVersionRestoreResponsePayload.self, forKey: .payload)
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

// MARK: - CardVersionRestoreResponsePayload

public struct CardVersionRestoreResponsePayload: Codable, Equatable, Sendable {
    public let card: Card
    public let version: CardVersion

    public init(
        card: Card,
        version: CardVersion
    ) {
        self.card = card
        self.version = version
    }

    private enum CodingKeys: String, CodingKey {
        case card = "card"
        case version = "version"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let card = try container.decode(Card.self, forKey: .card)
        let version = try container.decode(CardVersion.self, forKey: .version)
        self.init(
            card: card,
            version: version
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(card, forKey: .card)
        try container.encode(version, forKey: .version)
    }
}

// MARK: - CardVersionsListRequest

public struct CardVersionsListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: CardVersionsListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "card.versions.list",
        payload: CardVersionsListRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardVersionsListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardVersionsListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.versions.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardVersionsListRequest.type 必須是 card.versions.list")
        }
        let payload = try container.decode(CardVersionsListRequestPayload.self, forKey: .payload)
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

// MARK: - CardVersionsListRequestPayload

public struct CardVersionsListRequestPayload: Codable, Equatable, Sendable {
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

// MARK: - CardVersionsListResponse

public struct CardVersionsListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: CardVersionsListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "card.versions.list",
        payload: CardVersionsListResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "CardVersionsListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "CardVersionsListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "card.versions.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "CardVersionsListResponse.type 必須是 card.versions.list")
        }
        let payload = try container.decode(CardVersionsListResponsePayload.self, forKey: .payload)
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

// MARK: - CardVersionsListResponsePayload

public struct CardVersionsListResponsePayload: Codable, Equatable, Sendable {
    public let versions: [CardVersion]

    public init(
        versions: [CardVersion]
    ) {
        self.versions = versions
    }

    private enum CodingKeys: String, CodingKey {
        case versions = "versions"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let versions = try container.decode([CardVersion].self, forKey: .versions)
        self.init(
            versions: versions
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(versions, forKey: .versions)
    }
}

// MARK: - CardiaryNotification

public struct CardiaryNotification: Codable, Equatable, Sendable {
    public let notificationId: String
    public let kind: NotificationKind
    public let title: String
    public let body: String
    public let createdAt: String
    public let readAt: String?
    public let sourceScheduleId: String?
    public let sourceConversationId: String?
    public let payload: JSONObject

    public init(
        notificationId: String,
        kind: NotificationKind,
        title: String,
        body: String,
        createdAt: String,
        readAt: String? = nil,
        sourceScheduleId: String? = nil,
        sourceConversationId: String? = nil,
        payload: JSONObject
    ) {
        self.notificationId = notificationId
        self.kind = kind
        self.title = title
        self.body = body
        self.createdAt = createdAt
        self.readAt = readAt
        self.sourceScheduleId = sourceScheduleId
        self.sourceConversationId = sourceConversationId
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case notificationId = "notificationId"
        case kind = "kind"
        case title = "title"
        case body = "body"
        case createdAt = "createdAt"
        case readAt = "readAt"
        case sourceScheduleId = "sourceScheduleId"
        case sourceConversationId = "sourceConversationId"
        case payload = "payload"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let notificationId = try container.decode(String.self, forKey: .notificationId)
        let kind = try container.decode(NotificationKind.self, forKey: .kind)
        let title = try container.decode(String.self, forKey: .title)
        let body = try container.decode(String.self, forKey: .body)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let readAt = try container.decodeIfPresent(String.self, forKey: .readAt)
        let sourceScheduleId = try container.decodeIfPresent(String.self, forKey: .sourceScheduleId)
        let sourceConversationId = try container.decodeIfPresent(String.self, forKey: .sourceConversationId)
        let payload = try container.decode(JSONObject.self, forKey: .payload)
        self.init(
            notificationId: notificationId,
            kind: kind,
            title: title,
            body: body,
            createdAt: createdAt,
            readAt: readAt,
            sourceScheduleId: sourceScheduleId,
            sourceConversationId: sourceConversationId,
            payload: payload
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(notificationId, forKey: .notificationId)
        try container.encode(kind, forKey: .kind)
        try container.encode(title, forKey: .title)
        try container.encode(body, forKey: .body)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(readAt, forKey: .readAt)
        try container.encodeIfPresent(sourceScheduleId, forKey: .sourceScheduleId)
        try container.encodeIfPresent(sourceConversationId, forKey: .sourceConversationId)
        try container.encode(payload, forKey: .payload)
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
    case cardPatchesListRequest(CardPatchesListRequest)
    case cardPatchAcceptRequest(CardPatchAcceptRequest)
    case cardPatchRejectRequest(CardPatchRejectRequest)
    case cardVersionsListRequest(CardVersionsListRequest)
    case cardVersionGetRequest(CardVersionGetRequest)
    case cardVersionRestoreRequest(CardVersionRestoreRequest)
    case cardDeleteRequest(CardDeleteRequest)
    case cardSearchRequest(CardSearchRequest)
    case cardRefreshRequest(CardRefreshRequest)
    case boardListRequest(BoardListRequest)
    case boardGetRequest(BoardGetRequest)
    case boardCreateRequest(BoardCreateRequest)
    case boardSaveRequest(BoardSaveRequest)
    case boardDeleteRequest(BoardDeleteRequest)
    case boardProjectCardRequest(BoardProjectCardRequest)
    case boardUnprojectCardRequest(BoardUnprojectCardRequest)
    case boardCreateCardFromSelectionRequest(BoardCreateCardFromSelectionRequest)
    case mediaImportRequest(MediaImportRequest)
    case contextGetRequest(ContextGetRequest)
    case contextAddCardRequest(ContextAddCardRequest)
    case contextRemoveCardRequest(ContextRemoveCardRequest)
    case contextCompactRequest(ContextCompactRequest)
    case systemSettingsGetRequest(SystemSettingsGetRequest)
    case systemSettingsSetRequest(SystemSettingsSetRequest)
    case systemPermissionsGetRequest(SystemPermissionsGetRequest)
    case systemPermissionsSetCategoryRequest(SystemPermissionsSetCategoryRequest)
    case systemPermissionsSetDomainsRequest(SystemPermissionsSetDomainsRequest)
    case systemPermissionsGrantAllowAllRequest(SystemPermissionsGrantAllowAllRequest)
    case systemPermissionsRevokeAllowAllRequest(SystemPermissionsRevokeAllowAllRequest)
    case systemModulesGetRequest(SystemModulesGetRequest)
    case systemModulesSetEnabledRequest(SystemModulesSetEnabledRequest)
    case systemModelsGetRequest(SystemModelsGetRequest)
    case systemModelsSetRequest(SystemModelsSetRequest)
    case approvalDecideRequest(ApprovalDecideRequest)
    case approvalPauseAllRequest(ApprovalPauseAllRequest)
    case moduleRequest(ModuleRequest)
    case notificationListRequest(NotificationListRequest)
    case notificationMarkReadRequest(NotificationMarkReadRequest)
    case notificationCreateCardRequest(NotificationCreateCardRequest)
    case pairingBeginRequest(PairingBeginRequest)
    case pairingCompleteRequest(PairingCompleteRequest)
    case agentStartRequest(AgentStartRequest)
    case agentStopRequest(AgentStopRequest)
    case agentListRequest(AgentListRequest)
    case mcpServersListRequest(McpServersListRequest)
    case mcpServerAddRequest(McpServerAddRequest)
    case mcpServerRemoveRequest(McpServerRemoveRequest)
    case mcpServerSetEnabledRequest(McpServerSetEnabledRequest)
    case mcpServerAllowHostsRequest(McpServerAllowHostsRequest)
    case settingsListRequest(SettingsListRequest)
    case settingsProposeChangeRequest(SettingsProposeChangeRequest)
    case settingsChangesListRequest(SettingsChangesListRequest)
    case settingsChangeDecideRequest(SettingsChangeDecideRequest)
    case storageUsageRequest(StorageUsageRequest)
    case storageCleanupPreviewRequest(StorageCleanupPreviewRequest)
    case storageCleanupApplyRequest(StorageCleanupApplyRequest)
    case emotionGetRequest(EmotionGetRequest)

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
        case .some("card.patches.list"):
            self = .cardPatchesListRequest(try CardPatchesListRequest(from: decoder))
        case .some("card.patch.accept"):
            self = .cardPatchAcceptRequest(try CardPatchAcceptRequest(from: decoder))
        case .some("card.patch.reject"):
            self = .cardPatchRejectRequest(try CardPatchRejectRequest(from: decoder))
        case .some("card.versions.list"):
            self = .cardVersionsListRequest(try CardVersionsListRequest(from: decoder))
        case .some("card.version.get"):
            self = .cardVersionGetRequest(try CardVersionGetRequest(from: decoder))
        case .some("card.version.restore"):
            self = .cardVersionRestoreRequest(try CardVersionRestoreRequest(from: decoder))
        case .some("card.delete"):
            self = .cardDeleteRequest(try CardDeleteRequest(from: decoder))
        case .some("card.search"):
            self = .cardSearchRequest(try CardSearchRequest(from: decoder))
        case .some("card.refresh"):
            self = .cardRefreshRequest(try CardRefreshRequest(from: decoder))
        case .some("board.list"):
            self = .boardListRequest(try BoardListRequest(from: decoder))
        case .some("board.get"):
            self = .boardGetRequest(try BoardGetRequest(from: decoder))
        case .some("board.create"):
            self = .boardCreateRequest(try BoardCreateRequest(from: decoder))
        case .some("board.save"):
            self = .boardSaveRequest(try BoardSaveRequest(from: decoder))
        case .some("board.delete"):
            self = .boardDeleteRequest(try BoardDeleteRequest(from: decoder))
        case .some("board.project_card"):
            self = .boardProjectCardRequest(try BoardProjectCardRequest(from: decoder))
        case .some("board.unproject_card"):
            self = .boardUnprojectCardRequest(try BoardUnprojectCardRequest(from: decoder))
        case .some("board.create_card_from_selection"):
            self = .boardCreateCardFromSelectionRequest(try BoardCreateCardFromSelectionRequest(from: decoder))
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
        case .some("system.permissions.get"):
            self = .systemPermissionsGetRequest(try SystemPermissionsGetRequest(from: decoder))
        case .some("system.permissions.set_category"):
            self = .systemPermissionsSetCategoryRequest(try SystemPermissionsSetCategoryRequest(from: decoder))
        case .some("system.permissions.set_domains"):
            self = .systemPermissionsSetDomainsRequest(try SystemPermissionsSetDomainsRequest(from: decoder))
        case .some("system.permissions.grant_allow_all"):
            self = .systemPermissionsGrantAllowAllRequest(try SystemPermissionsGrantAllowAllRequest(from: decoder))
        case .some("system.permissions.revoke_allow_all"):
            self = .systemPermissionsRevokeAllowAllRequest(try SystemPermissionsRevokeAllowAllRequest(from: decoder))
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
        case .some("notification.list"):
            self = .notificationListRequest(try NotificationListRequest(from: decoder))
        case .some("notification.mark_read"):
            self = .notificationMarkReadRequest(try NotificationMarkReadRequest(from: decoder))
        case .some("notification.create_card"):
            self = .notificationCreateCardRequest(try NotificationCreateCardRequest(from: decoder))
        case .some("pairing.begin"):
            self = .pairingBeginRequest(try PairingBeginRequest(from: decoder))
        case .some("pairing.complete"):
            self = .pairingCompleteRequest(try PairingCompleteRequest(from: decoder))
        case .some("agent.start"):
            self = .agentStartRequest(try AgentStartRequest(from: decoder))
        case .some("agent.stop"):
            self = .agentStopRequest(try AgentStopRequest(from: decoder))
        case .some("agent.list"):
            self = .agentListRequest(try AgentListRequest(from: decoder))
        case .some("mcp.servers.list"):
            self = .mcpServersListRequest(try McpServersListRequest(from: decoder))
        case .some("mcp.server.add"):
            self = .mcpServerAddRequest(try McpServerAddRequest(from: decoder))
        case .some("mcp.server.remove"):
            self = .mcpServerRemoveRequest(try McpServerRemoveRequest(from: decoder))
        case .some("mcp.server.set_enabled"):
            self = .mcpServerSetEnabledRequest(try McpServerSetEnabledRequest(from: decoder))
        case .some("mcp.server.allow_hosts"):
            self = .mcpServerAllowHostsRequest(try McpServerAllowHostsRequest(from: decoder))
        case .some("settings.list"):
            self = .settingsListRequest(try SettingsListRequest(from: decoder))
        case .some("settings.propose_change"):
            self = .settingsProposeChangeRequest(try SettingsProposeChangeRequest(from: decoder))
        case .some("settings.changes.list"):
            self = .settingsChangesListRequest(try SettingsChangesListRequest(from: decoder))
        case .some("settings.change.decide"):
            self = .settingsChangeDecideRequest(try SettingsChangeDecideRequest(from: decoder))
        case .some("storage.usage"):
            self = .storageUsageRequest(try StorageUsageRequest(from: decoder))
        case .some("storage.cleanup.preview"):
            self = .storageCleanupPreviewRequest(try StorageCleanupPreviewRequest(from: decoder))
        case .some("storage.cleanup.apply"):
            self = .storageCleanupApplyRequest(try StorageCleanupApplyRequest(from: decoder))
        case .some("emotion.get"):
            self = .emotionGetRequest(try EmotionGetRequest(from: decoder))
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
        case .cardPatchesListRequest(let value):
            try value.encode(to: encoder)
        case .cardPatchAcceptRequest(let value):
            try value.encode(to: encoder)
        case .cardPatchRejectRequest(let value):
            try value.encode(to: encoder)
        case .cardVersionsListRequest(let value):
            try value.encode(to: encoder)
        case .cardVersionGetRequest(let value):
            try value.encode(to: encoder)
        case .cardVersionRestoreRequest(let value):
            try value.encode(to: encoder)
        case .cardDeleteRequest(let value):
            try value.encode(to: encoder)
        case .cardSearchRequest(let value):
            try value.encode(to: encoder)
        case .cardRefreshRequest(let value):
            try value.encode(to: encoder)
        case .boardListRequest(let value):
            try value.encode(to: encoder)
        case .boardGetRequest(let value):
            try value.encode(to: encoder)
        case .boardCreateRequest(let value):
            try value.encode(to: encoder)
        case .boardSaveRequest(let value):
            try value.encode(to: encoder)
        case .boardDeleteRequest(let value):
            try value.encode(to: encoder)
        case .boardProjectCardRequest(let value):
            try value.encode(to: encoder)
        case .boardUnprojectCardRequest(let value):
            try value.encode(to: encoder)
        case .boardCreateCardFromSelectionRequest(let value):
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
        case .systemPermissionsGetRequest(let value):
            try value.encode(to: encoder)
        case .systemPermissionsSetCategoryRequest(let value):
            try value.encode(to: encoder)
        case .systemPermissionsSetDomainsRequest(let value):
            try value.encode(to: encoder)
        case .systemPermissionsGrantAllowAllRequest(let value):
            try value.encode(to: encoder)
        case .systemPermissionsRevokeAllowAllRequest(let value):
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
        case .notificationListRequest(let value):
            try value.encode(to: encoder)
        case .notificationMarkReadRequest(let value):
            try value.encode(to: encoder)
        case .notificationCreateCardRequest(let value):
            try value.encode(to: encoder)
        case .pairingBeginRequest(let value):
            try value.encode(to: encoder)
        case .pairingCompleteRequest(let value):
            try value.encode(to: encoder)
        case .agentStartRequest(let value):
            try value.encode(to: encoder)
        case .agentStopRequest(let value):
            try value.encode(to: encoder)
        case .agentListRequest(let value):
            try value.encode(to: encoder)
        case .mcpServersListRequest(let value):
            try value.encode(to: encoder)
        case .mcpServerAddRequest(let value):
            try value.encode(to: encoder)
        case .mcpServerRemoveRequest(let value):
            try value.encode(to: encoder)
        case .mcpServerSetEnabledRequest(let value):
            try value.encode(to: encoder)
        case .mcpServerAllowHostsRequest(let value):
            try value.encode(to: encoder)
        case .settingsListRequest(let value):
            try value.encode(to: encoder)
        case .settingsProposeChangeRequest(let value):
            try value.encode(to: encoder)
        case .settingsChangesListRequest(let value):
            try value.encode(to: encoder)
        case .settingsChangeDecideRequest(let value):
            try value.encode(to: encoder)
        case .storageUsageRequest(let value):
            try value.encode(to: encoder)
        case .storageCleanupPreviewRequest(let value):
            try value.encode(to: encoder)
        case .storageCleanupApplyRequest(let value):
            try value.encode(to: encoder)
        case .emotionGetRequest(let value):
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

// MARK: - ContextDealSource

public enum ContextDealSource: String, Codable, Equatable, Sendable, CaseIterable {
    case systemOne = "system-one"
    case retrieval = "retrieval"
    case manual = "manual"
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
    public let dealProbability: Double?
    public let dealSource: ContextDealSource?

    public init(
        entryId: String,
        layer: ContextLayer,
        cardId: String? = nil,
        title: String,
        tokenEstimate: Int,
        state: ContextEntryState,
        position: Int,
        dealProbability: Double? = nil,
        dealSource: ContextDealSource? = nil
    ) {
        self.entryId = entryId
        self.layer = layer
        self.cardId = cardId
        self.title = title
        self.tokenEstimate = tokenEstimate
        self.state = state
        self.position = position
        self.dealProbability = dealProbability
        self.dealSource = dealSource
    }

    private enum CodingKeys: String, CodingKey {
        case entryId = "entryId"
        case layer = "layer"
        case cardId = "cardId"
        case title = "title"
        case tokenEstimate = "tokenEstimate"
        case state = "state"
        case position = "position"
        case dealProbability = "dealProbability"
        case dealSource = "dealSource"
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
        let dealProbability = try container.decodeIfPresent(Double.self, forKey: .dealProbability)
        let dealSource = try container.decodeIfPresent(ContextDealSource.self, forKey: .dealSource)
        self.init(
            entryId: entryId,
            layer: layer,
            cardId: cardId,
            title: title,
            tokenEstimate: tokenEstimate,
            state: state,
            position: position,
            dealProbability: dealProbability,
            dealSource: dealSource
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
        try container.encodeIfPresent(dealProbability, forKey: .dealProbability)
        try container.encodeIfPresent(dealSource, forKey: .dealSource)
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

// MARK: - DelegatedCategory

public enum DelegatedCategory: String, Codable, Equatable, Sendable, CaseIterable {
    case readOnlyFiles = "read-only-files"
    case gitReadonly = "git-readonly"
    case createCard = "create-card"
    case ownNotification = "own-notification"
}

// MARK: - DelegatedCategoryGrant

public struct DelegatedCategoryGrant: Codable, Equatable, Sendable {
    public let category: DelegatedCategory
    public let paths: [String]

    public init(
        category: DelegatedCategory,
        paths: [String]
    ) {
        self.category = category
        self.paths = paths
    }

    private enum CodingKeys: String, CodingKey {
        case category = "category"
        case paths = "paths"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let category = try container.decode(DelegatedCategory.self, forKey: .category)
        let paths = try container.decode([String].self, forKey: .paths)
        self.init(
            category: category,
            paths: paths
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(category, forKey: .category)
        try container.encode(paths, forKey: .paths)
    }
}

// MARK: - DeliveryMode

public enum DeliveryMode: String, Codable, Equatable, Sendable, CaseIterable {
    case queue = "queue"
    case steer = "steer"
    case interrupt = "interrupt"
}

// MARK: - DeviceKind

public enum DeviceKind: String, Codable, Equatable, Sendable, CaseIterable {
    case web = "web"
    case ios = "ios"
}

// MARK: - DeviceListChangedEventPayload

public struct DeviceListChangedEventPayload: Codable, Equatable, Sendable {
    public let devices: [PairedDevice]

    public init(
        devices: [PairedDevice]
    ) {
        self.devices = devices
    }

    private enum CodingKeys: String, CodingKey {
        case devices = "devices"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let devices = try container.decode([PairedDevice].self, forKey: .devices)
        self.init(
            devices: devices
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(devices, forKey: .devices)
    }
}

// MARK: - DeviceListResponsePayload

public struct DeviceListResponsePayload: Codable, Equatable, Sendable {
    public let devices: [PairedDevice]

    public init(
        devices: [PairedDevice]
    ) {
        self.devices = devices
    }

    private enum CodingKeys: String, CodingKey {
        case devices = "devices"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let devices = try container.decode([PairedDevice].self, forKey: .devices)
        self.init(
            devices: devices
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(devices, forKey: .devices)
    }
}

// MARK: - DeviceRevokeRequestPayload

public struct DeviceRevokeRequestPayload: Codable, Equatable, Sendable {
    public let deviceId: String

    public init(
        deviceId: String
    ) {
        self.deviceId = deviceId
    }

    private enum CodingKeys: String, CodingKey {
        case deviceId = "deviceId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let deviceId = try container.decode(String.self, forKey: .deviceId)
        self.init(
            deviceId: deviceId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceId, forKey: .deviceId)
    }
}

// MARK: - DeviceRevokeResponsePayload

public struct DeviceRevokeResponsePayload: Codable, Equatable, Sendable {
    public let revoked: Bool
    public let deviceId: String

    public init(
        revoked: Bool,
        deviceId: String
    ) {
        self.revoked = revoked
        self.deviceId = deviceId
    }

    private enum CodingKeys: String, CodingKey {
        case revoked = "revoked"
        case deviceId = "deviceId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let revoked = try container.decode(Bool.self, forKey: .revoked)
        let deviceId = try container.decode(String.self, forKey: .deviceId)
        self.init(
            revoked: revoked,
            deviceId: deviceId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(revoked, forKey: .revoked)
        try container.encode(deviceId, forKey: .deviceId)
    }
}

// MARK: - EmotionGetRequest

public struct EmotionGetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: EmotionGetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "emotion.get",
        payload: EmotionGetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "EmotionGetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "EmotionGetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "emotion.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "EmotionGetRequest.type 必須是 emotion.get")
        }
        let payload = try container.decode(EmotionGetRequestPayload.self, forKey: .payload)
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

// MARK: - EmotionGetRequestPayload

public struct EmotionGetRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - EmotionGetResponse

public struct EmotionGetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: EmotionGetResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "emotion.get",
        payload: EmotionGetResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "EmotionGetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "EmotionGetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "emotion.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "EmotionGetResponse.type 必須是 emotion.get")
        }
        let payload = try container.decode(EmotionGetResponsePayload.self, forKey: .payload)
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

// MARK: - EmotionGetResponsePayload

public struct EmotionGetResponsePayload: Codable, Equatable, Sendable {
    public let dimensions: JSONObject
    public let updatedAt: String

    public init(
        dimensions: JSONObject,
        updatedAt: String
    ) {
        self.dimensions = dimensions
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case dimensions = "dimensions"
        case updatedAt = "updatedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let dimensions = try container.decode(JSONObject.self, forKey: .dimensions)
        let updatedAt = try container.decode(String.self, forKey: .updatedAt)
        self.init(
            dimensions: dimensions,
            updatedAt: updatedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(dimensions, forKey: .dimensions)
        try container.encode(updatedAt, forKey: .updatedAt)
    }
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

// MARK: - McpPersistentDataInfo

public struct McpPersistentDataInfo: Codable, Equatable, Sendable {
    public let allowed: Bool
    public let bytes: Int
    public let files: Int

    public init(
        allowed: Bool,
        bytes: Int,
        files: Int
    ) {
        self.allowed = allowed
        self.bytes = bytes
        self.files = files
    }

    private enum CodingKeys: String, CodingKey {
        case allowed = "allowed"
        case bytes = "bytes"
        case files = "files"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let allowed = try container.decode(Bool.self, forKey: .allowed)
        let bytes = try container.decode(Int.self, forKey: .bytes)
        let files = try container.decode(Int.self, forKey: .files)
        self.init(
            allowed: allowed,
            bytes: bytes,
            files: files
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(allowed, forKey: .allowed)
        try container.encode(bytes, forKey: .bytes)
        try container.encode(files, forKey: .files)
    }
}

// MARK: - McpServerAddRequest

public struct McpServerAddRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: McpServerAddRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "mcp.server.add",
        payload: McpServerAddRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServerAddRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServerAddRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.server.add" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServerAddRequest.type 必須是 mcp.server.add")
        }
        let payload = try container.decode(McpServerAddRequestPayload.self, forKey: .payload)
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

// MARK: - McpServerAddRequestPayload

public struct McpServerAddRequestPayload: Codable, Equatable, Sendable {
    public let name: String
    public let transport: McpTransport
    public let command: String?
    public let args: [String]?
    public let url: String?
    public let allowedHosts: [String]
    public let clientRequestId: String?
    public let persistentData: Bool?

    public init(
        name: String,
        transport: McpTransport,
        command: String? = nil,
        args: [String]? = nil,
        url: String? = nil,
        allowedHosts: [String],
        clientRequestId: String? = nil,
        persistentData: Bool? = nil
    ) {
        self.name = name
        self.transport = transport
        self.command = command
        self.args = args
        self.url = url
        self.allowedHosts = allowedHosts
        self.clientRequestId = clientRequestId
        self.persistentData = persistentData
    }

    private enum CodingKeys: String, CodingKey {
        case name = "name"
        case transport = "transport"
        case command = "command"
        case args = "args"
        case url = "url"
        case allowedHosts = "allowedHosts"
        case clientRequestId = "clientRequestId"
        case persistentData = "persistentData"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let name = try container.decode(String.self, forKey: .name)
        let transport = try container.decode(McpTransport.self, forKey: .transport)
        let command = try container.decodeIfPresent(String.self, forKey: .command)
        let args = try container.decodeIfPresent([String].self, forKey: .args)
        let url = try container.decodeIfPresent(String.self, forKey: .url)
        let allowedHosts = try container.decode([String].self, forKey: .allowedHosts)
        let clientRequestId = try container.decodeIfPresent(String.self, forKey: .clientRequestId)
        let persistentData = try container.decodeIfPresent(Bool.self, forKey: .persistentData)
        self.init(
            name: name,
            transport: transport,
            command: command,
            args: args,
            url: url,
            allowedHosts: allowedHosts,
            clientRequestId: clientRequestId,
            persistentData: persistentData
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(transport, forKey: .transport)
        try container.encodeIfPresent(command, forKey: .command)
        try container.encodeIfPresent(args, forKey: .args)
        try container.encodeIfPresent(url, forKey: .url)
        try container.encode(allowedHosts, forKey: .allowedHosts)
        try container.encodeIfPresent(clientRequestId, forKey: .clientRequestId)
        try container.encodeIfPresent(persistentData, forKey: .persistentData)
    }
}

// MARK: - McpServerAddResponse

public struct McpServerAddResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: McpServerAddResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "mcp.server.add",
        payload: McpServerAddResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServerAddResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServerAddResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.server.add" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServerAddResponse.type 必須是 mcp.server.add")
        }
        let payload = try container.decode(McpServerAddResponsePayload.self, forKey: .payload)
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

// MARK: - McpServerAddResponsePayload

public struct McpServerAddResponsePayload: Codable, Equatable, Sendable {
    public let approvalId: String

    public init(
        approvalId: String
    ) {
        self.approvalId = approvalId
    }

    private enum CodingKeys: String, CodingKey {
        case approvalId = "approvalId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let approvalId = try container.decode(String.self, forKey: .approvalId)
        self.init(
            approvalId: approvalId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(approvalId, forKey: .approvalId)
    }
}

// MARK: - McpServerAllowHostsRequest

public struct McpServerAllowHostsRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: McpServerAllowHostsRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "mcp.server.allow_hosts",
        payload: McpServerAllowHostsRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServerAllowHostsRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServerAllowHostsRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.server.allow_hosts" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServerAllowHostsRequest.type 必須是 mcp.server.allow_hosts")
        }
        let payload = try container.decode(McpServerAllowHostsRequestPayload.self, forKey: .payload)
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

// MARK: - McpServerAllowHostsRequestPayload

public struct McpServerAllowHostsRequestPayload: Codable, Equatable, Sendable {
    public let serverId: String
    public let allowedHosts: [String]

    public init(
        serverId: String,
        allowedHosts: [String]
    ) {
        self.serverId = serverId
        self.allowedHosts = allowedHosts
    }

    private enum CodingKeys: String, CodingKey {
        case serverId = "serverId"
        case allowedHosts = "allowedHosts"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let serverId = try container.decode(String.self, forKey: .serverId)
        let allowedHosts = try container.decode([String].self, forKey: .allowedHosts)
        self.init(
            serverId: serverId,
            allowedHosts: allowedHosts
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(serverId, forKey: .serverId)
        try container.encode(allowedHosts, forKey: .allowedHosts)
    }
}

// MARK: - McpServerAllowHostsResponse

public struct McpServerAllowHostsResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: McpServerAllowHostsResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "mcp.server.allow_hosts",
        payload: McpServerAllowHostsResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServerAllowHostsResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServerAllowHostsResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.server.allow_hosts" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServerAllowHostsResponse.type 必須是 mcp.server.allow_hosts")
        }
        let payload = try container.decode(McpServerAllowHostsResponsePayload.self, forKey: .payload)
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

// MARK: - McpServerAllowHostsResponsePayload

public struct McpServerAllowHostsResponsePayload: Codable, Equatable, Sendable {
    public let server: McpServerInfo

    public init(
        server: McpServerInfo
    ) {
        self.server = server
    }

    private enum CodingKeys: String, CodingKey {
        case server = "server"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let server = try container.decode(McpServerInfo.self, forKey: .server)
        self.init(
            server: server
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(server, forKey: .server)
    }
}

// MARK: - McpServerInfo

public struct McpServerInfo: Codable, Equatable, Sendable {
    public let serverId: String
    public let name: String
    public let transport: McpTransport
    public let command: String?
    public let args: [String]?
    public let url: String?
    public let allowedHosts: [String]
    public let enabled: Bool
    public let state: McpServerState
    public let failure: String?
    public let persistentData: McpPersistentDataInfo?
    public let createdAt: String
    public let updatedAt: String?

    public init(
        serverId: String,
        name: String,
        transport: McpTransport,
        command: String? = nil,
        args: [String]? = nil,
        url: String? = nil,
        allowedHosts: [String],
        enabled: Bool,
        state: McpServerState,
        failure: String? = nil,
        persistentData: McpPersistentDataInfo? = nil,
        createdAt: String,
        updatedAt: String? = nil
    ) {
        self.serverId = serverId
        self.name = name
        self.transport = transport
        self.command = command
        self.args = args
        self.url = url
        self.allowedHosts = allowedHosts
        self.enabled = enabled
        self.state = state
        self.failure = failure
        self.persistentData = persistentData
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case serverId = "serverId"
        case name = "name"
        case transport = "transport"
        case command = "command"
        case args = "args"
        case url = "url"
        case allowedHosts = "allowedHosts"
        case enabled = "enabled"
        case state = "state"
        case failure = "failure"
        case persistentData = "persistentData"
        case createdAt = "createdAt"
        case updatedAt = "updatedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let serverId = try container.decode(String.self, forKey: .serverId)
        let name = try container.decode(String.self, forKey: .name)
        let transport = try container.decode(McpTransport.self, forKey: .transport)
        let command = try container.decodeIfPresent(String.self, forKey: .command)
        let args = try container.decodeIfPresent([String].self, forKey: .args)
        let url = try container.decodeIfPresent(String.self, forKey: .url)
        let allowedHosts = try container.decode([String].self, forKey: .allowedHosts)
        let enabled = try container.decode(Bool.self, forKey: .enabled)
        let state = try container.decode(McpServerState.self, forKey: .state)
        let failure = try container.decodeIfPresent(String.self, forKey: .failure)
        let persistentData = try container.decodeIfPresent(McpPersistentDataInfo.self, forKey: .persistentData)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        self.init(
            serverId: serverId,
            name: name,
            transport: transport,
            command: command,
            args: args,
            url: url,
            allowedHosts: allowedHosts,
            enabled: enabled,
            state: state,
            failure: failure,
            persistentData: persistentData,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(serverId, forKey: .serverId)
        try container.encode(name, forKey: .name)
        try container.encode(transport, forKey: .transport)
        try container.encodeIfPresent(command, forKey: .command)
        try container.encodeIfPresent(args, forKey: .args)
        try container.encodeIfPresent(url, forKey: .url)
        try container.encode(allowedHosts, forKey: .allowedHosts)
        try container.encode(enabled, forKey: .enabled)
        try container.encode(state, forKey: .state)
        try container.encodeIfPresent(failure, forKey: .failure)
        try container.encodeIfPresent(persistentData, forKey: .persistentData)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }
}

// MARK: - McpServerRemoveRequest

public struct McpServerRemoveRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: McpServerRemoveRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "mcp.server.remove",
        payload: McpServerRemoveRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServerRemoveRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServerRemoveRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.server.remove" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServerRemoveRequest.type 必須是 mcp.server.remove")
        }
        let payload = try container.decode(McpServerRemoveRequestPayload.self, forKey: .payload)
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

// MARK: - McpServerRemoveRequestPayload

public struct McpServerRemoveRequestPayload: Codable, Equatable, Sendable {
    public let serverId: String

    public init(
        serverId: String
    ) {
        self.serverId = serverId
    }

    private enum CodingKeys: String, CodingKey {
        case serverId = "serverId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let serverId = try container.decode(String.self, forKey: .serverId)
        self.init(
            serverId: serverId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(serverId, forKey: .serverId)
    }
}

// MARK: - McpServerRemoveResponse

public struct McpServerRemoveResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: McpServerRemoveResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "mcp.server.remove",
        payload: McpServerRemoveResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServerRemoveResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServerRemoveResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.server.remove" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServerRemoveResponse.type 必須是 mcp.server.remove")
        }
        let payload = try container.decode(McpServerRemoveResponsePayload.self, forKey: .payload)
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

// MARK: - McpServerRemoveResponsePayload

public struct McpServerRemoveResponsePayload: Codable, Equatable, Sendable {
    public let serverId: String
    public let removed: Bool

    public init(
        serverId: String,
        removed: Bool
    ) {
        self.serverId = serverId
        self.removed = removed
    }

    private enum CodingKeys: String, CodingKey {
        case serverId = "serverId"
        case removed = "removed"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let serverId = try container.decode(String.self, forKey: .serverId)
        let removed = try container.decode(Bool.self, forKey: .removed)
        self.init(
            serverId: serverId,
            removed: removed
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(serverId, forKey: .serverId)
        try container.encode(removed, forKey: .removed)
    }
}

// MARK: - McpServerSetEnabledRequest

public struct McpServerSetEnabledRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: McpServerSetEnabledRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "mcp.server.set_enabled",
        payload: McpServerSetEnabledRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServerSetEnabledRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServerSetEnabledRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.server.set_enabled" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServerSetEnabledRequest.type 必須是 mcp.server.set_enabled")
        }
        let payload = try container.decode(McpServerSetEnabledRequestPayload.self, forKey: .payload)
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

// MARK: - McpServerSetEnabledRequestPayload

public struct McpServerSetEnabledRequestPayload: Codable, Equatable, Sendable {
    public let serverId: String
    public let enabled: Bool
    public let clientRequestId: String?

    public init(
        serverId: String,
        enabled: Bool,
        clientRequestId: String? = nil
    ) {
        self.serverId = serverId
        self.enabled = enabled
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case serverId = "serverId"
        case enabled = "enabled"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let serverId = try container.decode(String.self, forKey: .serverId)
        let enabled = try container.decode(Bool.self, forKey: .enabled)
        let clientRequestId = try container.decodeIfPresent(String.self, forKey: .clientRequestId)
        self.init(
            serverId: serverId,
            enabled: enabled,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(serverId, forKey: .serverId)
        try container.encode(enabled, forKey: .enabled)
        try container.encodeIfPresent(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - McpServerSetEnabledResponse

public struct McpServerSetEnabledResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: McpServerSetEnabledResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "mcp.server.set_enabled",
        payload: McpServerSetEnabledResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServerSetEnabledResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServerSetEnabledResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.server.set_enabled" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServerSetEnabledResponse.type 必須是 mcp.server.set_enabled")
        }
        let payload = try container.decode(McpServerSetEnabledResponsePayload.self, forKey: .payload)
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

// MARK: - McpServerSetEnabledResponsePayload

public struct McpServerSetEnabledResponsePayload: Codable, Equatable, Sendable {
    public let server: McpServerInfo

    public init(
        server: McpServerInfo
    ) {
        self.server = server
    }

    private enum CodingKeys: String, CodingKey {
        case server = "server"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let server = try container.decode(McpServerInfo.self, forKey: .server)
        self.init(
            server: server
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(server, forKey: .server)
    }
}

// MARK: - McpServerState

public enum McpServerState: String, Codable, Equatable, Sendable, CaseIterable {
    case disabled = "disabled"
    case ready = "ready"
    case failed = "failed"
}

// MARK: - McpServersChangedEvent

public struct McpServersChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: McpServersChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "mcp.servers_changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: McpServersChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServersChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServersChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.servers_changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServersChangedEvent.type 必須是 mcp.servers_changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(McpServersChangedEventPayload.self, forKey: .payload)
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

// MARK: - McpServersChangedEventPayload

public struct McpServersChangedEventPayload: Codable, Equatable, Sendable {
    public let server: McpServerInfo
    public let removed: Bool

    public init(
        server: McpServerInfo,
        removed: Bool
    ) {
        self.server = server
        self.removed = removed
    }

    private enum CodingKeys: String, CodingKey {
        case server = "server"
        case removed = "removed"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let server = try container.decode(McpServerInfo.self, forKey: .server)
        let removed = try container.decode(Bool.self, forKey: .removed)
        self.init(
            server: server,
            removed: removed
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(server, forKey: .server)
        try container.encode(removed, forKey: .removed)
    }
}

// MARK: - McpServersListRequest

public struct McpServersListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: McpServersListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "mcp.servers.list",
        payload: McpServersListRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServersListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServersListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.servers.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServersListRequest.type 必須是 mcp.servers.list")
        }
        let payload = try container.decode(McpServersListRequestPayload.self, forKey: .payload)
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

// MARK: - McpServersListRequestPayload

public struct McpServersListRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - McpServersListResponse

public struct McpServersListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: McpServersListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "mcp.servers.list",
        payload: McpServersListResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "McpServersListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "McpServersListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "mcp.servers.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "McpServersListResponse.type 必須是 mcp.servers.list")
        }
        let payload = try container.decode(McpServersListResponsePayload.self, forKey: .payload)
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

// MARK: - McpServersListResponsePayload

public struct McpServersListResponsePayload: Codable, Equatable, Sendable {
    public let servers: [McpServerInfo]

    public init(
        servers: [McpServerInfo]
    ) {
        self.servers = servers
    }

    private enum CodingKeys: String, CodingKey {
        case servers = "servers"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let servers = try container.decode([McpServerInfo].self, forKey: .servers)
        self.init(
            servers: servers
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(servers, forKey: .servers)
    }
}

// MARK: - McpTransport

public enum McpTransport: String, Codable, Equatable, Sendable, CaseIterable {
    case stdio = "stdio"
    case http = "http"
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

// MARK: - NotificationChangedEvent

public struct NotificationChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: NotificationChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "notification.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: NotificationChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "NotificationChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "NotificationChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "notification.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "NotificationChangedEvent.type 必須是 notification.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(NotificationChangedEventPayload.self, forKey: .payload)
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

// MARK: - NotificationChangedEventPayload

public struct NotificationChangedEventPayload: Codable, Equatable, Sendable {
    public let notification: CardiaryNotification

    public init(
        notification: CardiaryNotification
    ) {
        self.notification = notification
    }

    private enum CodingKeys: String, CodingKey {
        case notification = "notification"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let notification = try container.decode(CardiaryNotification.self, forKey: .notification)
        self.init(
            notification: notification
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(notification, forKey: .notification)
    }
}

// MARK: - NotificationCreateCardRequest

public struct NotificationCreateCardRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: NotificationCreateCardRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "notification.create_card",
        payload: NotificationCreateCardRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "NotificationCreateCardRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "NotificationCreateCardRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "notification.create_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "NotificationCreateCardRequest.type 必須是 notification.create_card")
        }
        let payload = try container.decode(NotificationCreateCardRequestPayload.self, forKey: .payload)
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

// MARK: - NotificationCreateCardRequestPayload

public struct NotificationCreateCardRequestPayload: Codable, Equatable, Sendable {
    public let notificationId: String

    public init(
        notificationId: String
    ) {
        self.notificationId = notificationId
    }

    private enum CodingKeys: String, CodingKey {
        case notificationId = "notificationId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let notificationId = try container.decode(String.self, forKey: .notificationId)
        self.init(
            notificationId: notificationId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(notificationId, forKey: .notificationId)
    }
}

// MARK: - NotificationCreateCardResponse

public struct NotificationCreateCardResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: NotificationCreateCardResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "notification.create_card",
        payload: NotificationCreateCardResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "NotificationCreateCardResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "NotificationCreateCardResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "notification.create_card" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "NotificationCreateCardResponse.type 必須是 notification.create_card")
        }
        let payload = try container.decode(NotificationCreateCardResponsePayload.self, forKey: .payload)
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

// MARK: - NotificationCreateCardResponsePayload

public struct NotificationCreateCardResponsePayload: Codable, Equatable, Sendable {
    public let card: CardSummary
    public let deduped: Bool

    public init(
        card: CardSummary,
        deduped: Bool
    ) {
        self.card = card
        self.deduped = deduped
    }

    private enum CodingKeys: String, CodingKey {
        case card = "card"
        case deduped = "deduped"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let card = try container.decode(CardSummary.self, forKey: .card)
        let deduped = try container.decode(Bool.self, forKey: .deduped)
        self.init(
            card: card,
            deduped: deduped
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(card, forKey: .card)
        try container.encode(deduped, forKey: .deduped)
    }
}

// MARK: - NotificationKind

public enum NotificationKind: String, Codable, Equatable, Sendable, CaseIterable {
    case schedule = "schedule"
    case heartbeat = "heartbeat"
    case distillation = "distillation"
}

// MARK: - NotificationListRequest

public struct NotificationListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: NotificationListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "notification.list",
        payload: NotificationListRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "NotificationListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "NotificationListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "notification.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "NotificationListRequest.type 必須是 notification.list")
        }
        let payload = try container.decode(NotificationListRequestPayload.self, forKey: .payload)
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

// MARK: - NotificationListRequestPayload

public struct NotificationListRequestPayload: Codable, Equatable, Sendable {
    public let limit: Int?
    public let before: String?
    public let unreadOnly: Bool?

    public init(
        limit: Int? = nil,
        before: String? = nil,
        unreadOnly: Bool? = nil
    ) {
        self.limit = limit
        self.before = before
        self.unreadOnly = unreadOnly
    }

    private enum CodingKeys: String, CodingKey {
        case limit = "limit"
        case before = "before"
        case unreadOnly = "unreadOnly"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let limit = try container.decodeIfPresent(Int.self, forKey: .limit)
        let before = try container.decodeIfPresent(String.self, forKey: .before)
        let unreadOnly = try container.decodeIfPresent(Bool.self, forKey: .unreadOnly)
        self.init(
            limit: limit,
            before: before,
            unreadOnly: unreadOnly
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(limit, forKey: .limit)
        try container.encodeIfPresent(before, forKey: .before)
        try container.encodeIfPresent(unreadOnly, forKey: .unreadOnly)
    }
}

// MARK: - NotificationListResponse

public struct NotificationListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: NotificationListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "notification.list",
        payload: NotificationListResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "NotificationListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "NotificationListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "notification.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "NotificationListResponse.type 必須是 notification.list")
        }
        let payload = try container.decode(NotificationListResponsePayload.self, forKey: .payload)
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

// MARK: - NotificationListResponsePayload

public struct NotificationListResponsePayload: Codable, Equatable, Sendable {
    public let notifications: [CardiaryNotification]
    public let totalUnread: Int
    public let nextCursor: String?

    public init(
        notifications: [CardiaryNotification],
        totalUnread: Int,
        nextCursor: String? = nil
    ) {
        self.notifications = notifications
        self.totalUnread = totalUnread
        self.nextCursor = nextCursor
    }

    private enum CodingKeys: String, CodingKey {
        case notifications = "notifications"
        case totalUnread = "totalUnread"
        case nextCursor = "nextCursor"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let notifications = try container.decode([CardiaryNotification].self, forKey: .notifications)
        let totalUnread = try container.decode(Int.self, forKey: .totalUnread)
        let nextCursor = try container.decodeIfPresent(String.self, forKey: .nextCursor)
        self.init(
            notifications: notifications,
            totalUnread: totalUnread,
            nextCursor: nextCursor
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(notifications, forKey: .notifications)
        try container.encode(totalUnread, forKey: .totalUnread)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }
}

// MARK: - NotificationMarkReadRequest

public struct NotificationMarkReadRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: NotificationMarkReadRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "notification.mark_read",
        payload: NotificationMarkReadRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "NotificationMarkReadRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "NotificationMarkReadRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "notification.mark_read" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "NotificationMarkReadRequest.type 必須是 notification.mark_read")
        }
        let payload = try container.decode(NotificationMarkReadRequestPayload.self, forKey: .payload)
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

// MARK: - NotificationMarkReadRequestPayload

public struct NotificationMarkReadRequestPayload: Codable, Equatable, Sendable {
    public let ids: [String]?
    public let all: Bool?

    public init(
        ids: [String]? = nil,
        all: Bool? = nil
    ) {
        self.ids = ids
        self.all = all
    }

    private enum CodingKeys: String, CodingKey {
        case ids = "ids"
        case all = "all"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ids = try container.decodeIfPresent([String].self, forKey: .ids)
        let all = try container.decodeIfPresent(Bool.self, forKey: .all)
        self.init(
            ids: ids,
            all: all
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(ids, forKey: .ids)
        try container.encodeIfPresent(all, forKey: .all)
    }
}

// MARK: - NotificationMarkReadResponse

public struct NotificationMarkReadResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: NotificationMarkReadResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "notification.mark_read",
        payload: NotificationMarkReadResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "NotificationMarkReadResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "NotificationMarkReadResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "notification.mark_read" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "NotificationMarkReadResponse.type 必須是 notification.mark_read")
        }
        let payload = try container.decode(NotificationMarkReadResponsePayload.self, forKey: .payload)
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

// MARK: - NotificationMarkReadResponsePayload

public struct NotificationMarkReadResponsePayload: Codable, Equatable, Sendable {
    public let updated: Int
    public let totalUnread: Int

    public init(
        updated: Int,
        totalUnread: Int
    ) {
        self.updated = updated
        self.totalUnread = totalUnread
    }

    private enum CodingKeys: String, CodingKey {
        case updated = "updated"
        case totalUnread = "totalUnread"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let updated = try container.decode(Int.self, forKey: .updated)
        let totalUnread = try container.decode(Int.self, forKey: .totalUnread)
        self.init(
            updated: updated,
            totalUnread: totalUnread
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(updated, forKey: .updated)
        try container.encode(totalUnread, forKey: .totalUnread)
    }
}

// MARK: - OutsideWriteStatus

public enum OutsideWriteStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case measured = "measured"
    case absent = "absent"
    case unavailable = "unavailable"
}

// MARK: - PairedDevice

public struct PairedDevice: Codable, Equatable, Sendable {
    public let deviceId: String
    public let name: String
    public let kind: DeviceKind
    public let createdAt: String
    public let lastUsedAt: String?
    public let revokedAt: String?

    public init(
        deviceId: String,
        name: String,
        kind: DeviceKind,
        createdAt: String,
        lastUsedAt: String? = nil,
        revokedAt: String? = nil
    ) {
        self.deviceId = deviceId
        self.name = name
        self.kind = kind
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
        self.revokedAt = revokedAt
    }

    private enum CodingKeys: String, CodingKey {
        case deviceId = "deviceId"
        case name = "name"
        case kind = "kind"
        case createdAt = "createdAt"
        case lastUsedAt = "lastUsedAt"
        case revokedAt = "revokedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let deviceId = try container.decode(String.self, forKey: .deviceId)
        let name = try container.decode(String.self, forKey: .name)
        let kind = try container.decode(DeviceKind.self, forKey: .kind)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let lastUsedAt = try container.decodeIfPresent(String.self, forKey: .lastUsedAt)
        let revokedAt = try container.decodeIfPresent(String.self, forKey: .revokedAt)
        self.init(
            deviceId: deviceId,
            name: name,
            kind: kind,
            createdAt: createdAt,
            lastUsedAt: lastUsedAt,
            revokedAt: revokedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceId, forKey: .deviceId)
        try container.encode(name, forKey: .name)
        try container.encode(kind, forKey: .kind)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(lastUsedAt, forKey: .lastUsedAt)
        try container.encodeIfPresent(revokedAt, forKey: .revokedAt)
    }
}

// MARK: - PairingApproveRequestPayload

public struct PairingApproveRequestPayload: Codable, Equatable, Sendable {
    public let pairingRequestId: String

    public init(
        pairingRequestId: String
    ) {
        self.pairingRequestId = pairingRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case pairingRequestId = "pairingRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let pairingRequestId = try container.decode(String.self, forKey: .pairingRequestId)
        self.init(
            pairingRequestId: pairingRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pairingRequestId, forKey: .pairingRequestId)
    }
}

// MARK: - PairingApproveResponsePayload

public struct PairingApproveResponsePayload: Codable, Equatable, Sendable {
    public let approved: Bool
    public let deviceId: String

    public init(
        approved: Bool,
        deviceId: String
    ) {
        self.approved = approved
        self.deviceId = deviceId
    }

    private enum CodingKeys: String, CodingKey {
        case approved = "approved"
        case deviceId = "deviceId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let approved = try container.decode(Bool.self, forKey: .approved)
        let deviceId = try container.decode(String.self, forKey: .deviceId)
        self.init(
            approved: approved,
            deviceId: deviceId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(approved, forKey: .approved)
        try container.encode(deviceId, forKey: .deviceId)
    }
}

// MARK: - PairingBeginRequest

public struct PairingBeginRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: PairingBeginRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "pairing.begin",
        payload: PairingBeginRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "PairingBeginRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "PairingBeginRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "pairing.begin" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "PairingBeginRequest.type 必須是 pairing.begin")
        }
        let payload = try container.decode(PairingBeginRequestPayload.self, forKey: .payload)
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

// MARK: - PairingBeginRequestPayload

public struct PairingBeginRequestPayload: Codable, Equatable, Sendable {
    public let deviceName: String
    public let kind: DeviceKind

    public init(
        deviceName: String,
        kind: DeviceKind
    ) {
        self.deviceName = deviceName
        self.kind = kind
    }

    private enum CodingKeys: String, CodingKey {
        case deviceName = "deviceName"
        case kind = "kind"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let deviceName = try container.decode(String.self, forKey: .deviceName)
        let kind = try container.decode(DeviceKind.self, forKey: .kind)
        self.init(
            deviceName: deviceName,
            kind: kind
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceName, forKey: .deviceName)
        try container.encode(kind, forKey: .kind)
    }
}

// MARK: - PairingBeginResponse

public struct PairingBeginResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: PairingBeginResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "pairing.begin",
        payload: PairingBeginResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "PairingBeginResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "PairingBeginResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "pairing.begin" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "PairingBeginResponse.type 必須是 pairing.begin")
        }
        let payload = try container.decode(PairingBeginResponsePayload.self, forKey: .payload)
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

// MARK: - PairingBeginResponsePayload

public struct PairingBeginResponsePayload: Codable, Equatable, Sendable {
    public let pairingRequestId: String
    public let code: String
    public let expiresAt: String

    public init(
        pairingRequestId: String,
        code: String,
        expiresAt: String
    ) {
        self.pairingRequestId = pairingRequestId
        self.code = code
        self.expiresAt = expiresAt
    }

    private enum CodingKeys: String, CodingKey {
        case pairingRequestId = "pairingRequestId"
        case code = "code"
        case expiresAt = "expiresAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let pairingRequestId = try container.decode(String.self, forKey: .pairingRequestId)
        let code = try container.decode(String.self, forKey: .code)
        let expiresAt = try container.decode(String.self, forKey: .expiresAt)
        self.init(
            pairingRequestId: pairingRequestId,
            code: code,
            expiresAt: expiresAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pairingRequestId, forKey: .pairingRequestId)
        try container.encode(code, forKey: .code)
        try container.encode(expiresAt, forKey: .expiresAt)
    }
}

// MARK: - PairingCompleteRequest

public struct PairingCompleteRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: PairingCompleteRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "pairing.complete",
        payload: PairingCompleteRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "PairingCompleteRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "PairingCompleteRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "pairing.complete" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "PairingCompleteRequest.type 必須是 pairing.complete")
        }
        let payload = try container.decode(PairingCompleteRequestPayload.self, forKey: .payload)
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

// MARK: - PairingCompleteRequestPayload

public struct PairingCompleteRequestPayload: Codable, Equatable, Sendable {
    public let pairingRequestId: String

    public init(
        pairingRequestId: String
    ) {
        self.pairingRequestId = pairingRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case pairingRequestId = "pairingRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let pairingRequestId = try container.decode(String.self, forKey: .pairingRequestId)
        self.init(
            pairingRequestId: pairingRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pairingRequestId, forKey: .pairingRequestId)
    }
}

// MARK: - PairingCompleteResponse

public struct PairingCompleteResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: PairingCompleteResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "pairing.complete",
        payload: PairingCompleteResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "PairingCompleteResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "PairingCompleteResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "pairing.complete" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "PairingCompleteResponse.type 必須是 pairing.complete")
        }
        let payload = try container.decode(PairingCompleteResponsePayload.self, forKey: .payload)
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

// MARK: - PairingCompleteResponsePayload

public struct PairingCompleteResponsePayload: Codable, Equatable, Sendable {
    public let deviceId: String
    public let deviceName: String
    public let deviceToken: String

    public init(
        deviceId: String,
        deviceName: String,
        deviceToken: String
    ) {
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.deviceToken = deviceToken
    }

    private enum CodingKeys: String, CodingKey {
        case deviceId = "deviceId"
        case deviceName = "deviceName"
        case deviceToken = "deviceToken"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let deviceId = try container.decode(String.self, forKey: .deviceId)
        let deviceName = try container.decode(String.self, forKey: .deviceName)
        let deviceToken = try container.decode(String.self, forKey: .deviceToken)
        self.init(
            deviceId: deviceId,
            deviceName: deviceName,
            deviceToken: deviceToken
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceId, forKey: .deviceId)
        try container.encode(deviceName, forKey: .deviceName)
        try container.encode(deviceToken, forKey: .deviceToken)
    }
}

// MARK: - PairingDenyRequestPayload

public struct PairingDenyRequestPayload: Codable, Equatable, Sendable {
    public let pairingRequestId: String

    public init(
        pairingRequestId: String
    ) {
        self.pairingRequestId = pairingRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case pairingRequestId = "pairingRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let pairingRequestId = try container.decode(String.self, forKey: .pairingRequestId)
        self.init(
            pairingRequestId: pairingRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pairingRequestId, forKey: .pairingRequestId)
    }
}

// MARK: - PairingDenyResponsePayload

public struct PairingDenyResponsePayload: Codable, Equatable, Sendable {
    public let denied: Bool

    public init(
        denied: Bool
    ) {
        self.denied = denied
    }

    private enum CodingKeys: String, CodingKey {
        case denied = "denied"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let denied = try container.decode(Bool.self, forKey: .denied)
        self.init(
            denied: denied
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(denied, forKey: .denied)
    }
}

// MARK: - PairingRequestedEventPayload

public struct PairingRequestedEventPayload: Codable, Equatable, Sendable {
    public let pairingRequestId: String
    public let deviceName: String
    public let code: String
    public let remoteAddress: String?
    public let requestedAt: String
    public let expiresAt: String

    public init(
        pairingRequestId: String,
        deviceName: String,
        code: String,
        remoteAddress: String? = nil,
        requestedAt: String,
        expiresAt: String
    ) {
        self.pairingRequestId = pairingRequestId
        self.deviceName = deviceName
        self.code = code
        self.remoteAddress = remoteAddress
        self.requestedAt = requestedAt
        self.expiresAt = expiresAt
    }

    private enum CodingKeys: String, CodingKey {
        case pairingRequestId = "pairingRequestId"
        case deviceName = "deviceName"
        case code = "code"
        case remoteAddress = "remoteAddress"
        case requestedAt = "requestedAt"
        case expiresAt = "expiresAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let pairingRequestId = try container.decode(String.self, forKey: .pairingRequestId)
        let deviceName = try container.decode(String.self, forKey: .deviceName)
        let code = try container.decode(String.self, forKey: .code)
        let remoteAddress = try container.decodeIfPresent(String.self, forKey: .remoteAddress)
        let requestedAt = try container.decode(String.self, forKey: .requestedAt)
        let expiresAt = try container.decode(String.self, forKey: .expiresAt)
        self.init(
            pairingRequestId: pairingRequestId,
            deviceName: deviceName,
            code: code,
            remoteAddress: remoteAddress,
            requestedAt: requestedAt,
            expiresAt: expiresAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pairingRequestId, forKey: .pairingRequestId)
        try container.encode(deviceName, forKey: .deviceName)
        try container.encode(code, forKey: .code)
        try container.encodeIfPresent(remoteAddress, forKey: .remoteAddress)
        try container.encode(requestedAt, forKey: .requestedAt)
        try container.encode(expiresAt, forKey: .expiresAt)
    }
}

// MARK: - PendingCardPatch

public struct PendingCardPatch: Codable, Equatable, Sendable {
    public let patchId: String
    public let cardId: String
    public let baseRevision: String
    public let patch: CardPatch
    public let status: PendingPatchStatus
    public let summary: String?
    public let sourceConversationId: String?
    public let sourceTurnId: String?
    public let createdAt: String
    public let decidedAt: String?

    public init(
        patchId: String,
        cardId: String,
        baseRevision: String,
        patch: CardPatch,
        status: PendingPatchStatus,
        summary: String? = nil,
        sourceConversationId: String? = nil,
        sourceTurnId: String? = nil,
        createdAt: String,
        decidedAt: String? = nil
    ) {
        self.patchId = patchId
        self.cardId = cardId
        self.baseRevision = baseRevision
        self.patch = patch
        self.status = status
        self.summary = summary
        self.sourceConversationId = sourceConversationId
        self.sourceTurnId = sourceTurnId
        self.createdAt = createdAt
        self.decidedAt = decidedAt
    }

    private enum CodingKeys: String, CodingKey {
        case patchId = "patchId"
        case cardId = "cardId"
        case baseRevision = "baseRevision"
        case patch = "patch"
        case status = "status"
        case summary = "summary"
        case sourceConversationId = "sourceConversationId"
        case sourceTurnId = "sourceTurnId"
        case createdAt = "createdAt"
        case decidedAt = "decidedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let patchId = try container.decode(String.self, forKey: .patchId)
        let cardId = try container.decode(String.self, forKey: .cardId)
        let baseRevision = try container.decode(String.self, forKey: .baseRevision)
        let patch = try container.decode(CardPatch.self, forKey: .patch)
        let status = try container.decode(PendingPatchStatus.self, forKey: .status)
        let summary = try container.decodeIfPresent(String.self, forKey: .summary)
        let sourceConversationId = try container.decodeIfPresent(String.self, forKey: .sourceConversationId)
        let sourceTurnId = try container.decodeIfPresent(String.self, forKey: .sourceTurnId)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let decidedAt = try container.decodeIfPresent(String.self, forKey: .decidedAt)
        self.init(
            patchId: patchId,
            cardId: cardId,
            baseRevision: baseRevision,
            patch: patch,
            status: status,
            summary: summary,
            sourceConversationId: sourceConversationId,
            sourceTurnId: sourceTurnId,
            createdAt: createdAt,
            decidedAt: decidedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(patchId, forKey: .patchId)
        try container.encode(cardId, forKey: .cardId)
        try container.encode(baseRevision, forKey: .baseRevision)
        try container.encode(patch, forKey: .patch)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(summary, forKey: .summary)
        try container.encodeIfPresent(sourceConversationId, forKey: .sourceConversationId)
        try container.encodeIfPresent(sourceTurnId, forKey: .sourceTurnId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(decidedAt, forKey: .decidedAt)
    }
}

// MARK: - PendingPatchStatus

public enum PendingPatchStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case pending = "pending"
    case accepted = "accepted"
    case rejected = "rejected"
}

// MARK: - PermissionModesState

public struct PermissionModesState: Codable, Equatable, Sendable {
    public let categories: [DelegatedCategoryGrant]
    public let availableCategories: [DelegatedCategory]
    public let allowedDomains: [String]
    public let allowAll: AllowAllGrantState?
    public let defaultAllowAllMinutes: Int
    public let maxAllowAllMinutes: Int

    public init(
        categories: [DelegatedCategoryGrant],
        availableCategories: [DelegatedCategory],
        allowedDomains: [String],
        allowAll: AllowAllGrantState? = nil,
        defaultAllowAllMinutes: Int,
        maxAllowAllMinutes: Int
    ) {
        self.categories = categories
        self.availableCategories = availableCategories
        self.allowedDomains = allowedDomains
        self.allowAll = allowAll
        self.defaultAllowAllMinutes = defaultAllowAllMinutes
        self.maxAllowAllMinutes = maxAllowAllMinutes
    }

    private enum CodingKeys: String, CodingKey {
        case categories = "categories"
        case availableCategories = "availableCategories"
        case allowedDomains = "allowedDomains"
        case allowAll = "allowAll"
        case defaultAllowAllMinutes = "defaultAllowAllMinutes"
        case maxAllowAllMinutes = "maxAllowAllMinutes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let categories = try container.decode([DelegatedCategoryGrant].self, forKey: .categories)
        let availableCategories = try container.decode([DelegatedCategory].self, forKey: .availableCategories)
        let allowedDomains = try container.decode([String].self, forKey: .allowedDomains)
        let allowAll = try container.decodeIfPresent(AllowAllGrantState.self, forKey: .allowAll)
        let defaultAllowAllMinutes = try container.decode(Int.self, forKey: .defaultAllowAllMinutes)
        let maxAllowAllMinutes = try container.decode(Int.self, forKey: .maxAllowAllMinutes)
        self.init(
            categories: categories,
            availableCategories: availableCategories,
            allowedDomains: allowedDomains,
            allowAll: allowAll,
            defaultAllowAllMinutes: defaultAllowAllMinutes,
            maxAllowAllMinutes: maxAllowAllMinutes
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(categories, forKey: .categories)
        try container.encode(availableCategories, forKey: .availableCategories)
        try container.encode(allowedDomains, forKey: .allowedDomains)
        try container.encodeIfPresent(allowAll, forKey: .allowAll)
        try container.encode(defaultAllowAllMinutes, forKey: .defaultAllowAllMinutes)
        try container.encode(maxAllowAllMinutes, forKey: .maxAllowAllMinutes)
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
    case cardPatchesListResponse(CardPatchesListResponse)
    case cardPatchAcceptResponse(CardPatchAcceptResponse)
    case cardPatchRejectResponse(CardPatchRejectResponse)
    case cardVersionsListResponse(CardVersionsListResponse)
    case cardVersionGetResponse(CardVersionGetResponse)
    case cardVersionRestoreResponse(CardVersionRestoreResponse)
    case cardDeleteResponse(CardDeleteResponse)
    case cardSearchResponse(CardSearchResponse)
    case cardRefreshResponse(CardRefreshResponse)
    case boardListResponse(BoardListResponse)
    case boardGetResponse(BoardGetResponse)
    case boardCreateResponse(BoardCreateResponse)
    case boardSaveResponse(BoardSaveResponse)
    case boardDeleteResponse(BoardDeleteResponse)
    case boardProjectCardResponse(BoardProjectCardResponse)
    case boardUnprojectCardResponse(BoardUnprojectCardResponse)
    case boardCreateCardFromSelectionResponse(BoardCreateCardFromSelectionResponse)
    case mediaImportResponse(MediaImportResponse)
    case contextGetResponse(ContextGetResponse)
    case contextAddCardResponse(ContextAddCardResponse)
    case contextRemoveCardResponse(ContextRemoveCardResponse)
    case contextCompactResponse(ContextCompactResponse)
    case systemSettingsGetResponse(SystemSettingsGetResponse)
    case systemSettingsSetResponse(SystemSettingsSetResponse)
    case systemPermissionsGetResponse(SystemPermissionsGetResponse)
    case systemPermissionsSetCategoryResponse(SystemPermissionsSetCategoryResponse)
    case systemPermissionsSetDomainsResponse(SystemPermissionsSetDomainsResponse)
    case systemPermissionsGrantAllowAllResponse(SystemPermissionsGrantAllowAllResponse)
    case systemPermissionsRevokeAllowAllResponse(SystemPermissionsRevokeAllowAllResponse)
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
    case boardChangedEvent(BoardChangedEvent)
    case contextChangedEvent(ContextChangedEvent)
    case contextCompactedEvent(ContextCompactedEvent)
    case sessionArchivedEvent(SessionArchivedEvent)
    case sessionUnarchivedEvent(SessionUnarchivedEvent)
    case sessionDeletedEvent(SessionDeletedEvent)
    case systemSettingsChangedEvent(SystemSettingsChangedEvent)
    case systemPermissionsChangedEvent(SystemPermissionsChangedEvent)
    case systemModulesChangedEvent(SystemModulesChangedEvent)
    case systemModelsChangedEvent(SystemModelsChangedEvent)
    case approvalRequestedEvent(ApprovalRequestedEvent)
    case approvalDecideResponse(ApprovalDecideResponse)
    case approvalDecidedEvent(ApprovalDecidedEvent)
    case approvalPauseAllResponse(ApprovalPauseAllResponse)
    case notificationListResponse(NotificationListResponse)
    case notificationMarkReadResponse(NotificationMarkReadResponse)
    case notificationCreateCardResponse(NotificationCreateCardResponse)
    case notificationChangedEvent(NotificationChangedEvent)
    case pairingBeginResponse(PairingBeginResponse)
    case pairingCompleteResponse(PairingCompleteResponse)
    case agentStartResponse(AgentStartResponse)
    case agentStopResponse(AgentStopResponse)
    case agentListResponse(AgentListResponse)
    case agentStateChangedEvent(AgentStateChangedEvent)
    case mcpServersListResponse(McpServersListResponse)
    case mcpServerAddResponse(McpServerAddResponse)
    case mcpServerRemoveResponse(McpServerRemoveResponse)
    case mcpServerSetEnabledResponse(McpServerSetEnabledResponse)
    case mcpServerAllowHostsResponse(McpServerAllowHostsResponse)
    case mcpServersChangedEvent(McpServersChangedEvent)
    case settingsListResponse(SettingsListResponse)
    case settingsProposeChangeResponse(SettingsProposeChangeResponse)
    case settingsChangesListResponse(SettingsChangesListResponse)
    case settingsChangeDecideResponse(SettingsChangeDecideResponse)
    case settingsChangedEvent(SettingsChangedEvent)
    case storageUsageResponse(StorageUsageResponse)
    case storageCleanupPreviewResponse(StorageCleanupPreviewResponse)
    case storageCleanupApplyResponse(StorageCleanupApplyResponse)
    case storageChangedEvent(StorageChangedEvent)
    case emotionGetResponse(EmotionGetResponse)
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
        case (.some("response"), .some("card.patches.list")):
            self = .cardPatchesListResponse(try CardPatchesListResponse(from: decoder))
        case (.some("response"), .some("card.patch.accept")):
            self = .cardPatchAcceptResponse(try CardPatchAcceptResponse(from: decoder))
        case (.some("response"), .some("card.patch.reject")):
            self = .cardPatchRejectResponse(try CardPatchRejectResponse(from: decoder))
        case (.some("response"), .some("card.versions.list")):
            self = .cardVersionsListResponse(try CardVersionsListResponse(from: decoder))
        case (.some("response"), .some("card.version.get")):
            self = .cardVersionGetResponse(try CardVersionGetResponse(from: decoder))
        case (.some("response"), .some("card.version.restore")):
            self = .cardVersionRestoreResponse(try CardVersionRestoreResponse(from: decoder))
        case (.some("response"), .some("card.delete")):
            self = .cardDeleteResponse(try CardDeleteResponse(from: decoder))
        case (.some("response"), .some("card.search")):
            self = .cardSearchResponse(try CardSearchResponse(from: decoder))
        case (.some("response"), .some("card.refresh")):
            self = .cardRefreshResponse(try CardRefreshResponse(from: decoder))
        case (.some("response"), .some("board.list")):
            self = .boardListResponse(try BoardListResponse(from: decoder))
        case (.some("response"), .some("board.get")):
            self = .boardGetResponse(try BoardGetResponse(from: decoder))
        case (.some("response"), .some("board.create")):
            self = .boardCreateResponse(try BoardCreateResponse(from: decoder))
        case (.some("response"), .some("board.save")):
            self = .boardSaveResponse(try BoardSaveResponse(from: decoder))
        case (.some("response"), .some("board.delete")):
            self = .boardDeleteResponse(try BoardDeleteResponse(from: decoder))
        case (.some("response"), .some("board.project_card")):
            self = .boardProjectCardResponse(try BoardProjectCardResponse(from: decoder))
        case (.some("response"), .some("board.unproject_card")):
            self = .boardUnprojectCardResponse(try BoardUnprojectCardResponse(from: decoder))
        case (.some("response"), .some("board.create_card_from_selection")):
            self = .boardCreateCardFromSelectionResponse(try BoardCreateCardFromSelectionResponse(from: decoder))
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
        case (.some("response"), .some("system.permissions.get")):
            self = .systemPermissionsGetResponse(try SystemPermissionsGetResponse(from: decoder))
        case (.some("response"), .some("system.permissions.set_category")):
            self = .systemPermissionsSetCategoryResponse(try SystemPermissionsSetCategoryResponse(from: decoder))
        case (.some("response"), .some("system.permissions.set_domains")):
            self = .systemPermissionsSetDomainsResponse(try SystemPermissionsSetDomainsResponse(from: decoder))
        case (.some("response"), .some("system.permissions.grant_allow_all")):
            self = .systemPermissionsGrantAllowAllResponse(try SystemPermissionsGrantAllowAllResponse(from: decoder))
        case (.some("response"), .some("system.permissions.revoke_allow_all")):
            self = .systemPermissionsRevokeAllowAllResponse(try SystemPermissionsRevokeAllowAllResponse(from: decoder))
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
        case (.some("event"), .some("board.changed")):
            self = .boardChangedEvent(try BoardChangedEvent(from: decoder))
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
        case (.some("event"), .some("system.permissions.changed")):
            self = .systemPermissionsChangedEvent(try SystemPermissionsChangedEvent(from: decoder))
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
        case (.some("response"), .some("notification.list")):
            self = .notificationListResponse(try NotificationListResponse(from: decoder))
        case (.some("response"), .some("notification.mark_read")):
            self = .notificationMarkReadResponse(try NotificationMarkReadResponse(from: decoder))
        case (.some("response"), .some("notification.create_card")):
            self = .notificationCreateCardResponse(try NotificationCreateCardResponse(from: decoder))
        case (.some("event"), .some("notification.changed")):
            self = .notificationChangedEvent(try NotificationChangedEvent(from: decoder))
        case (.some("response"), .some("pairing.begin")):
            self = .pairingBeginResponse(try PairingBeginResponse(from: decoder))
        case (.some("response"), .some("pairing.complete")):
            self = .pairingCompleteResponse(try PairingCompleteResponse(from: decoder))
        case (.some("response"), .some("agent.start")):
            self = .agentStartResponse(try AgentStartResponse(from: decoder))
        case (.some("response"), .some("agent.stop")):
            self = .agentStopResponse(try AgentStopResponse(from: decoder))
        case (.some("response"), .some("agent.list")):
            self = .agentListResponse(try AgentListResponse(from: decoder))
        case (.some("event"), .some("agent.state_changed")):
            self = .agentStateChangedEvent(try AgentStateChangedEvent(from: decoder))
        case (.some("response"), .some("mcp.servers.list")):
            self = .mcpServersListResponse(try McpServersListResponse(from: decoder))
        case (.some("response"), .some("mcp.server.add")):
            self = .mcpServerAddResponse(try McpServerAddResponse(from: decoder))
        case (.some("response"), .some("mcp.server.remove")):
            self = .mcpServerRemoveResponse(try McpServerRemoveResponse(from: decoder))
        case (.some("response"), .some("mcp.server.set_enabled")):
            self = .mcpServerSetEnabledResponse(try McpServerSetEnabledResponse(from: decoder))
        case (.some("response"), .some("mcp.server.allow_hosts")):
            self = .mcpServerAllowHostsResponse(try McpServerAllowHostsResponse(from: decoder))
        case (.some("event"), .some("mcp.servers_changed")):
            self = .mcpServersChangedEvent(try McpServersChangedEvent(from: decoder))
        case (.some("response"), .some("settings.list")):
            self = .settingsListResponse(try SettingsListResponse(from: decoder))
        case (.some("response"), .some("settings.propose_change")):
            self = .settingsProposeChangeResponse(try SettingsProposeChangeResponse(from: decoder))
        case (.some("response"), .some("settings.changes.list")):
            self = .settingsChangesListResponse(try SettingsChangesListResponse(from: decoder))
        case (.some("response"), .some("settings.change.decide")):
            self = .settingsChangeDecideResponse(try SettingsChangeDecideResponse(from: decoder))
        case (.some("event"), .some("settings.changed")):
            self = .settingsChangedEvent(try SettingsChangedEvent(from: decoder))
        case (.some("response"), .some("storage.usage")):
            self = .storageUsageResponse(try StorageUsageResponse(from: decoder))
        case (.some("response"), .some("storage.cleanup.preview")):
            self = .storageCleanupPreviewResponse(try StorageCleanupPreviewResponse(from: decoder))
        case (.some("response"), .some("storage.cleanup.apply")):
            self = .storageCleanupApplyResponse(try StorageCleanupApplyResponse(from: decoder))
        case (.some("event"), .some("storage.changed")):
            self = .storageChangedEvent(try StorageChangedEvent(from: decoder))
        case (.some("response"), .some("emotion.get")):
            self = .emotionGetResponse(try EmotionGetResponse(from: decoder))
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
        case .cardPatchesListResponse(let value):
            try value.encode(to: encoder)
        case .cardPatchAcceptResponse(let value):
            try value.encode(to: encoder)
        case .cardPatchRejectResponse(let value):
            try value.encode(to: encoder)
        case .cardVersionsListResponse(let value):
            try value.encode(to: encoder)
        case .cardVersionGetResponse(let value):
            try value.encode(to: encoder)
        case .cardVersionRestoreResponse(let value):
            try value.encode(to: encoder)
        case .cardDeleteResponse(let value):
            try value.encode(to: encoder)
        case .cardSearchResponse(let value):
            try value.encode(to: encoder)
        case .cardRefreshResponse(let value):
            try value.encode(to: encoder)
        case .boardListResponse(let value):
            try value.encode(to: encoder)
        case .boardGetResponse(let value):
            try value.encode(to: encoder)
        case .boardCreateResponse(let value):
            try value.encode(to: encoder)
        case .boardSaveResponse(let value):
            try value.encode(to: encoder)
        case .boardDeleteResponse(let value):
            try value.encode(to: encoder)
        case .boardProjectCardResponse(let value):
            try value.encode(to: encoder)
        case .boardUnprojectCardResponse(let value):
            try value.encode(to: encoder)
        case .boardCreateCardFromSelectionResponse(let value):
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
        case .systemPermissionsGetResponse(let value):
            try value.encode(to: encoder)
        case .systemPermissionsSetCategoryResponse(let value):
            try value.encode(to: encoder)
        case .systemPermissionsSetDomainsResponse(let value):
            try value.encode(to: encoder)
        case .systemPermissionsGrantAllowAllResponse(let value):
            try value.encode(to: encoder)
        case .systemPermissionsRevokeAllowAllResponse(let value):
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
        case .boardChangedEvent(let value):
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
        case .systemPermissionsChangedEvent(let value):
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
        case .notificationListResponse(let value):
            try value.encode(to: encoder)
        case .notificationMarkReadResponse(let value):
            try value.encode(to: encoder)
        case .notificationCreateCardResponse(let value):
            try value.encode(to: encoder)
        case .notificationChangedEvent(let value):
            try value.encode(to: encoder)
        case .pairingBeginResponse(let value):
            try value.encode(to: encoder)
        case .pairingCompleteResponse(let value):
            try value.encode(to: encoder)
        case .agentStartResponse(let value):
            try value.encode(to: encoder)
        case .agentStopResponse(let value):
            try value.encode(to: encoder)
        case .agentListResponse(let value):
            try value.encode(to: encoder)
        case .agentStateChangedEvent(let value):
            try value.encode(to: encoder)
        case .mcpServersListResponse(let value):
            try value.encode(to: encoder)
        case .mcpServerAddResponse(let value):
            try value.encode(to: encoder)
        case .mcpServerRemoveResponse(let value):
            try value.encode(to: encoder)
        case .mcpServerSetEnabledResponse(let value):
            try value.encode(to: encoder)
        case .mcpServerAllowHostsResponse(let value):
            try value.encode(to: encoder)
        case .mcpServersChangedEvent(let value):
            try value.encode(to: encoder)
        case .settingsListResponse(let value):
            try value.encode(to: encoder)
        case .settingsProposeChangeResponse(let value):
            try value.encode(to: encoder)
        case .settingsChangesListResponse(let value):
            try value.encode(to: encoder)
        case .settingsChangeDecideResponse(let value):
            try value.encode(to: encoder)
        case .settingsChangedEvent(let value):
            try value.encode(to: encoder)
        case .storageUsageResponse(let value):
            try value.encode(to: encoder)
        case .storageCleanupPreviewResponse(let value):
            try value.encode(to: encoder)
        case .storageCleanupApplyResponse(let value):
            try value.encode(to: encoder)
        case .storageChangedEvent(let value):
            try value.encode(to: encoder)
        case .emotionGetResponse(let value):
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

// MARK: - SettingChangeRecord

public struct SettingChangeRecord: Codable, Equatable, Sendable {
    public let changeId: String
    public let key: String
    public let value: JSONValue
    public let tier: SettingLevel
    public let status: SettingChangeStatus
    public let proposedBy: String
    public let proposedAt: String
    public let decidedAt: String?

    public init(
        changeId: String,
        key: String,
        value: JSONValue,
        tier: SettingLevel,
        status: SettingChangeStatus,
        proposedBy: String,
        proposedAt: String,
        decidedAt: String? = nil
    ) {
        self.changeId = changeId
        self.key = key
        self.value = value
        self.tier = tier
        self.status = status
        self.proposedBy = proposedBy
        self.proposedAt = proposedAt
        self.decidedAt = decidedAt
    }

    private enum CodingKeys: String, CodingKey {
        case changeId = "changeId"
        case key = "key"
        case value = "value"
        case tier = "tier"
        case status = "status"
        case proposedBy = "proposedBy"
        case proposedAt = "proposedAt"
        case decidedAt = "decidedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let changeId = try container.decode(String.self, forKey: .changeId)
        let key = try container.decode(String.self, forKey: .key)
        let value = try container.decode(JSONValue.self, forKey: .value)
        let tier = try container.decode(SettingLevel.self, forKey: .tier)
        let status = try container.decode(SettingChangeStatus.self, forKey: .status)
        let proposedBy = try container.decode(String.self, forKey: .proposedBy)
        let proposedAt = try container.decode(String.self, forKey: .proposedAt)
        let decidedAt = try container.decodeIfPresent(String.self, forKey: .decidedAt)
        self.init(
            changeId: changeId,
            key: key,
            value: value,
            tier: tier,
            status: status,
            proposedBy: proposedBy,
            proposedAt: proposedAt,
            decidedAt: decidedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(changeId, forKey: .changeId)
        try container.encode(key, forKey: .key)
        try container.encode(value, forKey: .value)
        try container.encode(tier, forKey: .tier)
        try container.encode(status, forKey: .status)
        try container.encode(proposedBy, forKey: .proposedBy)
        try container.encode(proposedAt, forKey: .proposedAt)
        try container.encodeIfPresent(decidedAt, forKey: .decidedAt)
    }
}

// MARK: - SettingChangeStatus

public enum SettingChangeStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case pending = "pending"
    case applied = "applied"
    case rejected = "rejected"
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

// MARK: - SettingTierItem

public struct SettingTierItem: Codable, Equatable, Sendable {
    public let key: String
    public let value: JSONValue
    public let tier: SettingLevel
    public let title: String?
    public let description: String?
    public let updatedAt: String

    public init(
        key: String,
        value: JSONValue,
        tier: SettingLevel,
        title: String? = nil,
        description: String? = nil,
        updatedAt: String
    ) {
        self.key = key
        self.value = value
        self.tier = tier
        self.title = title
        self.description = description
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case key = "key"
        case value = "value"
        case tier = "tier"
        case title = "title"
        case description = "description"
        case updatedAt = "updatedAt"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let key = try container.decode(String.self, forKey: .key)
        let value = try container.decode(JSONValue.self, forKey: .value)
        let tier = try container.decode(SettingLevel.self, forKey: .tier)
        let title = try container.decodeIfPresent(String.self, forKey: .title)
        let description = try container.decodeIfPresent(String.self, forKey: .description)
        let updatedAt = try container.decode(String.self, forKey: .updatedAt)
        self.init(
            key: key,
            value: value,
            tier: tier,
            title: title,
            description: description,
            updatedAt: updatedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(key, forKey: .key)
        try container.encode(value, forKey: .value)
        try container.encode(tier, forKey: .tier)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encode(updatedAt, forKey: .updatedAt)
    }
}

// MARK: - SettingsChangeDecideRequest

public struct SettingsChangeDecideRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SettingsChangeDecideRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "settings.change.decide",
        payload: SettingsChangeDecideRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SettingsChangeDecideRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SettingsChangeDecideRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "settings.change.decide" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SettingsChangeDecideRequest.type 必須是 settings.change.decide")
        }
        let payload = try container.decode(SettingsChangeDecideRequestPayload.self, forKey: .payload)
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

// MARK: - SettingsChangeDecideRequestPayload

public struct SettingsChangeDecideRequestPayload: Codable, Equatable, Sendable {
    public let changeId: String
    public let decision: SettingsChangeDecision

    public init(
        changeId: String,
        decision: SettingsChangeDecision
    ) {
        self.changeId = changeId
        self.decision = decision
    }

    private enum CodingKeys: String, CodingKey {
        case changeId = "changeId"
        case decision = "decision"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let changeId = try container.decode(String.self, forKey: .changeId)
        let decision = try container.decode(SettingsChangeDecision.self, forKey: .decision)
        self.init(
            changeId: changeId,
            decision: decision
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(changeId, forKey: .changeId)
        try container.encode(decision, forKey: .decision)
    }
}

// MARK: - SettingsChangeDecideResponse

public struct SettingsChangeDecideResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SettingsChangeDecideResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "settings.change.decide",
        payload: SettingsChangeDecideResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SettingsChangeDecideResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SettingsChangeDecideResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "settings.change.decide" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SettingsChangeDecideResponse.type 必須是 settings.change.decide")
        }
        let payload = try container.decode(SettingsChangeDecideResponsePayload.self, forKey: .payload)
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

// MARK: - SettingsChangeDecideResponsePayload

public struct SettingsChangeDecideResponsePayload: Codable, Equatable, Sendable {
    public let change: SettingChangeRecord

    public init(
        change: SettingChangeRecord
    ) {
        self.change = change
    }

    private enum CodingKeys: String, CodingKey {
        case change = "change"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let change = try container.decode(SettingChangeRecord.self, forKey: .change)
        self.init(
            change: change
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(change, forKey: .change)
    }
}

// MARK: - SettingsChangeDecision

public enum SettingsChangeDecision: String, Codable, Equatable, Sendable, CaseIterable {
    case approve = "approve"
    case reject = "reject"
}

// MARK: - SettingsChangedEvent

public struct SettingsChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: SettingsChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "settings.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: SettingsChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SettingsChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SettingsChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "settings.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SettingsChangedEvent.type 必須是 settings.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(SettingsChangedEventPayload.self, forKey: .payload)
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

// MARK: - SettingsChangedEventPayload

public struct SettingsChangedEventPayload: Codable, Equatable, Sendable {
    public let changes: [SettingTierItem]
    public let changedBy: String
    public let changedAt: String

    public init(
        changes: [SettingTierItem],
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
        let changes = try container.decode([SettingTierItem].self, forKey: .changes)
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

// MARK: - SettingsChangesListRequest

public struct SettingsChangesListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SettingsChangesListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "settings.changes.list",
        payload: SettingsChangesListRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SettingsChangesListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SettingsChangesListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "settings.changes.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SettingsChangesListRequest.type 必須是 settings.changes.list")
        }
        let payload = try container.decode(SettingsChangesListRequestPayload.self, forKey: .payload)
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

// MARK: - SettingsChangesListRequestPayload

public struct SettingsChangesListRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - SettingsChangesListResponse

public struct SettingsChangesListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SettingsChangesListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "settings.changes.list",
        payload: SettingsChangesListResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SettingsChangesListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SettingsChangesListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "settings.changes.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SettingsChangesListResponse.type 必須是 settings.changes.list")
        }
        let payload = try container.decode(SettingsChangesListResponsePayload.self, forKey: .payload)
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

// MARK: - SettingsChangesListResponsePayload

public struct SettingsChangesListResponsePayload: Codable, Equatable, Sendable {
    public let changes: [SettingChangeRecord]

    public init(
        changes: [SettingChangeRecord]
    ) {
        self.changes = changes
    }

    private enum CodingKeys: String, CodingKey {
        case changes = "changes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let changes = try container.decode([SettingChangeRecord].self, forKey: .changes)
        self.init(
            changes: changes
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(changes, forKey: .changes)
    }
}

// MARK: - SettingsListRequest

public struct SettingsListRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SettingsListRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "settings.list",
        payload: SettingsListRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SettingsListRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SettingsListRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "settings.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SettingsListRequest.type 必須是 settings.list")
        }
        let payload = try container.decode(SettingsListRequestPayload.self, forKey: .payload)
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

// MARK: - SettingsListRequestPayload

public struct SettingsListRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - SettingsListResponse

public struct SettingsListResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SettingsListResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "settings.list",
        payload: SettingsListResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SettingsListResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SettingsListResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "settings.list" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SettingsListResponse.type 必須是 settings.list")
        }
        let payload = try container.decode(SettingsListResponsePayload.self, forKey: .payload)
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

// MARK: - SettingsListResponsePayload

public struct SettingsListResponsePayload: Codable, Equatable, Sendable {
    public let settings: [SettingTierItem]

    public init(
        settings: [SettingTierItem]
    ) {
        self.settings = settings
    }

    private enum CodingKeys: String, CodingKey {
        case settings = "settings"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let settings = try container.decode([SettingTierItem].self, forKey: .settings)
        self.init(
            settings: settings
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(settings, forKey: .settings)
    }
}

// MARK: - SettingsProposeChangeRequest

public struct SettingsProposeChangeRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SettingsProposeChangeRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "settings.propose_change",
        payload: SettingsProposeChangeRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SettingsProposeChangeRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SettingsProposeChangeRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "settings.propose_change" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SettingsProposeChangeRequest.type 必須是 settings.propose_change")
        }
        let payload = try container.decode(SettingsProposeChangeRequestPayload.self, forKey: .payload)
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

// MARK: - SettingsProposeChangeRequestPayload

public struct SettingsProposeChangeRequestPayload: Codable, Equatable, Sendable {
    public let key: String
    public let value: JSONValue
    public let clientRequestId: String?

    public init(
        key: String,
        value: JSONValue,
        clientRequestId: String? = nil
    ) {
        self.key = key
        self.value = value
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case key = "key"
        case value = "value"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let key = try container.decode(String.self, forKey: .key)
        let value = try container.decode(JSONValue.self, forKey: .value)
        let clientRequestId = try container.decodeIfPresent(String.self, forKey: .clientRequestId)
        self.init(
            key: key,
            value: value,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(key, forKey: .key)
        try container.encode(value, forKey: .value)
        try container.encodeIfPresent(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SettingsProposeChangeResponse

public struct SettingsProposeChangeResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: SettingsProposeChangeResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "settings.propose_change",
        payload: SettingsProposeChangeResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SettingsProposeChangeResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SettingsProposeChangeResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "settings.propose_change" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SettingsProposeChangeResponse.type 必須是 settings.propose_change")
        }
        let payload = try container.decode(SettingsProposeChangeResponsePayload.self, forKey: .payload)
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

// MARK: - SettingsProposeChangeResponsePayload

public struct SettingsProposeChangeResponsePayload: Codable, Equatable, Sendable {
    public let change: SettingChangeRecord

    public init(
        change: SettingChangeRecord
    ) {
        self.change = change
    }

    private enum CodingKeys: String, CodingKey {
        case change = "change"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let change = try container.decode(SettingChangeRecord.self, forKey: .change)
        self.init(
            change: change
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(change, forKey: .change)
    }
}

// MARK: - StorageCategoryUsage

public struct StorageCategoryUsage: Codable, Equatable, Sendable {
    public let category: StorageUsageCategory
    public let bytes: Int
    public let cleanableBytes: Int

    public init(
        category: StorageUsageCategory,
        bytes: Int,
        cleanableBytes: Int
    ) {
        self.category = category
        self.bytes = bytes
        self.cleanableBytes = cleanableBytes
    }

    private enum CodingKeys: String, CodingKey {
        case category = "category"
        case bytes = "bytes"
        case cleanableBytes = "cleanableBytes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let category = try container.decode(StorageUsageCategory.self, forKey: .category)
        let bytes = try container.decode(Int.self, forKey: .bytes)
        let cleanableBytes = try container.decode(Int.self, forKey: .cleanableBytes)
        self.init(
            category: category,
            bytes: bytes,
            cleanableBytes: cleanableBytes
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(category, forKey: .category)
        try container.encode(bytes, forKey: .bytes)
        try container.encode(cleanableBytes, forKey: .cleanableBytes)
    }
}

// MARK: - StorageChangedEvent

public struct StorageChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: StorageChangedEventPayload

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "storage.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: StorageChangedEventPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StorageChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StorageChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "storage.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StorageChangedEvent.type 必須是 storage.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(StorageChangedEventPayload.self, forKey: .payload)
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

// MARK: - StorageChangedEventPayload

public struct StorageChangedEventPayload: Codable, Equatable, Sendable {
    public let categories: [String]
    public let totalBytes: Int?

    public init(
        categories: [String],
        totalBytes: Int? = nil
    ) {
        self.categories = categories
        self.totalBytes = totalBytes
    }

    private enum CodingKeys: String, CodingKey {
        case categories = "categories"
        case totalBytes = "totalBytes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let categories = try container.decode([String].self, forKey: .categories)
        let totalBytes = try container.decodeIfPresent(Int.self, forKey: .totalBytes)
        self.init(
            categories: categories,
            totalBytes: totalBytes
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(categories, forKey: .categories)
        try container.encodeIfPresent(totalBytes, forKey: .totalBytes)
    }
}

// MARK: - StorageCleanupApplyRequest

public struct StorageCleanupApplyRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: StorageCleanupApplyRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "storage.cleanup.apply",
        payload: StorageCleanupApplyRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StorageCleanupApplyRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StorageCleanupApplyRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "storage.cleanup.apply" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StorageCleanupApplyRequest.type 必須是 storage.cleanup.apply")
        }
        let payload = try container.decode(StorageCleanupApplyRequestPayload.self, forKey: .payload)
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

// MARK: - StorageCleanupApplyRequestPayload

public struct StorageCleanupApplyRequestPayload: Codable, Equatable, Sendable {
    public let categories: [String]

    public init(
        categories: [String]
    ) {
        self.categories = categories
    }

    private enum CodingKeys: String, CodingKey {
        case categories = "categories"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let categories = try container.decode([String].self, forKey: .categories)
        self.init(
            categories: categories
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(categories, forKey: .categories)
    }
}

// MARK: - StorageCleanupApplyResponse

public struct StorageCleanupApplyResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: StorageCleanupApplyResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "storage.cleanup.apply",
        payload: StorageCleanupApplyResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StorageCleanupApplyResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StorageCleanupApplyResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "storage.cleanup.apply" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StorageCleanupApplyResponse.type 必須是 storage.cleanup.apply")
        }
        let payload = try container.decode(StorageCleanupApplyResponsePayload.self, forKey: .payload)
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

// MARK: - StorageCleanupApplyResponsePayload

public struct StorageCleanupApplyResponsePayload: Codable, Equatable, Sendable {
    public let targets: [StorageCleanupTarget]
    public let totalBytes: Int
    public let recordId: String

    public init(
        targets: [StorageCleanupTarget],
        totalBytes: Int,
        recordId: String
    ) {
        self.targets = targets
        self.totalBytes = totalBytes
        self.recordId = recordId
    }

    private enum CodingKeys: String, CodingKey {
        case targets = "targets"
        case totalBytes = "totalBytes"
        case recordId = "recordId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let targets = try container.decode([StorageCleanupTarget].self, forKey: .targets)
        let totalBytes = try container.decode(Int.self, forKey: .totalBytes)
        let recordId = try container.decode(String.self, forKey: .recordId)
        self.init(
            targets: targets,
            totalBytes: totalBytes,
            recordId: recordId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(targets, forKey: .targets)
        try container.encode(totalBytes, forKey: .totalBytes)
        try container.encode(recordId, forKey: .recordId)
    }
}

// MARK: - StorageCleanupPreviewRequest

public struct StorageCleanupPreviewRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: StorageCleanupPreviewRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "storage.cleanup.preview",
        payload: StorageCleanupPreviewRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StorageCleanupPreviewRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StorageCleanupPreviewRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "storage.cleanup.preview" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StorageCleanupPreviewRequest.type 必須是 storage.cleanup.preview")
        }
        let payload = try container.decode(StorageCleanupPreviewRequestPayload.self, forKey: .payload)
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

// MARK: - StorageCleanupPreviewRequestPayload

public struct StorageCleanupPreviewRequestPayload: Codable, Equatable, Sendable {
    public let categories: [String]

    public init(
        categories: [String]
    ) {
        self.categories = categories
    }

    private enum CodingKeys: String, CodingKey {
        case categories = "categories"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let categories = try container.decode([String].self, forKey: .categories)
        self.init(
            categories: categories
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(categories, forKey: .categories)
    }
}

// MARK: - StorageCleanupPreviewResponse

public struct StorageCleanupPreviewResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: StorageCleanupPreviewResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "storage.cleanup.preview",
        payload: StorageCleanupPreviewResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StorageCleanupPreviewResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StorageCleanupPreviewResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "storage.cleanup.preview" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StorageCleanupPreviewResponse.type 必須是 storage.cleanup.preview")
        }
        let payload = try container.decode(StorageCleanupPreviewResponsePayload.self, forKey: .payload)
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

// MARK: - StorageCleanupPreviewResponsePayload

public struct StorageCleanupPreviewResponsePayload: Codable, Equatable, Sendable {
    public let targets: [StorageCleanupTarget]
    public let totalBytes: Int

    public init(
        targets: [StorageCleanupTarget],
        totalBytes: Int
    ) {
        self.targets = targets
        self.totalBytes = totalBytes
    }

    private enum CodingKeys: String, CodingKey {
        case targets = "targets"
        case totalBytes = "totalBytes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let targets = try container.decode([StorageCleanupTarget].self, forKey: .targets)
        let totalBytes = try container.decode(Int.self, forKey: .totalBytes)
        self.init(
            targets: targets,
            totalBytes: totalBytes
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(targets, forKey: .targets)
        try container.encode(totalBytes, forKey: .totalBytes)
    }
}

// MARK: - StorageCleanupTarget

public struct StorageCleanupTarget: Codable, Equatable, Sendable {
    public let category: String
    public let items: Int
    public let bytes: Int

    public init(
        category: String,
        items: Int,
        bytes: Int
    ) {
        self.category = category
        self.items = items
        self.bytes = bytes
    }

    private enum CodingKeys: String, CodingKey {
        case category = "category"
        case items = "items"
        case bytes = "bytes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let category = try container.decode(String.self, forKey: .category)
        let items = try container.decode(Int.self, forKey: .items)
        let bytes = try container.decode(Int.self, forKey: .bytes)
        self.init(
            category: category,
            items: items,
            bytes: bytes
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(category, forKey: .category)
        try container.encode(items, forKey: .items)
        try container.encode(bytes, forKey: .bytes)
    }
}

// MARK: - StorageOutsideWriteEntry

public struct StorageOutsideWriteEntry: Codable, Equatable, Sendable {
    public let path: String
    public let tool: String
    public let bytes: Int?
    public let status: OutsideWriteStatus

    public init(
        path: String,
        tool: String,
        bytes: Int? = nil,
        status: OutsideWriteStatus
    ) {
        self.path = path
        self.tool = tool
        self.bytes = bytes
        self.status = status
    }

    private enum CodingKeys: String, CodingKey {
        case path = "path"
        case tool = "tool"
        case bytes = "bytes"
        case status = "status"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let path = try container.decode(String.self, forKey: .path)
        let tool = try container.decode(String.self, forKey: .tool)
        let bytes = try container.decodeIfPresent(Int.self, forKey: .bytes)
        let status = try container.decode(OutsideWriteStatus.self, forKey: .status)
        self.init(
            path: path,
            tool: tool,
            bytes: bytes,
            status: status
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
        try container.encode(tool, forKey: .tool)
        try container.encodeIfPresent(bytes, forKey: .bytes)
        try container.encode(status, forKey: .status)
    }
}

// MARK: - StorageUsageCategory

public enum StorageUsageCategory: String, Codable, Equatable, Sendable, CaseIterable {
    case cards = "cards"
    case assets = "assets"
    case cache = "cache"
    case state = "state"
    case logs = "logs"
    case tmp = "tmp"
    case shellState = "shellState"
}

// MARK: - StorageUsageRequest

public struct StorageUsageRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: StorageUsageRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "storage.usage",
        payload: StorageUsageRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StorageUsageRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StorageUsageRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "storage.usage" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StorageUsageRequest.type 必須是 storage.usage")
        }
        let payload = try container.decode(StorageUsageRequestPayload.self, forKey: .payload)
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

// MARK: - StorageUsageRequestPayload

public struct StorageUsageRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - StorageUsageResponse

public struct StorageUsageResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: StorageUsageResponsePayload

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "storage.usage",
        payload: StorageUsageResponsePayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "StorageUsageResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "StorageUsageResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "storage.usage" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "StorageUsageResponse.type 必須是 storage.usage")
        }
        let payload = try container.decode(StorageUsageResponsePayload.self, forKey: .payload)
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

// MARK: - StorageUsageResponsePayload

public struct StorageUsageResponsePayload: Codable, Equatable, Sendable {
    public let usage: [StorageCategoryUsage]
    public let outsideWrites: [StorageOutsideWriteEntry]?

    public init(
        usage: [StorageCategoryUsage],
        outsideWrites: [StorageOutsideWriteEntry]? = nil
    ) {
        self.usage = usage
        self.outsideWrites = outsideWrites
    }

    private enum CodingKeys: String, CodingKey {
        case usage = "usage"
        case outsideWrites = "outsideWrites"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let usage = try container.decode([StorageCategoryUsage].self, forKey: .usage)
        let outsideWrites = try container.decodeIfPresent([StorageOutsideWriteEntry].self, forKey: .outsideWrites)
        self.init(
            usage: usage,
            outsideWrites: outsideWrites
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(usage, forKey: .usage)
        try container.encodeIfPresent(outsideWrites, forKey: .outsideWrites)
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

// MARK: - SystemPermissionsChangedEvent

public struct SystemPermissionsChangedEvent: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let type: String
    public let stream: String
    public let seq: Int
    public let emittedAt: String
    public let payload: PermissionModesState

    public init(
        v: Int = 1,
        kind: String = "event",
        type: String = "system.permissions.changed",
        stream: String,
        seq: Int,
        emittedAt: String,
        payload: PermissionModesState
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsChangedEvent.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "event" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsChangedEvent.kind 必須是 event")
        }
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.changed" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsChangedEvent.type 必須是 system.permissions.changed")
        }
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let emittedAt = try container.decode(String.self, forKey: .emittedAt)
        let payload = try container.decode(PermissionModesState.self, forKey: .payload)
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

// MARK: - SystemPermissionsGetRequest

public struct SystemPermissionsGetRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemPermissionsGetRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.permissions.get",
        payload: SystemPermissionsGetRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsGetRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsGetRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsGetRequest.type 必須是 system.permissions.get")
        }
        let payload = try container.decode(SystemPermissionsGetRequestPayload.self, forKey: .payload)
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

// MARK: - SystemPermissionsGetRequestPayload

public struct SystemPermissionsGetRequestPayload: Codable, Equatable, Sendable {

    public init() {}
}

// MARK: - SystemPermissionsGetResponse

public struct SystemPermissionsGetResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: PermissionModesState

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.permissions.get",
        payload: PermissionModesState
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsGetResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsGetResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.get" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsGetResponse.type 必須是 system.permissions.get")
        }
        let payload = try container.decode(PermissionModesState.self, forKey: .payload)
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

// MARK: - SystemPermissionsGrantAllowAllRequest

public struct SystemPermissionsGrantAllowAllRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemPermissionsGrantAllowAllRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.permissions.grant_allow_all",
        payload: SystemPermissionsGrantAllowAllRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsGrantAllowAllRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsGrantAllowAllRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.grant_allow_all" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsGrantAllowAllRequest.type 必須是 system.permissions.grant_allow_all")
        }
        let payload = try container.decode(SystemPermissionsGrantAllowAllRequestPayload.self, forKey: .payload)
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

// MARK: - SystemPermissionsGrantAllowAllRequestPayload

public struct SystemPermissionsGrantAllowAllRequestPayload: Codable, Equatable, Sendable {
    public let tools: [String]
    public let paths: [String]
    public let domains: [String]?
    public let minutes: Int?
    public let clientRequestId: String

    public init(
        tools: [String],
        paths: [String],
        domains: [String]? = nil,
        minutes: Int? = nil,
        clientRequestId: String
    ) {
        self.tools = tools
        self.paths = paths
        self.domains = domains
        self.minutes = minutes
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case tools = "tools"
        case paths = "paths"
        case domains = "domains"
        case minutes = "minutes"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let tools = try container.decode([String].self, forKey: .tools)
        let paths = try container.decode([String].self, forKey: .paths)
        let domains = try container.decodeIfPresent([String].self, forKey: .domains)
        let minutes = try container.decodeIfPresent(Int.self, forKey: .minutes)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            tools: tools,
            paths: paths,
            domains: domains,
            minutes: minutes,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(tools, forKey: .tools)
        try container.encode(paths, forKey: .paths)
        try container.encodeIfPresent(domains, forKey: .domains)
        try container.encodeIfPresent(minutes, forKey: .minutes)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SystemPermissionsGrantAllowAllResponse

public struct SystemPermissionsGrantAllowAllResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: PermissionModesState

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.permissions.grant_allow_all",
        payload: PermissionModesState
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsGrantAllowAllResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsGrantAllowAllResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.grant_allow_all" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsGrantAllowAllResponse.type 必須是 system.permissions.grant_allow_all")
        }
        let payload = try container.decode(PermissionModesState.self, forKey: .payload)
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

// MARK: - SystemPermissionsRevokeAllowAllRequest

public struct SystemPermissionsRevokeAllowAllRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemPermissionsRevokeAllowAllRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.permissions.revoke_allow_all",
        payload: SystemPermissionsRevokeAllowAllRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsRevokeAllowAllRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsRevokeAllowAllRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.revoke_allow_all" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsRevokeAllowAllRequest.type 必須是 system.permissions.revoke_allow_all")
        }
        let payload = try container.decode(SystemPermissionsRevokeAllowAllRequestPayload.self, forKey: .payload)
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

// MARK: - SystemPermissionsRevokeAllowAllRequestPayload

public struct SystemPermissionsRevokeAllowAllRequestPayload: Codable, Equatable, Sendable {
    public let clientRequestId: String

    public init(
        clientRequestId: String
    ) {
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SystemPermissionsRevokeAllowAllResponse

public struct SystemPermissionsRevokeAllowAllResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: PermissionModesState

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.permissions.revoke_allow_all",
        payload: PermissionModesState
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsRevokeAllowAllResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsRevokeAllowAllResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.revoke_allow_all" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsRevokeAllowAllResponse.type 必須是 system.permissions.revoke_allow_all")
        }
        let payload = try container.decode(PermissionModesState.self, forKey: .payload)
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

// MARK: - SystemPermissionsSetCategoryRequest

public struct SystemPermissionsSetCategoryRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemPermissionsSetCategoryRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.permissions.set_category",
        payload: SystemPermissionsSetCategoryRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsSetCategoryRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsSetCategoryRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.set_category" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsSetCategoryRequest.type 必須是 system.permissions.set_category")
        }
        let payload = try container.decode(SystemPermissionsSetCategoryRequestPayload.self, forKey: .payload)
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

// MARK: - SystemPermissionsSetCategoryRequestPayload

public struct SystemPermissionsSetCategoryRequestPayload: Codable, Equatable, Sendable {
    public let category: DelegatedCategory
    public let enabled: Bool
    public let paths: [String]
    public let clientRequestId: String

    public init(
        category: DelegatedCategory,
        enabled: Bool,
        paths: [String],
        clientRequestId: String
    ) {
        self.category = category
        self.enabled = enabled
        self.paths = paths
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case category = "category"
        case enabled = "enabled"
        case paths = "paths"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let category = try container.decode(DelegatedCategory.self, forKey: .category)
        let enabled = try container.decode(Bool.self, forKey: .enabled)
        let paths = try container.decode([String].self, forKey: .paths)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            category: category,
            enabled: enabled,
            paths: paths,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(category, forKey: .category)
        try container.encode(enabled, forKey: .enabled)
        try container.encode(paths, forKey: .paths)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SystemPermissionsSetCategoryResponse

public struct SystemPermissionsSetCategoryResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: PermissionModesState

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.permissions.set_category",
        payload: PermissionModesState
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsSetCategoryResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsSetCategoryResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.set_category" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsSetCategoryResponse.type 必須是 system.permissions.set_category")
        }
        let payload = try container.decode(PermissionModesState.self, forKey: .payload)
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

// MARK: - SystemPermissionsSetDomainsRequest

public struct SystemPermissionsSetDomainsRequest: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let id: String
    public let type: String
    public let payload: SystemPermissionsSetDomainsRequestPayload

    public init(
        v: Int = 1,
        kind: String = "request",
        id: String,
        type: String = "system.permissions.set_domains",
        payload: SystemPermissionsSetDomainsRequestPayload
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsSetDomainsRequest.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "request" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsSetDomainsRequest.kind 必須是 request")
        }
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.set_domains" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsSetDomainsRequest.type 必須是 system.permissions.set_domains")
        }
        let payload = try container.decode(SystemPermissionsSetDomainsRequestPayload.self, forKey: .payload)
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

// MARK: - SystemPermissionsSetDomainsRequestPayload

public struct SystemPermissionsSetDomainsRequestPayload: Codable, Equatable, Sendable {
    public let domains: [String]
    public let clientRequestId: String

    public init(
        domains: [String],
        clientRequestId: String
    ) {
        self.domains = domains
        self.clientRequestId = clientRequestId
    }

    private enum CodingKeys: String, CodingKey {
        case domains = "domains"
        case clientRequestId = "clientRequestId"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let domains = try container.decode([String].self, forKey: .domains)
        let clientRequestId = try container.decode(String.self, forKey: .clientRequestId)
        self.init(
            domains: domains,
            clientRequestId: clientRequestId
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(domains, forKey: .domains)
        try container.encode(clientRequestId, forKey: .clientRequestId)
    }
}

// MARK: - SystemPermissionsSetDomainsResponse

public struct SystemPermissionsSetDomainsResponse: Codable, Equatable, Sendable {
    public let v: Int
    public let kind: String
    public let replyTo: String
    public let type: String
    public let payload: PermissionModesState

    public init(
        v: Int = 1,
        kind: String = "response",
        replyTo: String,
        type: String = "system.permissions.set_domains",
        payload: PermissionModesState
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
            throw DecodingError.dataCorruptedError(forKey: .v, in: container, debugDescription: "SystemPermissionsSetDomainsResponse.v 必須是 1")
        }
        let kind = try container.decode(String.self, forKey: .kind)
        guard kind == "response" else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "SystemPermissionsSetDomainsResponse.kind 必須是 response")
        }
        let replyTo = try container.decode(String.self, forKey: .replyTo)
        let type = try container.decode(String.self, forKey: .type)
        guard type == "system.permissions.set_domains" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "SystemPermissionsSetDomainsResponse.type 必須是 system.permissions.set_domains")
        }
        let payload = try container.decode(PermissionModesState.self, forKey: .payload)
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
    public let pendingApprovals: [ApprovalRequest]?

    public init(
        stream: String,
        seq: Int,
        epoch: String,
        resyncRequired: Bool,
        snapshot: SystemStatus? = nil,
        pendingApprovals: [ApprovalRequest]? = nil
    ) {
        self.stream = stream
        self.seq = seq
        self.epoch = epoch
        self.resyncRequired = resyncRequired
        self.snapshot = snapshot
        self.pendingApprovals = pendingApprovals
    }

    private enum CodingKeys: String, CodingKey {
        case stream = "stream"
        case seq = "seq"
        case epoch = "epoch"
        case resyncRequired = "resyncRequired"
        case snapshot = "snapshot"
        case pendingApprovals = "pendingApprovals"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let stream = try container.decode(String.self, forKey: .stream)
        let seq = try container.decode(Int.self, forKey: .seq)
        let epoch = try container.decode(String.self, forKey: .epoch)
        let resyncRequired = try container.decode(Bool.self, forKey: .resyncRequired)
        let snapshot = try container.decodeIfPresent(SystemStatus.self, forKey: .snapshot)
        let pendingApprovals = try container.decodeIfPresent([ApprovalRequest].self, forKey: .pendingApprovals)
        self.init(
            stream: stream,
            seq: seq,
            epoch: epoch,
            resyncRequired: resyncRequired,
            snapshot: snapshot,
            pendingApprovals: pendingApprovals
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(stream, forKey: .stream)
        try container.encode(seq, forKey: .seq)
        try container.encode(epoch, forKey: .epoch)
        try container.encode(resyncRequired, forKey: .resyncRequired)
        try container.encodeIfPresent(snapshot, forKey: .snapshot)
        try container.encodeIfPresent(pendingApprovals, forKey: .pendingApprovals)
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
