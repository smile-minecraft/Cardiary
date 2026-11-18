/**
 * 第一方模組契約測試的共用工具。
 *
 * 對真的主機行程跑：每個測試自己開一個資料夾、啟動服務、用協定觀察
 * `system.modules.get` 與各模組的功能。測試不直接呼叫 loader 或 registry。
 */

import {
  connectAndHello,
  makeFolder,
  spawnService,
  type ProtocolClient,
  type ServiceOptions,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

export interface ModuleInfo {
  readonly moduleId: string;
  readonly enabled: boolean;
  readonly state: "loaded" | "active" | "inactive" | "failed";
  readonly failure: string | null;
  readonly protocolPrefixes: readonly string[];
}

export type ReplyFrame = Record<string, unknown>;

export interface Harness {
  readonly folder: TestFolder;
  service: SpawnedService;
  client: ProtocolClient;
}

/** 正式組裝的 16 個第一方模組（moduleId 排序）。 */
export const MODULE_IDS = [
  "boards",
  "cards",
  "context",
  "dealing",
  "emotion",
  "external-agents",
  "import",
  "lifecycle",
  "local-tools",
  "mcp",
  "media",
  "memory",
  "retrieval",
  "scheduler",
  "settings",
  "storage",
] as const;

/** 相依 cards 的模組；停用 cards 時應連帶停用。 */
export const CARDS_DEPENDENTS = [
  "boards",
  "context",
  "dealing",
  "import",
  "lifecycle",
  "media",
  "memory",
  "retrieval",
  "scheduler",
] as const;

/** 每個模組 active 時登記的協定前綴（registry 會排序）。 */
export const EXPECTED_PROTOCOL_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  boards: ["board"],
  cards: ["card"],
  context: ["context", "module.context.test"],
  dealing: [],
  emotion: [],
  "external-agents": ["agent", "module.external-agents"],
  import: ["module.import"],
  lifecycle: ["session.archive", "session.delete", "session.deletion_preview", "session.unarchive"],
  "local-tools": [],
  mcp: ["mcp"],
  media: ["media"],
  memory: ["module.memory", "module.memory.test"],
  retrieval: [],
  scheduler: ["module.scheduler", "notification"],
  settings: ["settings", "system.models", "system.settings"],
  storage: ["storage"],
};

/** 協定探針在某一種狀態下的預期結果。 */
export type ProbeExpectation =
  { readonly kind: "response" } | { readonly kind: "error"; readonly code: string };

export interface ProbeCase {
  readonly moduleId: string;
  readonly title: string;
  readonly type: string;
  readonly payload: (sessionId: string) => Record<string, unknown>;
  /** 模組 active 時的預期結果；有些探針的成功路徑本來就是錯誤。 */
  readonly active: ProbeExpectation;
  /** 模組停用時的預期結果。 */
  readonly disabled: ProbeExpectation;
}

/**
 * 需要腳本化回合、檔案或連帶停用才觀察得到的模組。
 *
 * 它們的共同探針不適用，另外用 `special.test.ts` 的行為案例驗證；
 * 這個清單和 `PROBE_CASES` 的模組集合加起來必須剛好是 `MODULE_IDS`。
 */
export const SPECIAL_PROBE_MODULE_IDS = ["emotion", "local-tools", "retrieval"] as const;

/**
 * 13 個有協定命名空間（或核心入口）的模組。
 *
 * `dealing` 沒有自己的協定命名空間，它的功能藏在 `session.send_message`
 * 的發牌流程裡，協定上觀察不到服務被抽走；這一筆只驗狀態與核心入口
 * 仍可用，並在標題寫明。
 */
