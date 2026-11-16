import { homedir } from "node:os";

import type { ModelInvoker, ModuleLogger } from "@cardiary/module-api";

import type { ImportCardWriter } from "./card-writer.js";
import { ImportError, jobNotWritable, rangeRequired } from "./errors.js";
import { SourceAccessError, type ReadonlyDatabaseOpener, type SourceFileSystem } from "./fs.js";
import { listGenericFiles, type GenericListing } from "./sources/generic.js";
import { fileItemPath, skillItemPath } from "./interchange.js";
import type { ImportJob, ImportItem, ImportJobStore } from "./store.js";
import type { SkillCopier } from "./skills.js";
import {
  IMPORT_CATEGORIES,
  IMPORT_CATEGORY_ORDER,
  IMPORT_SOURCE_KINDS,
  type ImportCategory,
  type ImportConversationCandidate,
  type ImportConversationEstimate,
  type ImportDateRange,
  type ImportPreview,
  type ImportPreviewItem,
  type ImportPreviewSkill,
  type ImportScanOptions,
  type ImportScanResult,
  type ImportSourceAdapter,
  type ImportSourceAvailability,
  type ImportSourceKind,
  type ImportWriteReport,
  type ImportWrittenItem,
} from "./types.js";

/**
 * 匯入的流程：掃描來源、預覽、寫入。
 *
 * 三個轉接器只負責讀來源與轉成中介格式；這一層決定預覽要顯示什麼、哪些
 * 項目重複、寫入時建立卡片或複製技能。來源在整條流程裡都是唯讀；寫入只
 * 發生在 Cardiary 自己的資料夾。
 */
export interface ImportServiceOptions {
  readonly now?: () => Date;
  readonly fs: SourceFileSystem;
  readonly openDatabase: ReadonlyDatabaseOpener;
  readonly adapters: ReadonlyMap<ImportSourceKind, ImportSourceAdapter>;
  readonly store: ImportJobStore;
  readonly cards: ImportCardWriter;
  readonly skills: SkillCopier;
  /** 寫完卡片後重建索引；由卡片庫的 `CardIndex.rescan` 提供。 */
  readonly rescanCards: () => Promise<void>;
  /** 小模型；沒有設定模型時回 undefined，對話匯入會標成失敗而不是亂猜。 */
  readonly models?: () => ModelInvoker | undefined;
  /** 進度事件；每一項寫完送一次。 */
  readonly emitProgress?: (payload: Record<string, unknown>) => void;
  readonly logger: ModuleLogger;
  readonly homeDir?: string;
}

export interface PreviewInput {
  readonly sourceKind: ImportSourceKind;
  readonly sourcePath?: string;
  readonly categories?: Readonly<Record<string, ImportCategory>>;
  readonly defaultCategory?: ImportCategory | "ignore";
  readonly includeConversations?: boolean;
  readonly rangeStart?: string;
  readonly rangeEnd?: string;
  readonly providedPersona?: { readonly title: string; readonly body: string };
}

export interface WriteInput {
  readonly jobId: string;
  readonly itemKeys: readonly string[];
  readonly coreMemoryItemKeys?: readonly string[];
  /** 使用者明確要求重新匯入已經存在的內容。 */
  readonly reimport?: boolean;
}

export class ImportService {
  readonly #fs: SourceFileSystem;
  readonly #adapters: ReadonlyMap<ImportSourceKind, ImportSourceAdapter>;
  readonly #store: ImportJobStore;
  readonly #cards: ImportCardWriter;
  readonly #skills: SkillCopier;
  readonly #rescanCards: () => Promise<void>;
  readonly #models: (() => ModelInvoker | undefined) | undefined;
  readonly #emitProgress: ((payload: Record<string, unknown>) => void) | undefined;
  readonly #logger: ModuleLogger;
  readonly #homeDir: string;

  constructor(options: ImportServiceOptions) {
    this.#fs = options.fs;
    this.#adapters = options.adapters;
    this.#store = options.store;
    this.#cards = options.cards;
    this.#skills = options.skills;
    this.#rescanCards = options.rescanCards;
    this.#models = options.models;
    this.#emitProgress = options.emitProgress;
    this.#logger = options.logger;
    this.#homeDir = options.homeDir ?? homedir();
  }

