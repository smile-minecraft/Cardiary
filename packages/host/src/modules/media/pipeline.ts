import {
  composeTextStandIn,
  defaultMediaTitle,
  type Card,
  type CardService,
  type FlipResult,
  type MediaKind,
  type TextStandIn,
} from "@cardiary/domain";
import type { ModelInvoker, ModuleLogger } from "@cardiary/module-api";
import type { SystemModelsState } from "@cardiary/protocol";

import type { CardEnvironment } from "../contract.js";
import { CardStateStore } from "../cards/state.js";
import type { HostEngine } from "../../engine/types.js";
import { MediaError } from "./errors.js";
import type { RecognitionClient } from "./recognition.js";
import type { MediaStore } from "./store.js";

/** 送進小模型的文字上限；原檔與完整文字替身仍留在卡片裡。 */
const MODEL_INPUT_MAX_CHARS = 8_000;
const SUMMARY_MAX_CHARS = 200;

export interface ImportMediaInput {
  readonly blobId: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly persona?: string;
  readonly summary?: string;
  readonly ocrLocales?: readonly string[];
  readonly locale?: string;
}

export interface ImportMediaResult {
  readonly card: Card;
  readonly standIn: TextStandIn;
}

export interface FlipInput {
  readonly cardId: string;
  readonly conversationId?: string;
  /** 音訊只有在呼叫端明確要聽聲音細節時才載入原檔。 */
  readonly needAudio?: boolean;
}

export interface MediaServiceOptions {
  readonly store: MediaStore;
  readonly recognition: RecognitionClient;
  readonly cardStorage: CardEnvironment;
  readonly cards: () => CardService | undefined;
  readonly models: () => ModelInvoker | undefined;
  readonly engine: () => HostEngine | undefined;
  readonly now: () => Date;
  readonly logger?: ModuleLogger;
  readonly trace?: (operation: string) => void;
}

/**
 * 多模態匯入與翻牌。
 *
 * 匯入順序是「原檔已在 assets/ → 產生文字替身 → 建卡」；建卡是單一原子
 * 寫入，所以中斷時最多留下一個沒有卡片引用的原檔，由卡片庫的啟動掃描
 * 回收。同一個 blobId 重跑會接回既有的卡片，不會再建第二張。
 */
export class MediaService {
  readonly #options: MediaServiceOptions;
  readonly #flipping = new Map<string, Promise<FlipResult>>();

  constructor(options: MediaServiceOptions) {
    this.#options = options;
  }

