export { startHost, registerDemoTools } from "./bootstrap.js";
export type { RunningHost, StartHostOptions } from "./bootstrap.js";
export { HostService } from "./service.js";
export type {
  HealthPayload,
  HostServiceOptions,
  Lifecycle,
  PauseResult,
  ResumeResult,
  ShutdownResult,
} from "./service.js";
export { Gateway, RequestFailure, eventFrame, response } from "./gateway/server.js";
export type { GatewayOptions, ModuleHandler } from "./gateway/server.js";
export { DEFAULT_LIMITS } from "./gateway/limits.js";
export type { GatewayLimits } from "./gateway/limits.js";
export { systemStatus, projectStatus, healthState } from "./gateway/status.js";
export type {
  HostStatusInput,
  InternalFolderState,
  InternalServiceState,
} from "./gateway/status.js";
export { StreamLog } from "./gateway/streams.js";
export { StreamingBuffer } from "./gateway/textBuffer.js";
export {
  createRemoteStack,
  createStaticHandler,
  PairingRegistry,
  registerRemoteControlRoutes,
  type RemoteStack,
  type PairingNotice,
} from "./remote/index.js";
export type { PairingRequestContext } from "./remote/pairing-handlers.js";
export { RemoteFailure } from "./remote/pairing-handlers.js";
export { ControlChannel } from "./control/channel.js";
export { installStdoutGuard, createProtocolSink } from "./control/stdoutGuard.js";
export type { ProtocolSink } from "./control/stdoutGuard.js";
export { LineReader, LineWriter } from "./control/ndjson.js";
export type { LineSink } from "./control/ndjson.js";
export { BrokerClient, BrokerCredentialSource } from "./control/broker.js";
export { constantTimeEqual, isValidToken, tokenFingerprint, generateToken } from "./tokens.js";
export { SpawnRegistry, InvalidStdioError } from "./spawn/wrapper.js";
export type { ManagedChild, ManagedSpawnOptions, ManagedStdio } from "./spawn/wrapper.js";
export { readFolderIdentity, FolderError } from "./storage/folder.js";
export {
  MemoryApprovalLedger,
  MemoryDeletionIntents,
  MemoryEventLog,
  MemoryRequestDedupe,
  MemoryRuntimeState,
  MemoryTurnIndex,
  StorageFailure,
} from "./storage/memory.js";
export type {
  ClaimResult,
  DedupeKind,
  DedupeRecord,
  DeletionIntentStore,
  EventLogEntry,
  EventLogStore,
  FolderIdentity,
  RequestDedupeStore,
  RuntimeStateSnapshot,
  RuntimeStateStore,
  StorageBundle,
  StoredEvent,
  TurnIndexStore,
} from "./storage/interfaces.js";
export { parseArgs, run } from "./run.js";
export type { InitFrame, ReadyFrame } from "./run.js";
export {
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  PROTOCOL_MIN,
  PROTOCOL_MAX,
} from "./version.js";
export type { HostEngine, HostEngineExtensions } from "./engine/types.js";
export { m0PermissionGate, DEFAULT_APPROVAL_TIMEOUT_MS } from "./engine/permission.js";