  /** 三個來源的預設位置與可用性；只 stat，不讀內容。 */
  async sources(): Promise<ImportSourceAvailability[]> {
    const almaPath = `${this.#homeDir}/Library/Application Support/alma/chat_threads.db`;
    const hermesRoot = `${this.#homeDir}/.hermes`;
    const [almaStat, hermesSkills, hermesConfig, codexStat, claudeStat] = await Promise.all([
      this.#fs.stat(almaPath),
      this.#fs.stat(`${hermesRoot}/skills`),
      this.#fs.stat(`${hermesRoot}/config.yaml`),
      this.#fs.stat(`${this.#homeDir}/.codex`),
      this.#fs.stat(`${this.#homeDir}/.claude`),
    ]);
    const hermesAvailable = hermesSkills.kind === "directory" || hermesConfig.kind === "file";
    return [
      {
        kind: "generic",
        name: "通用資料夾",
        available: true,
        path: "",
        detail: "任意資料夾的 Markdown 與純文字；每個檔案由你指定類別。",
      },
      {
        kind: "hermes",
        name: "Hermes",
        available: hermesAvailable,
        path: hermesRoot,
        detail: hermesAvailable
          ? "讀取 skills/ 與 config.yaml（只讀鍵名）；state.db 的對話未驗證。"
          : "這台機器沒有安裝 Hermes agent。",
        unverified: "state.db 的對話 schema 與記憶檔格式",
      },
      {
        kind: "alma",
        name: "Alma",
        available: almaStat.kind === "file",
        path: almaPath,
        detail:
          almaStat.kind === "file"
            ? "唯讀開啟 chat_threads.db；人格沒有來源，由你提供。"
            : "找不到 Alma 的 chat_threads.db。",
        unverified: "匯出檔 threads.json 的欄位",
      },
      {
        kind: "codex",
        name: "Codex",
        available: codexStat.kind === "directory",
        path: `${this.#homeDir}/.codex`,
        detail: "匯入規則、記憶與所選時間的對話。",
        unverified: "對話格式",
      },
      {
        kind: "claude-code",
        name: "Claude Code",
        available: claudeStat.kind === "directory",
        path: `${this.#homeDir}/.claude`,
        detail: "匯入規則、專案記憶與所選時間的對話。",
        unverified: "對話格式",
      },
    ];
  }

  /** 通用來源的檔案清單；讓使用者逐檔指定類別。 */
  async list(input: { readonly path: string }): Promise<GenericListing> {
    if (input.path.trim() === "") {
      throw new ImportError("invalid_message", "缺少來源資料夾。", { field: "sourcePath" });
    }
    try {
      return await listGenericFiles(this.#fs, input.path);
    } catch (error) {
      throw asImportError(error);
    }
  }

  async preview(input: PreviewInput): Promise<ImportPreview> {
    const range = rangeOf(input.includeConversations === true, input.rangeStart, input.rangeEnd);
    const scan = await this.#scan({
      kind: input.sourceKind,
      ...(input.sourcePath === undefined ? {} : { path: input.sourcePath }),
      ...(input.categories === undefined ? {} : { categories: input.categories }),
      ...(input.defaultCategory === undefined ? {} : { defaultCategory: input.defaultCategory }),
      includeConversations: input.includeConversations === true,
      ...(range === undefined ? {} : { range }),
      ...(input.providedPersona === undefined ? {} : { providedPersona: input.providedPersona }),
    });

    const items = sortByCategory(
      scan.items.map((item): ImportPreviewItem => {
        const duplicate = this.#duplicateCardId(item.contentHash);
        return { ...item, ...(duplicate === undefined ? {} : { duplicateCardId: duplicate }) };
      }),
    );
    const skills: ImportPreviewSkill[] = [];
    for (const skill of scan.skills) {
      const existing = await this.#skills.existing(skill);
      skills.push({ ...skill, ...(existing === undefined ? {} : { existingSkillPath: existing }) });
    }
    const conversationEstimate =
      scan.conversations.length === 0 || range === undefined
        ? undefined
        : estimateConversations(scan.conversations, range);

