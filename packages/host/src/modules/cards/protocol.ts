import {
  AGENT_CREATABLE_KINDS,
  type CardKind,
  type CardVersion,
  type CardLifecycle,
  type CardQuery,
} from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import type {
  CardListResponsePayload,
  CardGetResponsePayload,
  CardSummary as WireCardSummary,
  Card as WireCard,
  CardSearchResponsePayload,
  CardCreateResponsePayload,
  CardPatchResponsePayload,
  CardPatchProposeResponsePayload,
  CardPatchesListResponsePayload,
  CardPatchAcceptResponsePayload,
  CardPatchRejectResponsePayload,
  CardVersionsListResponsePayload,
  CardVersionRestoreResponsePayload,
  CardDeleteResponsePayload,
  CardRefreshResponsePayload,
  CardVersion as WireCardVersion,
  PendingCardPatch as WirePendingCardPatch,
  PendingPatchStatus as WirePendingPatchStatus,
  JSONObject,
} from "@cardiary/protocol";
import { StorageError, type CardIndexRow } from "@cardiary/storage";

import { ProtocolHandlerError } from "../contract.js";
import type { CardLibrary } from "./library.js";

/**
 * `card.*` 協定處理器。
 *
 * 這裡只做輸入檢查與線路形狀的映射；檔案、索引與狀態都在 `CardLibrary`。
 * 錯誤碼照 `docs/design/cards.md` 第 2.4 節：修訂不符回 `conflict`、補丁
 * 套用失敗回 `invalid_message`、格式不符的檔案回 `conflict`。
 */

const KIND_SET: ReadonlySet<string> = new Set([
  "note",
  "image",
  "audio",
  "memory",
  "summary",
  "persona",
  "bedrock",
]);
const CREATABLE: ReadonlySet<string> = new Set(AGENT_CREATABLE_KINDS);
const LIFECYCLE_SET: ReadonlySet<string> = new Set(["live", "cold", "all"]);
const PENDING_STATUS_SET: ReadonlySet<string> = new Set(["pending", "accepted", "rejected"]);
const MAX_LIMIT = 200;
/** 同一條連線外的重送：記住 clientRequestId 的結果，行程內有效。 */
const DEDUPE_LIMIT = 512;

interface DedupeEntry {
  readonly operation: "create" | "patch" | "delete";
  readonly cardId: string;
}

export interface CardsProtocolOptions {
  readonly library: CardLibrary;
  readonly protocol: ProtocolEventEmitter;
  readonly search?: CardLibrary["search"];
}

export function registerCardsProtocol(options: CardsProtocolOptions): void {
  const { library, protocol } = options;
  const dedupe = new Map<string, DedupeEntry>();
  const remember = (key: string, entry: DedupeEntry): void => {
    dedupe.set(key, entry);
    if (dedupe.size > DEDUPE_LIMIT) {
      const oldest = dedupe.keys().next();
      if (!oldest.done) dedupe.delete(oldest.value);
    }
  };

  protocol.registerNamespace(
    "card",
    async (request: ProtocolRequestContext): Promise<JsonValue> => {
      try {
        switch (request.type) {
          case "card.list":
            return asJson(await listCards(library, request.payload));
          case "card.get":
            return asJson(await getCard(library, request.payload, request.sessionId));
          case "card.create":
            return asJson(await createCard(library, request.payload, dedupe, remember));
          case "card.patch":
            return asJson(await patchCard(library, request.payload, dedupe, remember));
          case "card.patch.propose":
            return asJson(await proposePatch(library, request.payload));
          case "card.patches.list":
            return asJson(await listPatches(library, request.payload));
          case "card.patch.accept":
            return asJson(await acceptPatch(library, request.payload));
          case "card.patch.reject":
            return asJson(await rejectPatch(library, request.payload));
          case "card.versions.list":
            return asJson(await listVersions(library, request.payload));
          case "card.version.restore":
            return asJson(await restoreVersion(library, request.payload));
          case "card.delete":
            return asJson(await deleteCard(library, request.payload, dedupe, remember));
          case "card.search":
            return asJson(await searchCards(library, request.payload, options.search));
          case "card.refresh":
            return asJson(await refreshCard(library, request.payload));
          default:
            throw new ProtocolHandlerError("not_found", `沒有這個卡片訊息：${request.type}`);
        }
      } catch (error) {
        throw asProtocolError(error);
      }
    },
  );
}

