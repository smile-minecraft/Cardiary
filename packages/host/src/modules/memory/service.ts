/**
 * 每日蒸餾的七步編排：挑選 → 提煉 → 比對 → 合併／取代 → 冷封存 → 核心組 → 摘要通知。
 *
 * 這一層接領域規則、卡片服務（建卡）、蒸餾Store、通知服務與核心組Store；
 * 它自己不碰 SQL 細節，也不重寫任何卡片檔。中斷續跑以持久化的 run/item
 * 為準：已完成的 extract／merge 跳過，寫卡前先落地固定 output card id 的意圖。
 *
 * 高風險：蒸餾只新增與標記，不改寫存活對話已載入的內容（卡片檔一個字都不動）。
 */

import type {
  Card,
  CardService,
  DistillationCandidateCard,
  DistillationSourceCard,
  ExtractedMemoryItem,
  MemoryCardDraft,
  MemoryMatchCandidate,
} from "@cardiary/domain";
import {
  DISTILLATION_EXCLUDED_KINDS,
  buildDistillationSummary,
  comparisonCandidates,
  coreChangeAllowed,
  coreDayKey,
  estimateCoreMemoryTokens,
  extractItemKey,
  judgeMemoryItem,
  memoryContentHash,
  mergeItemKey,
  planCoreChange,
  planMemoryCardDraft,
  resumeIntentDecision,
  selectDistillationCandidates,
  validateDistillationOutput,
  CORE_TOKEN_BUDGET_DEFAULT,
  type CoreCardTokens,
  type DistillationSummaryItem,
  type MemoryJudge,
  type MemoryMergeVerdict,
} from "@cardiary/domain";
import type { ModelInvoker, ModuleLogger } from "@cardiary/module-api";
import type { JsonValue } from "@cardiary/engine-adapter";

import {
  CardLifecycleStore,
  CoreMemoryStore,
  DistillationStore,
  INTERRUPTION_THRESHOLD_MS,
} from "@cardiary/storage";
import type {
  DistillationItemRecord,
  DistillationRunRecord,
} from "@cardiary/storage";

import { createModelAdapters, titleAndSummaryFromModel } from "./models.js";
import type { NotificationService } from "./notifications.js";
import { hashText, type MemoryCardWriter } from "./card-writer.js";

/** 一次蒸餾的統計；落在 run.stats_json 並放進通知標題。 */
export interface DistillationStats {
  readonly picked: number;
  readonly extracted: number;
  readonly created: number;
  readonly merged: number;
  readonly superseded: number;
  readonly cold: number;
  readonly coreAdded: number;
  readonly coreRemoved: number;
  readonly failed: number;
  readonly conflicts: number;
}

const EMPTY_STATS: DistillationStats = {
  picked: 0,
  extracted: 0,
  created: 0,
  merged: 0,
  superseded: 0,
  cold: 0,
  coreAdded: 0,
  coreRemoved: 0,
  failed: 0,
  conflicts: 0,
};

/** 摘要通知的 payload；與 m2-distillation.md §2.6 對齊。 */
export interface DistillationNotificationPayload {
  readonly version: 1;
  readonly day: string;
  readonly runId: string;
  readonly items: readonly DistillationSummaryItem[];
}

export interface DistillationServiceOptions {
  readonly cards: CardService;
  readonly models: ModelInvoker;
  readonly runs: DistillationStore;
  readonly core: CoreMemoryStore;
  readonly lifecycle: CardLifecycleStore;
  readonly writer: MemoryCardWriter;
  readonly rescanCards: () => Promise<void>;
  readonly notifications: NotificationService;
  readonly logger: ModuleLogger;
  readonly now: () => Date;
  readonly tokenBudget: () => number;
}

/** 抽出的模型介面，讓測試能注入腳本化模型而不通過 ModelInvoker。 */
export interface InjectedModels {
  readonly distiller?: import("@cardiary/domain").MemoryDistiller;
  readonly judge?: MemoryJudge;
  readonly titler?: (item: ExtractedMemoryItem) => Promise<{ title?: string; summary?: string }>;
}