    const jobId = this.#store.create({
      sourceKind: input.sourceKind,
      sourcePath: scan.sourcePath,
      ...(range === undefined ? {} : { rangeStart: range.start, rangeEnd: range.end }),
    });
    this.#store.setPreviewState(jobId, {
      ...(input.providedPersona === undefined ? {} : { providedPersona: input.providedPersona }),
    });
    this.#store.replaceItems(jobId, [
      ...items.map((item) => ({
        key: item.key,
        category: item.category,
        contentHash: item.contentHash,
      })),
      ...skills.map((skill) => ({
        key: skill.key,
        category: "skill" as const,
        contentHash: skill.contentHash,
      })),
      ...scan.conversations.map((conversation) => ({
        key: conversation.key,
        category: "conversation" as const,
        contentHash: conversation.contentHash,
      })),
    ]);

    const duplicates =
      items.filter((item) => item.duplicateCardId !== undefined).length +
      skills.filter((skill) => skill.existingSkillPath !== undefined).length;
    this.#logger.info("匯入預覽", {
      jobId,
      sourceKind: input.sourceKind,
      items: items.length,
      skills: skills.length,
      conversations: scan.conversations.length,
      duplicates,
    });

    return {
      jobId,
      source: {
        kind: input.sourceKind,
        path: scan.sourcePath,
        tool: scan.tool,
        ...(scan.version === undefined ? {} : { version: scan.version }),
      },
      items,
      skills,
      conversations: scan.conversations.map(withoutTranscript),
      skipped: scan.skipped,
      notes: scan.notes,
      warnings: scan.warnings,
      ...(conversationEstimate === undefined ? {} : { conversationEstimate }),
      newCards: items.filter((item) => item.duplicateCardId === undefined).length,
      duplicates,
    };
  }

  async write(input: WriteInput): Promise<ImportWriteReport> {
    const job = this.#store.get(input.jobId);
    if (job === undefined) {
      throw new ImportError("not_found", "找不到這筆匯入工作。", { jobId: input.jobId });
    }
    if (job.status !== "preview") {
      throw jobNotWritable(job.jobId, job.status);
    }
    const stored = this.#store.itemsOf(job.jobId);
    const byKey = new Map(stored.map((item) => [item.itemKey, item]));
    const selection: ImportItem[] = [];
    for (const key of input.itemKeys) {
      const item = byKey.get(key);
      if (item === undefined) {
        throw new ImportError("invalid_message", "勾選的項目不在這筆預覽裡。", {
          reason: "unknown_item",
          itemKey: key,
        });
      }
      selection.push(item);
    }
    if (selection.length === 0) {
      throw new ImportError("invalid_message", "沒有勾選任何項目。", { reason: "empty_selection" });
    }
    if (
      selection.some((item) => item.category === "conversation") &&
      (job.rangeStart === undefined || job.rangeEnd === undefined)
    ) {
      throw rangeRequired();
    }

    this.#store.setStatus(job.jobId, "running");
    try {
      const scan = await this.#scanForJob(job, selection);
      const report = await this.#writeSelection(job, scan, selection, input);
      this.#store.setStatus(job.jobId, "completed", JSON.stringify(report));
      this.#logger.info("匯入完成", {
        jobId: job.jobId,
        cardsCreated: report.cardsCreated,
        skillsCopied: report.skillsCopied,
        duplicates: report.duplicates,
        failed: report.failed,
      });
      return report;
    } catch (error) {
      this.#store.setStatus(job.jobId, "failed");
      throw asImportError(error);
    }
  }

  async #writeSelection(
    job: ImportJob,
    scan: ImportScanResult & { readonly sourcePath: string },
    selection: readonly ImportItem[],
    input: WriteInput,
  ): Promise<ImportWriteReport> {
    const drafts = new Map(scan.items.map((item) => [item.key, item]));
    const skills = new Map(scan.skills.map((skill) => [skill.key, skill]));
    const conversations = new Map(scan.conversations.map((entry) => [entry.key, entry]));
    const coreKeys = new Set(input.coreMemoryItemKeys ?? []);
    const results: ImportWrittenItem[] = [];
    const coreMemoryCandidates: string[] = [];
    let cardsCreated = 0;
    let skillsCopied = 0;
    let duplicates = 0;
    let failed = 0;
    let cardsWritten = false;

    for (const [index, item] of selection.entries()) {
      const record = (result: ImportWrittenItem, reason?: string): void => {
        results.push(result);
        this.#store.markItem(job.jobId, item.itemKey, {
          status: result.status,
          ...(result.cardId === undefined ? {} : { cardId: result.cardId }),
          ...(reason === undefined ? {} : { reason }),
        });
        this.#emitProgress?.({
          jobId: job.jobId,
          done: index + 1,
          total: selection.length,
          status: result.status,
          category: item.category,
          ...(reason === undefined ? {} : { reason }),
        });
      };
      const skipped = (reason: string): void => {
        record({ key: item.itemKey, category: item.category, status: "skipped", reason }, reason);
      };

      const duplicate =
        input.reimport === true ? undefined : this.#duplicateCardId(item.contentHash);
      if (duplicate !== undefined) {
        duplicates += 1;
        record(
          {
            key: item.itemKey,
            category: item.category,
            status: "skipped",
            duplicateCardId: duplicate,
          },
          "duplicate",
        );
        continue;
      }

      if (item.category === "skill") {
        const draft = skills.get(item.itemKey);
        if (draft === undefined) {
          skipped("missing-at-write");
          continue;
        }
        const copied = await this.#skills.copy(draft);
        if (copied.status === "exists") {
          duplicates += 1;
          record(
            {
              key: item.itemKey,
              category: item.category,
              status: "skipped",
              skillPath: `skills/${copied.directory}/SKILL.md`,
            },
            "duplicate",
          );
          continue;
        }
        skillsCopied += 1;
        record({
          key: item.itemKey,
          category: item.category,
          status: "written",
          skillPath: `skills/${copied.directory}/SKILL.md`,
        });
        continue;
      }

      if (item.category === "conversation") {
        const candidate = conversations.get(item.itemKey);
        if (candidate === undefined) {
          skipped("missing-at-write");
          continue;
        }
        const summary = await this.#summaryOf(candidate);
        if (summary === undefined) {
          failed += 1;
          record(
            {
              key: item.itemKey,
              category: item.category,
              status: "failed",
              reason: "model-unavailable",
            },
            "model-unavailable",
          );
          continue;
        }
        const summaryLine = firstLine(summary);
        const written = this.#cards.write({
          kind: "summary",
          title: `對話摘要：${candidate.title}`,
          body: summary,
          ...(summaryLine === undefined ? {} : { summary: summaryLine }),
          tags: ["匯入", "對話摘要"],
          createdAt: candidate.createdAt,
          source: {
            tool: candidate.source.tool,
            path: candidate.source.path,
            hash: item.contentHash,
          },
        });
        cardsCreated += 1;
        cardsWritten = true;
        record({
          key: item.itemKey,
          category: item.category,
          status: "written",
          cardId: written.cardId,
        });
        continue;
      }

      const draft = drafts.get(item.itemKey);
      if (draft === undefined || draft.category === "skill" || draft.category === "conversation") {
        skipped("missing-at-write");
        continue;
      }
      const isCore =
        (draft.category === "user" || draft.category === "memory") && coreKeys.has(draft.key);
      const written = this.#cards.write({
        kind: cardKindOf(draft.category),
        title: draft.title,
        body: draft.body,
        ...(draft.summary === undefined ? {} : { summary: draft.summary }),
        tags: dedupe([...draft.tags, ...(isCore ? ["core-memory"] : [])]),
        ...(draft.createdAt === undefined ? {} : { createdAt: draft.createdAt }),
        source: { tool: draft.source.tool, path: draft.source.path, hash: draft.contentHash },
      });
      cardsCreated += 1;
      cardsWritten = true;
      if (isCore) coreMemoryCandidates.push(written.cardId);
      record({
        key: item.itemKey,
        category: item.category,
        status: "written",
        cardId: written.cardId,
      });
    }

    if (cardsWritten) await this.#rescanCards();

    const range =
      job.rangeStart === undefined || job.rangeEnd === undefined
        ? undefined
        : { start: job.rangeStart, end: job.rangeEnd };
    const selectedConversations = scan.conversations.filter((candidate) =>
      selection.some((item) => item.itemKey === candidate.key),
    );
    return {
      jobId: job.jobId,
      status: "completed",
      cardsCreated,
      skillsCopied,
      duplicates,
      failed,
      skipped: scan.skipped,
      results,
      coreMemoryCandidates,
      ...(range === undefined || selectedConversations.length === 0
        ? {}
        : { conversationEstimate: estimateConversations(selectedConversations, range) }),
      warnings: [...scan.warnings, ...(failed > 0 ? ["有項目需要模型但沒有可用的模型。"] : [])],
    };
  }

  /** 對話的摘要：來源已經有就沿用，沒有才呼叫小模型。 */
  async #summaryOf(candidate: ImportConversationCandidate): Promise<string | undefined> {
    if (candidate.existingSummary !== undefined && candidate.existingSummary.trim() !== "") {
      return candidate.existingSummary;
    }
    const models = this.#models?.();
    const transcript = candidate.transcript ?? "";
    if (models === undefined || transcript.trim() === "") return undefined;
    try {
      const result = await models.invoke(
        {
          role: "small",
          purpose: "匯入對話摘要",
          prompt: [
            "請把下面這段對話整理成 3 到 6 句繁體中文重點，只輸出摘要正文，不要標題或客套話。",
            "",
            `對話標題：${candidate.title}`,
            "",
            transcript.slice(0, 60_000),
          ].join("\n"),
          maxOutputTokens: 4096,
        },
        { signal: AbortSignal.timeout(120_000) },
      );
      const text = result.text.trim();
      return text === "" ? undefined : text;
    } catch (error) {
      this.#logger.warn("對話摘要失敗", {
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * 去重：這個雜湊已經對應到一張還存在的卡片時回它的識別碼。
   *
   * `import_items` 只記「哪次匯入寫過」，使用者刪卡不會改動那些列；卡片檔
   * 上的 `importedFrom.hash` 由寫入端快取。兩邊都可能指到不存在的卡片，所以
   * 命中時以檔案系統為準，指到已刪卡片的列一律忽略。
   */
  #duplicateCardId(hash: string): string | undefined {
    const fromStore = this.#store.writtenCardIdsForHash(hash);
    const fromCards = this.#cards.existingForHash(hash);
    for (const cardId of fromCards === undefined ? fromStore : [...fromStore, fromCards]) {
      if (this.#cards.cardExists(cardId)) return cardId;
    }
    this.#cards.forgetHash(hash);
    return undefined;
  }

  async #scanForJob(
    job: ImportJob,
    selection: readonly ImportItem[],
  ): Promise<ImportScanResult & { readonly sourcePath: string }> {
    const categories: Record<string, ImportCategory> = {};
    for (const item of selection) {
      if (item.itemKey.startsWith("skill:")) {
        const relative = skillItemPath(item.itemKey.slice("skill:".length));
        if (relative !== undefined) categories[relative] = "skill";
        continue;
      }
      if (!item.itemKey.startsWith("file:")) continue;
      const relative = fileItemPath(item.itemKey.slice("file:".length));
      if (relative !== undefined) categories[relative] = item.category;
    }
    const wantsConversations = selection.some((item) => item.category === "conversation");
    const providedPersona = this.#store.previewState(job.jobId)?.["providedPersona"];
    return this.#scan({
      kind: job.sourceKind,
      path: job.sourcePath,
      ...(Object.keys(categories).length === 0 ? {} : { categories }),
      includeConversations: wantsConversations,
      ...(isProvidedPersona(providedPersona) ? { providedPersona } : {}),
      ...(job.rangeStart === undefined || job.rangeEnd === undefined
        ? {}
        : { range: { start: job.rangeStart, end: job.rangeEnd } }),
    });
  }

  async #scan(input: {
    readonly kind: ImportSourceKind;
    readonly path?: string;
    readonly categories?: Readonly<Record<string, ImportCategory>>;
    readonly defaultCategory?: ImportCategory | "ignore";
    readonly includeConversations: boolean;
    readonly range?: ImportDateRange;
    readonly providedPersona?: { readonly title: string; readonly body: string };
  }): Promise<ImportScanResult & { readonly sourcePath: string }> {
    const adapter = this.#adapters.get(input.kind);
    if (adapter === undefined) {
      throw new ImportError("unsupported", "這個主機沒有載入這個來源的轉接器。", {
        sourceKind: input.kind,
      });
    }
    assertCategories(input.categories);
    if (
      input.defaultCategory !== undefined &&
      input.defaultCategory !== "ignore" &&
      !(IMPORT_CATEGORIES as readonly string[]).includes(input.defaultCategory)
    ) {
      throw new ImportError("invalid_message", "defaultCategory 不是合法的類別。", {
        field: "defaultCategory",
      });
    }
    const sourcePath = this.#sourcePath(input.kind, input.path);
    const options: ImportScanOptions = {
      path: sourcePath,
      ...(input.categories === undefined ? {} : { categories: input.categories }),
      ...(input.defaultCategory === undefined ? {} : { defaultCategory: input.defaultCategory }),
      includeConversations: input.includeConversations,
      ...(input.range === undefined ? {} : { range: input.range }),
      ...(input.providedPersona === undefined ? {} : { providedPersona: input.providedPersona }),
    };
    try {
      const scan = await adapter.scan(options);
      return { ...scan, sourcePath };
    } catch (error) {
      throw asImportError(error);
    }
  }

  #sourcePath(kind: ImportSourceKind, path: string | undefined): string {
    const trimmed = path?.trim() ?? "";
    if (trimmed !== "") return trimmed;
    if (kind === "hermes") return `${this.#homeDir}/.hermes`;
    if (kind === "codex") return `${this.#homeDir}/.codex`;
    if (kind === "claude-code") return `${this.#homeDir}/.claude`;
    if (kind === "alma") return `${this.#homeDir}/Library/Application Support/alma/chat_threads.db`;
    throw new ImportError("invalid_message", "通用來源要指定資料夾。", { field: "sourcePath" });
  }
}