export const PROBE_CASES: readonly ProbeCase[] = [
  {
    moduleId: "cards",
    title: "card.list 可列出卡片",
    type: "card.list",
    payload: () => ({}),
    active: { kind: "response" },
    disabled: { kind: "error", code: "unsupported" },
  },
  {
    moduleId: "boards",
    title: "board.list 可列出看板",
    type: "board.list",
    payload: () => ({}),
    active: { kind: "response" },
    disabled: { kind: "error", code: "unsupported" },
  },
  {
    moduleId: "context",
    title: "context.get 可讀取會話上下文",
    type: "context.get",
    payload: (sessionId) => ({ sessionId }),
    active: { kind: "response" },
    disabled: { kind: "error", code: "unsupported" },
  },
  {
    moduleId: "dealing",
    title: "核心 session.send_message 仍可用（dealing 沒有協定命名空間）",
    type: "session.send_message",
    payload: (sessionId) => ({
      sessionId,
      text: "契約測試的發牌探針",
      delivery: "queue",
      clientMessageId: `deal-${Math.random().toString(36).slice(2)}`,
    }),
    active: { kind: "response" },
    disabled: { kind: "response" },
  },
  {
    moduleId: "external-agents",
    title: "agent.list 可列出外部代理",
    type: "agent.list",
    payload: () => ({}),
    active: { kind: "response" },
    disabled: { kind: "error", code: "unsupported" },
  },
  {
    moduleId: "import",
    title: "module.import.sources 可列出匯入來源",
    type: "module.import.sources",
    payload: () => ({ data: {} }),
    active: { kind: "response" },
    disabled: { kind: "error", code: "not_found" },
  },
  {
    moduleId: "lifecycle",
    title: "session.deletion_preview 可預覽刪除",
    type: "session.deletion_preview",
    payload: (sessionId) => ({ sessionId }),
    active: { kind: "response" },
    disabled: { kind: "error", code: "unsupported" },
  },
  {
    moduleId: "mcp",
    title: "mcp.servers.list 可列出 MCP 伺服器",
    type: "mcp.servers.list",
    payload: () => ({}),
    active: { kind: "response" },
    disabled: { kind: "error", code: "unsupported" },
  },
  {
    moduleId: "media",
    title: "media.import 已掛載（不存在的 blob 回 not_found）",
    type: "media.import",
    payload: () => ({ blobId: "0".repeat(64) }),
    active: { kind: "error", code: "not_found" },
    disabled: { kind: "error", code: "unsupported" },
  },
  {
    moduleId: "memory",
    title: "module.memory.undo 已掛載（空輸入回無效結果）",
    type: "module.memory.undo",
    payload: () => ({ data: { notificationId: "", itemId: "" } }),
    active: { kind: "response" },
    disabled: { kind: "error", code: "not_found" },
  },
  {
    moduleId: "scheduler",
    title: "notification.list 可列出通知",
    type: "notification.list",
    payload: () => ({}),
    active: { kind: "response" },
    disabled: { kind: "error", code: "unsupported" },
  },
  {
    moduleId: "settings",
    title: "system.settings.get 可讀取設定",
    type: "system.settings.get",
    payload: () => ({}),
    active: { kind: "response" },
    disabled: { kind: "error", code: "unsupported" },
  },
  {
    moduleId: "storage",
    title: "storage.usage 可讀取用量",
    type: "storage.usage",
    payload: () => ({}),
    active: { kind: "response" },
    disabled: { kind: "error", code: "unsupported" },
  },
];

export async function startHarness(
  options: { readonly scripts?: ServiceOptions["scripts"] } = {},
): Promise<Harness> {
  const folder = await makeFolder();
  const service = await spawnService({
    folder,
    ...(options.scripts === undefined ? {} : { scripts: options.scripts }),
  });
  const client = await connectAndHello(service);
  return { folder, service, client };
}

/** 關掉客戶端，用同一個資料夾重啟服務；設定（模組停用狀態）會留下來。 */
export async function restartHarness(harness: Harness): Promise<Harness> {
  await harness.client.close().catch(() => undefined);
  await harness.service.stop().catch(() => undefined);
  const service = await spawnService({ folder: harness.folder });
  const client = await connectAndHello(service);
  return { folder: harness.folder, service, client };
}

export async function stopHarness(harness: Harness | undefined): Promise<void> {
  await harness?.client.close().catch(() => undefined);
  await harness?.service.stop().catch(() => undefined);
}