  /** 匯入一個已上傳的原檔；同一個 blobId 已經有卡片時直接回它。 */
  async import(input: ImportMediaInput): Promise<ImportMediaResult> {
    const info = this.#options.store.info(input.blobId);
    if (info === undefined) {
      throw new MediaError("not_found", "找不到已上傳的原檔。", { blobId: input.blobId });
    }
    const cards = this.#cards();
    const existing = await this.#existingCard(cards, info.blobId);
    if (existing !== null) {
      return { card: existing, standIn: standInOf(existing) };
    }
    const missing: string[] = [];
    let ocrText: string | undefined;
    let transcript: string | undefined;
    let locale: string | undefined;
    let truncated = false;
    if (info.kind === "image") {
      const result = await this.#options.recognition.ocr(info.path, input.ocrLocales);
      if (result.available) {
        ocrText = result.text;
        locale = result.locale;
        truncated = result.truncated === true;
      } else {
        missing.push(reasonText("OCR", result.reason));
      }
    } else {
      const result = await this.#options.recognition.transcribe(info.path, input.locale);
      if (result.available) {
        transcript = result.text;
        locale = result.locale;
        truncated = result.truncated === true;
      } else {
        missing.push(reasonText("語音轉文字", result.reason));
      }
    }

    const generated = await this.#generateText(info.kind, {
      ...(ocrText === undefined ? {} : { ocrText }),
      ...(transcript === undefined ? {} : { transcript }),
      missing,
    });
    const standIn = composeTextStandIn({
      kind: info.kind,
      ...(ocrText === undefined ? {} : { ocrText }),
      ...(generated.description === undefined ? {} : { description: generated.description }),
      ...(transcript === undefined ? {} : { transcript }),
      ...(generated.summary === undefined ? {} : { summary: generated.summary }),
      missing: generated.missing,
      ...(truncated ? { truncated: true } : {}),
    });
    const title =
      input.title?.trim() ||
      defaultMediaTitle({ kind: info.kind, blobId: info.blobId, text: standIn.text });
    const summary =
      input.summary?.trim() ||
      summaryLine(generated.summary ?? generated.description ?? transcript ?? ocrText) ||
      undefined;
    const card = await cards.create({
      kind: info.kind,
      title,
      body: standIn.text,
      ...(summary === undefined ? {} : { summary }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.persona === undefined ? {} : { persona: input.persona }),
      assetBlobId: info.blobId,
    });
    this.#options.logger?.info("多模態匯入完成", {
      cardId: card.cardId,
      kind: info.kind,
      blobId: info.blobId,
      sizeBytes: info.sizeBytes,
      ocr: standIn.sources.ocr,
      description: standIn.sources.description,
      transcript: standIn.sources.transcript,
      summary: standIn.sources.summary,
      ...(locale === undefined ? {} : { locale }),
    });
    this.#options.trace?.("media:import");
    return { card, standIn };
  }

  /**
   * 翻牌：載入原檔給模型。
   *
   * 圖片一律先縮成固定規格；音訊只有主模型支援且呼叫端明確要求時才
   * 載入。模型不支援或無法確認時回文字替身與原因，不是錯誤。
   */
  async flip(input: FlipInput): Promise<FlipResult> {
    const key = input.cardId;
    const running = this.#flipping.get(key);
    if (running !== undefined) return running;
    const task = this.#flip(input).finally(() => {
      this.#flipping.delete(key);
    });
    this.#flipping.set(key, task);
    return task;
  }

  async #flip(input: FlipInput): Promise<FlipResult> {
    const cards = this.#cards();
    const card = await cards.get(input.cardId);
    if (card === null) {
      throw new MediaError("not_found", `找不到卡片 ${input.cardId}。`, { cardId: input.cardId });
    }
    const kind = card.frontmatter.kind;
    if (kind !== "image" && kind !== "audio") {
      throw new MediaError("invalid_message", "只有圖片或音訊卡片可以翻牌。", {
        reason: "not_media_card",
        cardId: card.cardId,
      });
    }
    const asset = card.frontmatter.asset;
    const blobId = asset === undefined ? undefined : assetIdOf(asset);
    if (blobId === undefined) {
      throw new MediaError("invalid_message", "卡片沒有指向原檔。", {
        reason: "asset_missing",
        cardId: card.cardId,
      });
    }
    const info = this.#options.store.info(blobId);
    if (info === undefined) {
      throw new MediaError("not_found", "找不到卡片指向的原檔。", {
        cardId: card.cardId,
        blobId,
      });
    }
    const supported = await this.#supports(kind, input.conversationId);
    if (!supported) {
      return {
        loaded: false,
        reason: `model_input_unsupported:${kind}`,
        mediaType: info.mediaType,
        assetId: info.blobId,
        text: card.body,
      };
    }
    if (kind === "audio" && input.needAudio !== true) {
      return {
        loaded: false,
        reason: "audio_not_requested",
        mediaType: info.mediaType,
        assetId: info.blobId,
        text: card.body,
      };
    }
    if (kind === "image") {
      const thumbnail = await this.#options.store.thumbnail(blobId);
      this.#recordFlip(card.cardId, input.conversationId);
      return {
        loaded: true,
        mediaType: "image/jpeg",
        assetId: info.blobId,
        bytes: thumbnail.bytes,
      };
    }
    const bytes = this.#options.store.read(blobId);
    if (bytes === undefined) {
      throw new MediaError("not_found", "找不到卡片指向的原檔。", { blobId });
    }
    this.#recordFlip(card.cardId, input.conversationId);
    return { loaded: true, mediaType: info.mediaType, assetId: info.blobId, bytes };
  }

  /** 主模型的輸入能力；查不到時當成不支援，回文字替身。 */
  async #supports(kind: MediaKind, conversationId: string | undefined): Promise<boolean> {
    const models = this.#options.models();
    const engine = this.#options.engine();
    if (models === undefined) return false;
    const state = (models as unknown as { readonly state?: SystemModelsState }).state;
    if (state === undefined) return false;
    let selection: { readonly provider: string; readonly model: string } | undefined;
    if (conversationId !== undefined && engine !== undefined) {
      try {
        const conversation = await engine.getConversation(conversationId);
        if (conversation !== null) selection = conversation.model;
      } catch {
        // 會話查不到時退回主角色解析結果。
      }
    }
    if (selection === undefined) {
      const main = state.resolved.find((role) => role.role === "main");
      const ref = main?.ref;
      if (ref === undefined) return false;
      selection = { provider: ref.providerId, model: ref.modelId };
    }
    const provider = state.providers.find((entry) => entry.providerId === selection.provider);
    const model = provider?.models.find((entry) => entry.modelId === selection.model);
    return model !== undefined && model.input.includes(kind);
  }

  async #generateText(
    kind: MediaKind,
    input: {
      readonly ocrText?: string;
      readonly transcript?: string;
      readonly missing: readonly string[];
    },
  ): Promise<{
    readonly description?: string;
    readonly summary?: string;
    readonly missing: string[];
  }> {
    const missing = [...input.missing];
    const models = this.#options.models();
    if (kind === "image") {
      if (input.ocrText === undefined || input.ocrText.trim().length === 0) {
        return { missing };
      }
      if (models === undefined) {
        missing.push("沒有可用的模型，圖片描述留空。");
        return { missing };
      }
      try {
        const result = await models.invoke({
          role: "small",
          purpose: "圖片描述",
          prompt:
            "請用兩三句繁體中文描述這張圖片的內容與重點。" +
            "以下是本機 OCR 讀到的文字，可能不完整：\n\n" +
            cap(input.ocrText),
        });
        const description = result.text.trim();
        if (description.length === 0) {
          missing.push("小模型沒有產生圖片描述。");
          return { missing };
        }
        return { description, missing };
      } catch {
        missing.push("小模型無法產生圖片描述。");
        return { missing };
      }
    }
    if (input.transcript === undefined || input.transcript.trim().length === 0) {
      return { missing };
    }
    if (models === undefined) {
      missing.push("沒有可用的模型，音訊摘要留空。");
      return { missing };
    }
    try {
      const result = await models.invoke({
        role: "small",
        purpose: "音訊摘要",
        prompt: "請用兩三句繁體中文摘要這段語音逐字稿的重點：\n\n" + cap(input.transcript),
      });
      const summary = result.text.trim();
      if (summary.length === 0) {
        missing.push("小模型沒有產生音訊摘要。");
        return { missing };
      }
      return { summary, missing };
    } catch {
      missing.push("小模型無法產生音訊摘要。");
      return { missing };
    }
  }

  async #existingCard(cards: CardService, blobId: string): Promise<Card | null> {
    for (const cardId of this.#options.store.cardsReferencing(blobId)) {
      const card = await cards.get(cardId);
      if (card !== null) return card;
    }
    return null;
  }

  #cards(): CardService {
    const cards = this.#options.cards();
    if (cards === undefined) {
      throw new MediaError("unavailable", "卡片服務尚未就緒。", { reason: "cards_unavailable" });
    }
    return cards;
  }

  /** 翻牌成功算一次載入，新鮮度回滿；狀態寫入失敗不影響已載入的原檔。 */
  #recordFlip(cardId: string, conversationId: string | undefined): void {
    try {
      const state = new CardStateStore({
        db: () => this.#options.cardStorage.state,
        now: this.#options.now,
      });
      state.recordLoad(conversationId ?? null, cardId, "flip", true);
      state.refresh(cardId);
    } catch (error) {
      this.#options.logger?.warn("翻牌的新鮮度寫入失敗", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function reasonText(label: string, reason: string): string {
  return `本機${label}不可用（${reason}）。`;
}