async function listCards(
  library: CardLibrary,
  payload: JsonValue,
): Promise<CardListResponsePayload> {
  const input = objectOf(payload);
  const kinds = optionalKinds(input);
  const tags = optionalStringArray(input, "tags");
  const persona = optionalString(input, "persona");
  const lifecycle = lifecycleOf(input);
  const query = optionalString(input, "query");
  const includeSuperseded = optionalBoolean(input, "includeSuperseded");
  const cursor = optionalString(input, "cursor");
  const limit = optionalInt(input, "limit");
  const page = await library.list({
    ...(kinds === undefined ? {} : { kinds }),
    ...(tags === undefined ? {} : { tags }),
    ...(persona === undefined ? {} : { persona }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    ...(query === undefined ? {} : { query }),
    ...(includeSuperseded === undefined ? {} : { includeSuperseded }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  });
  return {
    cards: page.items.map((summary) => wireSummary(library, summary.cardId)),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  };
}

async function getCard(
  library: CardLibrary,
  payload: JsonValue,
  sessionId: string | undefined,
): Promise<CardGetResponsePayload> {
  const input = objectOf(payload);
  const cardId = requiredString(input, "cardId");
  const card = await library.get(cardId, {
    ...(sessionId === undefined ? {} : { conversationId: sessionId }),
  });
  if (card === null) {
    throw new ProtocolHandlerError("not_found", `找不到卡片 ${cardId}。`, { cardId });
  }
  return { card: wireCardOf(library, card) };
}

async function createCard(
  library: CardLibrary,
  payload: JsonValue,
  dedupe: Map<string, DedupeEntry>,
  remember: (key: string, entry: DedupeEntry) => void,
): Promise<CardCreateResponsePayload> {
  const input = objectOf(payload);
  const clientRequestId = requiredString(input, "clientRequestId");
  const previous = dedupe.get(clientRequestId);
  if (previous?.operation === "create") {
    const summary = library.summaryOfRow(previous.cardId);
    if (summary !== undefined) return { card: wireSummary(library, summary.cardId) };
  }
  const kind = requiredString(input, "kind");
  if (!KIND_SET.has(kind)) {
    throw new ProtocolHandlerError("invalid_message", `未知的卡片種類：${kind}`, {
      reason: "unknown_kind",
      kind,
    });
  }
  if (!CREATABLE.has(kind)) {
    throw new ProtocolHandlerError("invalid_message", `${kind} 由系統或匯入建立。`, {
      reason: "kind_not_creatable",
      kind,
    });
  }
  const summary = optionalString(input, "summary");
  const tags = optionalStringArray(input, "tags");
  const persona = optionalString(input, "persona");
  const sources = optionalStringArray(input, "sources");
  const supersedes = optionalString(input, "supersedes");
  const assetBlobId = optionalString(input, "assetBlobId");
  const card = await library.create({
    kind: kind as CardKind,
    title: requiredString(input, "title"),
    body: requiredString(input, "body"),
    ...(summary === undefined ? {} : { summary }),
    ...(tags === undefined ? {} : { tags }),
    ...(persona === undefined ? {} : { persona }),
    ...(sources === undefined ? {} : { sources }),
    ...(supersedes === undefined ? {} : { supersedes }),
    ...(assetBlobId === undefined ? {} : { assetBlobId }),
  });
  remember(clientRequestId, { operation: "create", cardId: card.cardId });
  return { card: wireSummary(library, card.cardId) };
}

async function patchCard(
  library: CardLibrary,
  payload: JsonValue,
  dedupe: Map<string, DedupeEntry>,
  remember: (key: string, entry: DedupeEntry) => void,
): Promise<CardPatchResponsePayload> {
  const input = objectOf(payload);
  const clientRequestId = optionalString(input, "clientRequestId");
  if (clientRequestId !== undefined) {
    const previous = dedupe.get(clientRequestId);
    if (previous?.operation === "patch") {
      const summary = library.summaryOfRow(previous.cardId);
      if (summary !== undefined) {
        return { card: await wireCard(library, previous.cardId) };
      }
    }
  }
  const cardId = requiredString(input, "cardId");
  const baseRevision = requiredString(input, "baseRevision");
  const card = await library.patch({
    cardId,
    baseRevision,
    patch: patchOf(input),
  });
  if (clientRequestId !== undefined) {
    remember(clientRequestId, { operation: "patch", cardId: card.cardId });
  }
  return { card: await wireCard(library, card.cardId) };
}

async function deleteCard(
  library: CardLibrary,
  payload: JsonValue,
  dedupe: Map<string, DedupeEntry>,
  remember: (key: string, entry: DedupeEntry) => void,
): Promise<CardDeleteResponsePayload> {
  const input = objectOf(payload);
  const cardId = requiredString(input, "cardId");
  const clientRequestId = requiredString(input, "clientRequestId");
  const previous = dedupe.get(clientRequestId);
  if (previous?.operation === "delete") {
    return { cardId: previous.cardId, deletedAssets: 0 };
  }
  const result = await library.delete(cardId);
  remember(clientRequestId, { operation: "delete", cardId });
  return { cardId, deletedAssets: result.deletedAssets };
}

async function searchCards(
  library: CardLibrary,
  payload: JsonValue,
  search?: CardLibrary["search"],
): Promise<CardSearchResponsePayload> {
  const input = objectOf(payload);
  const kinds = optionalKinds(input);
  const tags = optionalStringArray(input, "tags");
  const includeSuperseded = optionalBoolean(input, "includeSuperseded");
  const limit = optionalInt(input, "limit");
  const query: CardQuery = {
    query: requiredString(input, "query"),
    ...(kinds === undefined ? {} : { kinds }),
    ...(tags === undefined ? {} : { tags }),
    ...(includeSuperseded === undefined ? {} : { includeSuperseded }),
    ...(limit === undefined ? {} : { limit }),
  };
  const page = await (search === undefined ? library.search(query) : search(query));
  return {
    hits: page.items.map((hit) => ({
      card: wireSummary(library, hit.card.cardId),
      score: hit.score,
      snippet: hit.snippet,
    })),
  };
}

async function refreshCard(
  library: CardLibrary,
  payload: JsonValue,
): Promise<CardRefreshResponsePayload> {
  const input = objectOf(payload);
  const cardId = requiredString(input, "cardId");
  const freshness = await library.refresh(cardId);
  return { cardId, freshness };
}

async function proposePatch(
  library: CardLibrary,
  payload: JsonValue,
): Promise<CardPatchProposeResponsePayload> {
  const input = objectOf(payload);
  requiredString(input, "clientRequestId");
  const patch = patchOf(input);
  const pending = await library.proposePatch({
    cardId: requiredString(input, "cardId"),
    baseRevision: requiredString(input, "baseRevision"),
    patch,
    ...optionalStringField(input, "summary"),
    ...optionalStringField(input, "sourceConversationId"),
    ...optionalStringField(input, "sourceTurnId"),
  });
  return { patch: wirePendingPatch(pending) };
}

async function listPatches(
  library: CardLibrary,
  payload: JsonValue,
): Promise<CardPatchesListResponsePayload> {
  const input = objectOf(payload);
  const status = optionalString(input, "status");
  if (status !== undefined && !PENDING_STATUS_SET.has(status)) {
    throw new ProtocolHandlerError("invalid_message", `未知的補丁狀態：${status}`, {
      field: "status",
    });
  }
  return {
    patches: library
      .listPatches(requiredString(input, "cardId"), status as WirePendingPatchStatus | undefined)
      .map(wirePendingPatch),
  };
}

async function acceptPatch(
  library: CardLibrary,
  payload: JsonValue,
): Promise<CardPatchAcceptResponsePayload> {
  const input = objectOf(payload);
  requiredString(input, "clientRequestId");
  const result = await library.acceptPendingPatch(requiredString(input, "patchId"));
  return { patch: wirePendingPatch(result.patch), card: wireCardOf(library, result.card) };
}

async function rejectPatch(
  library: CardLibrary,
  payload: JsonValue,
): Promise<CardPatchRejectResponsePayload> {
  const input = objectOf(payload);
  requiredString(input, "clientRequestId");
  return {
    patch: wirePendingPatch(await library.rejectPendingPatch(requiredString(input, "patchId"))),
  };
}

async function listVersions(
  library: CardLibrary,
  payload: JsonValue,
): Promise<CardVersionsListResponsePayload> {
  const input = objectOf(payload);
  return {
    versions: library.listVersions(requiredString(input, "cardId")).map(wireCardVersion),
  };
}

async function restoreVersion(
  library: CardLibrary,
  payload: JsonValue,
): Promise<CardVersionRestoreResponsePayload> {
  const input = objectOf(payload);
  requiredString(input, "clientRequestId");
  const result = await library.restoreVersion(
    requiredString(input, "cardId"),
    requiredString(input, "versionId"),
  );
  return { card: wireCardOf(library, result.card), version: wireCardVersion(result.version) };
}

function patchOf(input: JSONObject): {
  readonly format: "unified" | "replace";
  readonly text: string;
} {
  const patch = objectOf(input["patch"] as JsonValue);
  const format = requiredString(patch, "format");
  if (format !== "unified" && format !== "replace") {
    throw new ProtocolHandlerError("invalid_message", `未知的補丁格式：${format}`, {
      reason: "patch_format",
      format,
    });
  }
  return { format, text: requiredString(patch, "text") };
}

function wirePendingPatch(patch: {
  readonly patchId: string;
  readonly cardId: string;
  readonly baseRevision: string;
  readonly patch: { readonly format: "unified" | "replace"; readonly text: string };
  readonly status: string;
  readonly summary?: string;
  readonly sourceConversationId?: string;
  readonly sourceTurnId?: string;
  readonly createdAt: string;
  readonly decidedAt?: string;
}): WirePendingCardPatch {
  return {
    patchId: patch.patchId,
    cardId: patch.cardId,
    baseRevision: patch.baseRevision,
    patch: { format: patch.patch.format, text: patch.patch.text },
    status: patch.status as WirePendingPatchStatus,
    ...(patch.summary === undefined ? {} : { summary: patch.summary }),
    ...(patch.sourceConversationId === undefined
      ? {}
      : { sourceConversationId: patch.sourceConversationId }),
    ...(patch.sourceTurnId === undefined ? {} : { sourceTurnId: patch.sourceTurnId }),
    createdAt: patch.createdAt,
    ...(patch.decidedAt === undefined ? {} : { decidedAt: patch.decidedAt }),
  };
}

function wireCardVersion(version: CardVersion): WireCardVersion {
  return {
    versionId: version.versionId,
    cardId: version.cardId,
    seq: version.seq,
    kind: version.kind as WireCardVersion["kind"],
    revision: version.revision,
    bodyHash: version.bodyHash,
    ...(version.baseRevision === null ? {} : { baseRevision: version.baseRevision }),
    ...(version.patchFormat === undefined ? {} : { patchFormat: version.patchFormat }),
    ...(version.patchText === undefined ? {} : { patchText: version.patchText }),
    createdAt: version.createdAt,
    ...(version.mergedCount === undefined ? {} : { mergedCount: version.mergedCount }),
    ...(version.mergedSeqRange === null ? {} : { mergedSeqRange: version.mergedSeqRange }),
  };
}

function optionalStringField(input: JSONObject, key: string): { readonly [key: string]: string } {
  const value = optionalString(input, key);
  return value === undefined ? {} : { [key]: value };
}

// ---- 線路形狀 -----------------------------------------------------------

function wireSummary(library: CardLibrary, cardId: string): WireCardSummary {
  const row = library.rowOf(cardId);
  if (row === undefined) {
    throw new ProtocolHandlerError("not_found", `找不到卡片 ${cardId}。`, { cardId });
  }
  return wireSummaryOf(library, row);
}

function wireSummaryOf(library: CardLibrary, row: CardIndexRow): WireCardSummary {
  const summary = library.summaryOf(row);
  const asset = library.assetOf(row);
  return {
    cardId: summary.cardId,
    // broken 的檔案解析不出 kind 與 title；索引列保留空字串，線路上用
    // 合法但中性的值，原因放在 brokenReason。
    kind: row.broken ? "note" : summary.kind,
    title: row.broken
      ? summary.title.length === 0
        ? summary.cardId
        : summary.title
      : summary.title,
    ...(summary.summary === undefined ? {} : { summary: summary.summary }),
    tags: [...summary.tags],
    persona: summary.persona,
    createdAt: summary.createdAt,
    ...(summary.updatedAt === undefined ? {} : { updatedAt: summary.updatedAt }),
    freshness: wireFreshness(library.freshnessOf(summary.cardId)),
    lifecycle: summary.lifecycle as CardLifecycle,
    ...(summary.supersededBy === undefined ? {} : { supersededBy: summary.supersededBy }),
    ...(asset === undefined ? {} : { asset }),
    ...(summary.broken === true
      ? {
          broken: true,
          ...(summary.brokenReason === undefined ? {} : { brokenReason: summary.brokenReason }),
        }
      : {}),
  };
}

async function wireCard(library: CardLibrary, cardId: string): Promise<WireCard> {
  const card = await library.get(cardId);
  if (card === null) {
    throw new ProtocolHandlerError("not_found", `找不到卡片 ${cardId}。`, { cardId });
  }
  return wireCardOf(library, card);
}

function wireCardOf(
  library: CardLibrary,
  card: NonNullable<Awaited<ReturnType<CardLibrary["get"]>>>,
): WireCard {
  const summary = library.summaryOfRow(card.cardId);
  const asset = library.assetOfRow(card.cardId);
  return {
    cardId: card.cardId,
    kind: card.frontmatter.kind,
    title: card.frontmatter.title,
    ...(card.frontmatter.summary === undefined ? {} : { summary: card.frontmatter.summary }),
    body: card.body,
    tags: [...card.frontmatter.tags],
    persona: card.frontmatter.persona,
    createdAt: card.frontmatter.created,
    ...(card.frontmatter.updated === undefined ? {} : { updatedAt: card.frontmatter.updated }),
    freshness: wireFreshness(library.freshnessOf(card.cardId)),
    lifecycle: (summary?.lifecycle ?? "live") as CardLifecycle,
    ...(summary?.supersededBy === undefined ? {} : { supersededBy: summary.supersededBy }),
    ...(card.frontmatter.supersedes === undefined
      ? {}
      : { supersedes: card.frontmatter.supersedes }),
    sources: [...card.frontmatter.sources],
    ...(asset === undefined ? {} : { asset }),
    links: {
      outgoing: library.outgoingTargets(card.cardId),
      backlinks: library.backlinks(card.cardId),
    },
    // revision 一定跟 body 來自同一份檔案；索引列可能還停在外部改檔前。
    revision: card.revision,
  };
}

// ---- 輸入檢查 -----------------------------------------------------------

function objectOf(value: JsonValue | undefined): JSONObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", "請求內容必須是物件。");
  }
  return value as JSONObject;
}