/** 送一則請求並等回覆；錯誤也照原樣回傳，讓測試斷言錯誤碼。 */
export async function requestFrame(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<ReplyFrame> {
  const requestId = client.request(type, payload);
  return client.waitForReply(requestId, timeoutMs);
}

/** 送一則請求；錯誤時丟出帶錯誤碼的例外。 */
export async function request(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<ReplyFrame> {
  const reply = await requestFrame(client, type, payload);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return reply;
}

export function expectProbe(reply: ReplyFrame, expectation: ProbeExpectation, label: string): void {
  if (expectation.kind === "response") {
    if (reply.kind !== "response") {
      throw new Error(
        `${label} 預期成功，實際 ${String(reply.kind)} ${String(reply.code ?? "")} ${String(reply.message ?? "")}`,
      );
    }
    return;
  }
  if (reply.kind !== "error") {
    throw new Error(`${label} 預期錯誤 ${expectation.code}，實際 ${String(reply.kind)}`);
  }
  if (reply.code !== expectation.code) {
    throw new Error(
      `${label} 預期錯誤 ${expectation.code}，實際 ${String(reply.code)} ${String(reply.message ?? "")}`,
    );
  }
}

export async function listModules(client: ProtocolClient): Promise<ModuleInfo[]> {
  const reply = await request(client, "system.modules.get");
  const payload = reply.payload as { modules?: ModuleInfo[] } | undefined;
  if (payload?.modules === undefined) {
    throw new Error("system.modules.get 沒有回 modules");
  }
  return payload.modules;
}

export async function mapModules(client: ProtocolClient): Promise<Map<string, ModuleInfo>> {
  return new Map((await listModules(client)).map((info) => [info.moduleId, info]));
}

export async function infoOf(client: ProtocolClient, moduleId: string): Promise<ModuleInfo> {
  const info = (await mapModules(client)).get(moduleId);
  if (info === undefined) {
    throw new Error(`system.modules.get 沒有 ${moduleId}`);
  }
  return info;
}

export async function setEnabled(
  client: ProtocolClient,
  moduleId: string,
  enabled: boolean,
): Promise<ModuleInfo> {
  const reply = await request(client, "system.modules.set_enabled", {
    moduleId,
    enabled,
    clientRequestId: `set-${moduleId}-${enabled}-${Math.random().toString(36).slice(2)}`,
  });
  const payload = reply.payload as { module?: ModuleInfo } | undefined;
  if (payload?.module === undefined) {
    throw new Error(`system.modules.set_enabled 沒有回 module`);
  }
  return payload.module;
}

export async function createSession(client: ProtocolClient): Promise<string> {
  const reply = await request(client, "session.create", {
    clientRequestId: `session-${Math.random().toString(36).slice(2)}`,
  });
  const payload = reply.payload as { session?: { id?: string } } | undefined;
  const sessionId = payload?.session?.id;
  if (typeof sessionId !== "string") {
    throw new Error("session.create 沒有回 sessionId");
  }
  return sessionId;
}

/** 訂閱對話串流；工具呼叫與回合狀態要靠它才會送到這個客戶端。 */
export async function subscribeSession(client: ProtocolClient, sessionId: string): Promise<void> {
  await request(client, "session.subscribe", { sessionId });
}

/** 送一則訊息並等受理；回合內容另外從串流觀察。 */
export async function sendMessage(
  client: ProtocolClient,
  sessionId: string,
  text: string,
): Promise<string> {
  const reply = await request(client, "session.send_message", {
    sessionId,
    text,
    delivery: "queue",
    clientMessageId: `msg-${Math.random().toString(36).slice(2)}`,
  });
  const turnId = (reply.payload as { turnId?: string } | undefined)?.turnId;
  if (typeof turnId !== "string") {
    throw new Error("session.send_message 沒有回 turnId");
  }
  return turnId;
}

export function toolResults(client: ProtocolClient): Record<string, unknown>[] {
  return client.frames.filter((frame) => frame.type === "stream.tool_result");
}

/** 等到第 `count` 個工具結果出現。 */
export async function waitForToolResult(
  client: ProtocolClient,
  count: number,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  await client.waitFor(() => toolResults(client).length >= count, timeoutMs);
  const result = toolResults(client)[count - 1];
  if (result === undefined) {
    throw new Error(`等不到第 ${count} 個工具結果`);
  }
  return result;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 產生協定要求的 ULID；契約測試不引其他套件，維持和現有測試相同的做法。 */
export function newUlid(nowMs: number = Date.now()): string {
  let time = BigInt(nowMs);
  const timePart = new Array<string>(10);
  for (let index = 9; index >= 0; index -= 1) {
    timePart[index] = CROCKFORD[Number(time & 31n)] as string;
    time >>= 5n;
  }
  const randomPart = new Array<string>(16);
  for (let index = 0; index < 16; index += 1) {
    randomPart[index] = CROCKFORD[Math.floor(Math.random() * 32)] as string;
  }
  return `${timePart.join("")}${randomPart.join("")}`;
}

export async function createNoteCard(client: ProtocolClient, title: string): Promise<string> {
  const reply = await request(client, "card.create", {
    kind: "note",
    title,
    body: `契約測試的卡片：${title}`,
    clientRequestId: `card-${Math.random().toString(36).slice(2)}`,
  });
  const payload = reply.payload as { card?: { cardId?: string } } | undefined;
  const cardId = payload?.card?.cardId;
  if (typeof cardId !== "string") {
    throw new Error("card.create 沒有回 cardId");
  }
  return cardId;
}

/**
 * 把組裝恢復到全部啟用且 active。
 *
 * 測試收尾用：任何一個案例中途失敗，下一個案例仍從乾淨的基準線開始。
 */
export async function ensureAllEnabled(client: ProtocolClient): Promise<void> {
  for (const moduleId of MODULE_IDS) {
    const info = (await mapModules(client)).get(moduleId);
    if (info === undefined) continue;
    if (!info.enabled || info.state === "failed") {
      await setEnabled(client, moduleId, true);
    }
  }
  const modules = await mapModules(client);
  const notActive = [...modules.values()].filter((info) => info.state !== "active");
  if (notActive.length > 0) {
    throw new Error(
      `模組沒有回到 active：${notActive.map((info) => `${info.moduleId}=${info.state}`).join(", ")}`,
    );
  }
}