/** 對話匯入的預估：字元數除以 4 是量級，不是帳單。 */
export function estimateConversations(
  candidates: readonly ImportConversationCandidate[],
  range: ImportDateRange,
): ImportConversationEstimate {
  let messages = 0;
  let characters = 0;
  let existingSummaries = 0;
  let modelSummaries = 0;
  let modelCharacters = 0;
  for (const candidate of candidates) {
    messages += candidate.messageCount;
    characters += candidate.characterCount;
    if (candidate.existingSummary !== undefined) {
      existingSummaries += 1;
      continue;
    }
    modelSummaries += 1;
    modelCharacters += candidate.characterCount;
  }
  return {
    candidates: candidates.length,
    messages,
    characters,
    existingSummaries,
    modelSummaries,
    estimatedModelInputTokens: Math.ceil(modelCharacters / 4),
    estimatedModelCalls: modelSummaries,
    rangeStart: range.start,
    rangeEnd: range.end,
  };
}

/** 使用者有沒有指定時間範圍；選了對話就一定要有。 */
export function rangeOf(
  required: boolean,
  start: string | undefined,
  end: string | undefined,
): ImportDateRange | undefined {
  if (start === undefined || end === undefined || start.trim() === "" || end.trim() === "") {
    if (required) throw rangeRequired();
    return undefined;
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new ImportError("invalid_message", "時間範圍不是合法的時間。", {
      reason: "invalid_range",
    });
  }
  if (startDate.getTime() > endDate.getTime()) {
    throw new ImportError("invalid_message", "時間範圍的開始晚於結束。", {
      reason: "invalid_range",
    });
  }
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

/** 逐字稿留在主機記憶體；回給呼叫端的候選不含它。 */
function withoutTranscript(candidate: ImportConversationCandidate): ImportConversationCandidate {
  const copy = { ...candidate };
  delete copy.transcript;
  return copy;
}

function isProvidedPersona(
  value: unknown,
): value is { readonly title: string; readonly body: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["title"] === "string" &&
    typeof (value as Record<string, unknown>)["body"] === "string"
  );
}