function cap(text: string): string {
  const trimmed = text.trim();
  return [...trimmed].slice(0, MODEL_INPUT_MAX_CHARS).join("");
}

function summaryLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line === undefined ? undefined : [...line].slice(0, SUMMARY_MAX_CHARS).join("");
}

/** 沒有文字替身可用時，翻牌回卡片內文；這是模型看到的替代內容。 */
function standInOf(card: Card): TextStandIn {
  const kind = card.frontmatter.kind;
  const mediaKind = kind === "audio" ? "audio" : "image";
  return {
    kind: mediaKind,
    text: card.body,
    sources: {
      ocr: mediaKind === "image" && card.body.includes("## OCR 文字") ? "local" : "none",
      description: mediaKind === "image" && card.body.includes("## 描述") ? "small-model" : "none",
      transcript: mediaKind === "audio" && card.body.includes("## 逐字稿") ? "local" : "none",
      summary: mediaKind === "audio" && card.body.includes("## 摘要") ? "small-model" : "none",
    },
    missing: [],
  };
}

function assetIdOf(asset: string): string | undefined {
  const name = asset.split("/").pop() ?? "";
  const id = name.split(".")[0];
  return id !== undefined && /^[0-9a-f]{64}$/i.test(id) ? id.toLowerCase() : undefined;
}