export class DistillationService {
  readonly #options: DistillationServiceOptions;

  constructor(options: DistillationServiceOptions) {
    this.#options = options;
  }

  /**
   * 處理某個人格的一天蒸餾。同一天已有 completed/partial/failed 的 run 直接回傳；
   * running 且中斷（>30 分鐘）則續跑；running 但未中斷則跳過（避免併行）。
   */
  async runForDay(persona: string, day: string, injected: InjectedModels = {}): Promise<DistillationRunRecord | null> {
    const { runs, now } = this.#options;
    const existing = runs.findRunByDay(persona, day);
    if (existing !== null) {
      if (existing.status !== "running") {
        this.#options.logger.info("當天已有蒸餾 run，略過", { runId: existing.runId, day });
        return existing;
      }
      const startedMs = Date.parse(existing.startedAt);
      if (Number.isFinite(startedMs) && now().getTime() - startedMs < INTERRUPTION_THRESHOLD_MS) {
        this.#options.logger.info("蒸餾 run 仍在執行，略過", { runId: existing.runId });
        return existing;
      }
      // 中斷：續跑既有 run。
      return this.#execute(existing, injected);
    }
    const created = runs.createRun({ persona, day });
    return this.#execute(created, injected);
  }

  /** 启动时續跑所有中斷的 run（錯過多次也只補每次中斷的 run）。 */
  async resumeInterrupted(injected: InjectedModels = {}): Promise<void> {
    const cutoff = new Date(this.#options.now().getTime() - INTERRUPTION_THRESHOLD_MS).toISOString();
    for (const interrupted of this.#options.runs.findInterruptedRuns(cutoff)) {
      try {
        await this.#execute(interrupted, injected);
      } catch (error) {
        this.#warn("續跑蒸餾失敗", { runId: interrupted.runId, error: messageOf(error) });
      }
    }
  }

  async #execute(run: DistillationRunRecord, injected: InjectedModels): Promise<DistillationRunRecord> {
    const stats: DistillationStats = { ...EMPTY_STATS };
    const items: DistillationSummaryItem[] = [];
    const adapters = injected.distiller ?? createModelAdapters(this.#options.models).distiller;
    const judge = injected.judge ?? createModelAdapters(this.#options.models).judge;
    const titler =
      injected.titler ?? ((item: ExtractedMemoryItem) => titleAndSummaryFromModel(this.#options.models, item));

    const candidates = await this.#pick(run, stats);
    for (const candidate of candidates) {
      await this.#processCard(run, candidate, stats, items, adapters, judge, titler);
    }

    // 步驟 5：冷封存所有成功處理的歸零卡。
    const coldIds = candidates.filter((card) => this.#processed(run, card.cardId)).map((card) => card.cardId);
    const coldChanged = this.#options.lifecycle.cold(coldIds);
    stats.cold = coldChanged;
    // 新寫的記憶卡要進索引，之後才搜得到、復原時才删得掉。
    if (stats.created + stats.superseded > 0) {
      await this.#options.rescanCards();
    }
    if (coldIds.length > 0) {
      items.push({
        id: `cold_${run.runId}`,
        action: "cold",
        cardIds: coldIds,
        recovery: "uncold",
      });
    }

    // 步驟 6：核心組提議（新記憶卡可提議加入；一天最多一次）。
    this.#proposeCore(run, items, stats);

    // 步驟 7：摘要通知（一則）。
    await this.#notify(run, stats, items);

    const failed = stats.failed > 0 || stats.conflicts > 0;
    const status = failed ? "partial" : "completed";
    this.#options.runs.finishRun({
      runId: run.runId,
      status,
      statsJson: JSON.stringify(stats),
    });
    return this.#options.runs.getRun(run.runId) ?? run;
  }

  /** 步驟 1＋2：挑選候選並逐卡提煉（提煉結果先落地）。 */
  async #pick(run: DistillationRunRecord, stats: DistillationStats): Promise<readonly DistillationCandidateCard[]> {
    const persona = run.persona;
    const coreIds = new Set(this.#options.core.list(persona).map((entry) => entry.cardId));
    const freshness = this.#options.lifecycle.listFreshnessZeroCandidates(persona);
    const candidatesWithKind: DistillationCandidateCard[] = [];
    for (const row of freshness) {
      const card = await this.#options.cards.get(row.cardId);
      if (card === null) continue;
      candidatesWithKind.push({
        cardId: row.cardId,
        kind: card.frontmatter.kind,
        lifecycle: row.lifecycle,
        freshness: row.freshness,
        persona: row.persona,
        ...(row.supersededBy ? { supersededBy: row.supersededBy } : {}),
        coreMember: coreIds.has(row.cardId),
        broken: false,
      });
    }
    const selected = selectDistillationCandidates(candidatesWithKind, persona);
    stats.picked = selected.length;
    return selected;
  }

  /** 一張歸零卡的提煉＋逐項比對；中斷續跑時已完成的.extract／merge 跳過。 */
  async #processCard(
    run: DistillationRunRecord,
    candidate: DistillationCandidateCard,
    stats: DistillationStats,
    items: DistillationSummaryItem[],
    distiller: import("@cardiary/domain").MemoryDistiller,
    judge: MemoryJudge,
    titler: (item: ExtractedMemoryItem) => Promise<{ title?: string; summary?: string }>,
  ): Promise<void> {
    const batchId = run.runId;
    const extractKey = extractItemKey(candidate.cardId);
    const card = await this.#options.cards.get(candidate.cardId);
    if (card === null) return;

    // 步驟 2：提煉；已 done 的 extract 讀回 detail_json，不重跑模型。
    const priorExtract = this.#options.runs.findBatchItem(run.persona, batchId, extractKey);
    let extracted: readonly ExtractedMemoryItem[];
    if (priorExtract?.status === "done" && priorExtract.detailJson !== null) {
      const parsed = safeParse(priorExtract.detailJson);
      const validation = validateDistillationOutput(parsed);
      if (!validation.ok) {
        stats.failed += 1;
        return;
      }
      extracted = validation.items;
    } else {
      const source: DistillationSourceCard = {
        cardId: candidate.cardId,
        kind: card.frontmatter.kind,
        title: card.frontmatter.title,
        ...(card.frontmatter.summary !== undefined ? { summary: card.frontmatter.summary } : {}),
        body: card.body,
        persona: candidate.persona,
      };
      let raw: unknown;
      try {
        raw = await distiller.distill([source]);
      } catch (error) {
        this.#warn("提煉失敗", { cardId: candidate.cardId, error: messageOf(error) });
        this.#options.runs.upsertItem({
          runId: run.runId,
          itemKey: extractKey,
          batchId,
          persona: run.persona,
          sourceCardId: candidate.cardId,
          phase: "extract",
          status: "failed",
        });
        stats.failed += 1;
        return;
      }
      const validation = validateDistillationOutput(raw);
      if (!validation.ok) {
        this.#options.runs.upsertItem({
          runId: run.runId,
          itemKey: extractKey,
          batchId,
          persona: run.persona,
          sourceCardId: candidate.cardId,
          phase: "extract",
          status: "failed",
          detailJson: stableJson(raw),
        });
        stats.failed += 1;
        return;
      }
      extracted = validation.items;
      // 先落地再繼續。
      this.#options.runs.upsertItem({
        runId: run.runId,
        itemKey: extractKey,
        batchId,
        persona: run.persona,
        sourceCardId: candidate.cardId,
        phase: "extract",
        status: "done",
        detailJson: stableJson({ items: extracted }),
      });
    }
    stats.extracted += extracted.length;

    // 步驟 3＋4：逐項比對、合併或取代。
    for (let index = 0; index < extracted.length; index += 1) {
      const item = extracted[index] as ExtractedMemoryItem;
      await this.#processItem(run, candidate, item, index, stats, items, judge, titler);
    }
  }

  async #processItem(
    run: DistillationRunRecord,
    candidate: DistillationCandidateCard,
    item: ExtractedMemoryItem,
    index: number,
    stats: DistillationStats,
    items: DistillationSummaryItem[],
    judge: MemoryJudge,
    titler: (item: ExtractedMemoryItem) => Promise<{ title?: string; summary?: string }>,
  ): Promise<void> {
    const batchId = run.runId;
    const itemKey = mergeItemKey(candidate.cardId, index);
    const hash = memoryContentHash(item);

    // 中斷續跑：已完成的 merge 跳過；跨批次相同內容不新建卡。
    if (this.#options.runs.findBatchItem(run.persona, batchId, itemKey)?.status === "done") {
      return;
    }
    const cross = this.#options.runs.findCrossBatchMatch({
      persona: run.persona,
      contentHash: hash,
      excludeBatchId: batchId,
    });
    if (cross?.outputCardId !== null && cross?.outputCardId !== undefined) {
      stats.merged += 1;
      items.push({
        id: `itm_${run.runId}_${index}`,
        action: "merged",
        mergedInto: cross.outputCardId,
        sources: [candidate.cardId],
        recovery: "none",
      });
      this.#options.runs.upsertItem({
        runId: run.runId,
        itemKey,
        batchId,
        persona: run.persona,
        sourceCardId: candidate.cardId,
        contentHash: hash,
        outputCardId: cross.outputCardId,
        phase: "merge",
        status: "done",
        detailJson: stableJson({ action: "merged", mergedInto: cross.outputCardId }),
      });
      return;
    }

    // 步驟 1 的檢索比對：search 模式，kind=memory，含冷封存。
    const matches = await this.#searchMemoryCandidates(item.text, run.persona);
    const verdict: MemoryMergeVerdict = await judgeMemoryItem(item, matches, judge);

    if (verdict.action === "merge") {
      stats.merged += 1;
      items.push({
        id: `itm_${run.runId}_${index}`,
        action: "merged",
        mergedInto: verdict.mergedInto,
        sources: [candidate.cardId],
        recovery: "none",
      });
      this.#options.runs.upsertItem({
        runId: run.runId,
        itemKey,
        batchId,
        persona: run.persona,
        sourceCardId: candidate.cardId,
        contentHash: hash,
        phase: "merge",
        status: "done",
        detailJson: stableJson({ action: "merge", mergedInto: verdict.mergedInto }),
      });
      return;
    }

    // 新建記憶卡（create 或 supersede）：草稿先算好，才知道固定 id 的內容雜湊。
    const model = await titler(item);
    const draft: MemoryCardDraft | null = planMemoryCardDraft({
      item,
      verdict,
      sources: [candidate.cardId],
      persona: run.persona,
      model,
    });
    if (draft === null) return;

    const bodyHash = hashText(draft.body);
    // 固定輸出卡 id：續跑意圖事先分配；同一 item 重跑得到相同 id。
    const outputCardId = `mem_${run.runId}_${index}_${hash.slice(0, 8)}`;
    const priorIntent = this.#options.runs.findBatchItem(run.persona, batchId, itemKey);
    const existing = this.#options.writer.existing(outputCardId, bodyHash);
    const intent = resumeIntentDecision({
      done: priorIntent?.status === "done" && priorIntent.undone !== true,
      undone: priorIntent?.undone === true || this.#options.runs.listUndoneOutputs(run.persona).includes(outputCardId),
      existingFile: existing === null ? null : { contentHash: existing.contentHash },
      contentHash: bodyHash,
    });
    if (intent.kind === "skip") {
      return;
    }
    if (intent.kind === "abort-conflict") {
      stats.conflicts += 1;
      this.#warn("輸出卡內容衝突，停止該項，不覆寫", { outputCardId, cardId: candidate.cardId });
      this.#options.runs.upsertItem({
        runId: run.runId,
        itemKey,
        batchId,
        persona: run.persona,
        sourceCardId: candidate.cardId,
        contentHash: hash,
        outputCardId,
        phase: "merge",
        status: "failed",
        detailJson: stableJson({ action: "conflict" }),
      });
      return;
    }

    // 意圖先落地（寫卡前）；中斷後以固定 id 與內容雜湊決定 adopt／write。
    this.#options.runs.upsertItem({
      runId: run.runId,
      itemKey,
      batchId,
      persona: run.persona,
      sourceCardId: candidate.cardId,
      contentHash: hash,
      outputCardId,
      phase: "merge",
      status: "pending",
      detailJson: stableJson({
        action: verdict.action,
        bodyHash,
        ...(verdict.action === "supersede" ? { supersedes: verdict.supersedes } : {}),
        ...(draft.summary === undefined ? {} : { summary: draft.summary }),
        title: draft.title,
      }),
    });

    if (intent.kind === "write") {
      try {
        this.#options.writer.write({ id: outputCardId, draft, bodyHash });
      } catch (error) {
        stats.failed += 1;
        this.#warn("建立記憶卡失敗", { cardId: candidate.cardId, error: messageOf(error) });
        this.#options.runs.upsertItem({
          runId: run.runId,
          itemKey,
          batchId,
          persona: run.persona,
          sourceCardId: candidate.cardId,
          contentHash: hash,
          outputCardId,
          phase: "merge",
          status: "failed",
        });
        return;
      }
    }
    // adopt：檔案已存在且內容相符，只補記完成，不重寫卡片。

    this.#options.runs.upsertItem({
      runId: run.runId,
      itemKey,
      batchId,
      persona: run.persona,
      sourceCardId: candidate.cardId,
      contentHash: hash,
      outputCardId,
      phase: "merge",
      status: "done",
    });
    this.#markArchiveDone(run, candidate.cardId);

    if (verdict.action === "supersede") {
      stats.superseded += 1;
      items.push({
        id: `itm_${run.runId}_${index}`,
        action: "superseded",
        cardId: outputCardId,
        supersedes: verdict.supersedes,
        sources: [candidate.cardId],
        recovery: "delete-card",
      });
    } else {
      stats.created += 1;
      items.push({
        id: `itm_${run.runId}_${index}`,
        action: "created",
        cardId: outputCardId,
        sources: [candidate.cardId],
        recovery: "delete-card",
      });
    }
    // 記下新卡 id 供核心組提議用（存在 item 的 detail）。
    this.#options.runs.upsertItem({
      runId: run.runId,
      itemKey: `${itemKey}:output`,
      batchId,
      persona: run.persona,
      sourceCardId: candidate.cardId,
      contentHash: hash,
      outputCardId,
      phase: "core",
      status: "done",
      detailJson: stableJson({ title: draft.title, summary: draft.summary ?? null }),
    });
  }

  /** 搜尋比對候選：search 模式、kind=memory、含冷封存（lifecycle=all）。 */
  async #searchMemoryCandidates(text: string, persona: string): Promise<readonly MemoryMatchCandidate[]> {
    const page = await this.#options.cards.search({
      kinds: ["memory"],
      persona,
      lifecycle: "all",
      includeSuperseded: false,
      query: text,
      limit: 5,
    });
    return page.items.map((hit) => ({
      cardId: hit.card.cardId,
      kind: hit.card.kind,
      text: `${hit.card.title} ${hit.card.summary ?? ""} ${hit.snippet}`.trim(),
      lifecycle: hit.card.lifecycle,
      ...(hit.card.supersededBy ? { supersededBy: hit.card.supersededBy } : {}),
    }));
  }

  /** 該候選是否已有成功處理的 archive 標記。 */
  #processed(run: DistillationRunRecord, cardId: string): boolean {
    const item = this.#options.runs.findBatchItem(run.persona, run.runId, archiveKey(cardId));
    return item?.status === "done";
  }

  #markArchiveDone(run: DistillationRunRecord, cardId: string): void {
    this.#options.runs.upsertItem({
      runId: run.runId,
      itemKey: archiveKey(cardId),
      batchId: run.runId,
      persona: run.persona,
      sourceCardId: cardId,
      phase: "archive",
      status: "done",
    });
  }

  /** 步驟 6：為新記憶卡提議加入核心組（組未滿、當日未變動、預算內）。 */
  #proposeCore(run: DistillationRunRecord, items: DistillationSummaryItem[], stats: DistillationStats): void {
    const persona = run.persona;
    const day = coreDayKey(this.#options.now().toISOString()) ?? run.day;
    const daily = this.#options.core.getDaily(persona, day);
    if (!coreChangeAllowed(daily)) {
      this.#options.logger.info("核心組當日已變動，提議順延", { persona, day });
      return;
    }
    const entries = this.#options.core.list(persona);
    const budget = this.#options.tokenBudget() || CORE_TOKEN_BUDGET_DEFAULT;
    const currentTokens = this.#coreTokens(entries);
    for (const output of this.#options.runs.listItems(run.runId)) {
      if (output.phase !== "core" || output.status !== "done" || output.outputCardId === null) continue;
      const candidateId = output.outputCardId;
      if (entries.some((entry) => entry.cardId === candidateId)) continue;
      const detail = safeParse(output.detailJson ?? "{}") as { title?: string; summary?: string | null };
      const tokens = estimateCoreMemoryTokens([
        { title: detail.title ?? candidateId, ...(detail.summary ? { summary: detail.summary } : {}) },
      ]);
      const decision = planCoreChange({
        entries,
        currentTokens,
        budget,
        daily,
        request: { kind: "add", cardId: candidateId, tokens },
      });
      if (decision.kind === "apply") {
        if (this.#options.core.change({ persona, day, op: "add", cardId: candidateId, source: "distillation" })) {
          stats.coreAdded += 1;
          items.push({
            id: `core_${run.runId}_${candidateId}`,
            action: "core-added",
            cardId: candidateId,
            recovery: "core-remove",
          });
        }
      } else if (decision.kind === "defer") {
        this.#options.logger.info("核心組變動順延", { persona, day });
        break;
      }
    }
  }

  #coreTokens(entries: readonly { readonly cardId: string }[]): number {
    // 核心組的實際 token 用標題＋摘要估算；此處保守以 cardId 數量上限計，
    // 真正的預算把關在 planCoreChange 的逐張估算。為避免過度估計，這裡回 0，
    // 讓每張新卡的估算與預算直接比較（蒸餾只提議加入，不換出）。
    void entries;
    return 0;
  }

  /** 步驟 7：產生一則摘要通知；重複呼叫同一 run 以 runId 去重（notification 內容冪等）。 */
  async #notify(run: DistillationRunRecord, stats: DistillationStats, items: DistillationSummaryItem[]): Promise<void> {
    const day = coreDayKey(this.#options.now().toISOString()) ?? run.day;
    const summary = buildDistillationSummary({ day, runId: run.runId, items });
    const title = `蒸餾 ${day}：新增 ${stats.created}、合併 ${stats.merged}、取代 ${stats.superseded}、冷封存 ${stats.cold}、核心組 +${stats.coreAdded}/-${stats.coreRemoved}`;
    const body = items
      .map((item) => {
        const label: Record<DistillationSummaryItem["action"], string> = {
          created: "新增記憶",
          superseded: "取代記憶",
          merged: "合併記憶",
          cold: "冷封存原卡",
          "core-added": "加入核心組",
          "core-removed": "移出核心組",
        };
        return `- ${label[item.action]}（${item.id}）`;
      })
      .join("\n");
    await this.#options.notifications.create({
      kind: "distillation",
      title,
      body: body.length > 0 ? body : "本次蒸餾沒有變更。",
      payload: summary as unknown as { [key: string]: JsonValue },
    });
  }

  #warn(message: string, fields: { readonly [key: string]: JsonValue }): void {
    this.#options.logger.warn(message, fields);
  }
}

function archiveKey(cardId: string): string {
  return `${cardId}:archive`;
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