function assertCategories(categories: Readonly<Record<string, ImportCategory>> | undefined): void {
  if (categories === undefined) return;
  for (const [path, category] of Object.entries(categories)) {
    if (
      typeof category !== "string" ||
      !(IMPORT_CATEGORIES as readonly string[]).includes(category)
    ) {
      throw new ImportError("invalid_message", "categories 有未知的類別。", {
        field: "categories",
        path,
      });
    }
  }
}

function cardKindOf(category: Exclude<ImportCategory, "skill" | "conversation">) {
  switch (category) {
    case "persona":
      return "persona" as const;
    case "user":
    case "memory":
      return "memory" as const;
    case "rule":
      return "note" as const;
  }
}

function sortByCategory(items: readonly ImportPreviewItem[]): ImportPreviewItem[] {
  const order = new Map(IMPORT_CATEGORY_ORDER.map((category, index) => [category, index]));
  return [...items].sort((left, right) => {
    const byCategory = (order.get(left.category) ?? 0) - (order.get(right.category) ?? 0);
    return byCategory !== 0 ? byCategory : left.key.localeCompare(right.key);
  });
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))];
}

function firstLine(text: string): string | undefined {
  const line = text
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line === undefined ? undefined : [...line].slice(0, 200).join("");
}

/** 來源的錯誤都轉成協定看得懂的碼；不把來源內容放進訊息。 */
export function asImportError(error: unknown): ImportError {
  if (error instanceof ImportError) return error;
  if (error instanceof SourceAccessError) {
    return new ImportError("not_found", "讀不到來源。", { path: error.path });
  }
  return new ImportError("internal", "匯入失敗。");
}

export { IMPORT_SOURCE_KINDS };