function requiredString(input: JSONObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `缺少或型別不符的欄位：${key}`, {
      field: key,
    });
  }
  return value;
}

function optionalString(input: JSONObject, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是字串。`, { field: key });
  }
  return value;
}

function optionalBoolean(input: JSONObject, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是布林。`, { field: key });
  }
  return value;
}

function optionalInt(input: JSONObject, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是正整數。`, { field: key });
  }
  return Math.min(value, MAX_LIMIT);
}

function optionalStringArray(input: JSONObject, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是字串陣列。`, {
      field: key,
    });
  }
  return value as string[];
}

function optionalKinds(input: JSONObject): CardKind[] | undefined {
  const kinds = optionalStringArray(input, "kinds");
  if (kinds === undefined) return undefined;
  for (const kind of kinds) {
    if (!KIND_SET.has(kind)) {
      throw new ProtocolHandlerError("invalid_message", `未知的卡片種類：${kind}`, {
        field: "kinds",
      });
    }
  }
  return kinds as CardKind[];
}

function lifecycleOf(input: JSONObject): CardLifecycle | "all" | undefined {
  const value = optionalString(input, "lifecycle");
  if (value === undefined) return undefined;
  if (!LIFECYCLE_SET.has(value)) {
    throw new ProtocolHandlerError("invalid_message", `未知的生命週期：${value}`, {
      field: "lifecycle",
    });
  }
  return value as CardLifecycle | "all";
}

/** 卡片變更的種類；線路的新鮮度是整數，狀態庫保留精確的浮點值。 */
function wireFreshness(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** 卡片的領域錯誤已經是協定錯誤；儲存層的游標錯誤轉成輸入錯誤。 */
function asProtocolError(error: unknown): unknown {
  if (error instanceof ProtocolHandlerError) return error;
  if (error instanceof StorageError && error.code === "invalid-cursor") {
    return new ProtocolHandlerError("invalid_message", "游標不合法。", { field: "cursor" });
  }
  return error;
}

/** 回應 payload 是純資料；轉成模組介面的 JsonValue。 */
function asJson(payload: object): JsonValue {
  return payload as unknown as JsonValue;
}
