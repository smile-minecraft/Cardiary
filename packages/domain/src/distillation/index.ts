/**
 * 每日蒸餾的領域核心：挑選、提煉驗證、合併／取代、續跑去重、核心記憶組
 * 與逐項復原。
 *
 * 這一層不碰資料庫、不讀寫卡片檔、不會呼叫真的模型；時間、批次 id、
 * 輸出卡 id 與模型都由呼叫端注入，測試才能決定性地重現各種情況。
 * 資料表（v3 遷移）、通知流、掛鉤排程與真的模型介接由主機模組處理。
 */

export {
  DISTILLATION_EXCLUDED_KINDS,
  selectDistillationCandidates,
  type DistillationCandidateCard,
} from "./selection.js";
export {
  DISTILLATION_MEMORY_TYPES,
  MEMORY_TEXT_MAX_LENGTH,
  MEMORY_TITLE_MAX_LENGTH,
  memoryCardTitleAndSummary,
  memoryContentHash,
  normalizeMemoryText,
  validateDistillationOutput,
  type DistillationMemoryType,
  type DistillationSourceCard,
  type ExtractedMemoryItem,
  type ExtractValidation,
  type MemoryDistiller,
} from "./extract.js";
export {
  comparisonCandidates,
  judgeMemoryItem,
  type MemoryJudge,
  type MemoryMatchCandidate,
  type MemoryMergeVerdict,
} from "./merge.js";
export { planMemoryCardDraft, type MemoryCardDraft } from "./plan.js";
export {
  buildResumeKey,
  extractItemKey,
  findBatchUnit,
  findCrossBatchMatch,
  mergeItemKey,
  planResume,
  resumeIntentDecision,
  shouldSkipUnit,
  type DistillationItemRecord,
  type ResumeIntentDecision,
  type ResumeItemStatus,
  type ResumePhase,
  type ResumePlan,
} from "./resume.js";
export {
  CORE_TOKEN_BUDGET_DEFAULT,
  CORE_TOKEN_BUDGET_MAX,
  CORE_TOKEN_BUDGET_MIN,
  clampCoreTokenBudget,
  coreChangeAllowed,
  coreDayKey,
  estimateCoreMemoryTokens,
  planCoreChange,
  sortCoreMemory,
  type CoreCardTokens,
  type CoreChangeDecision,
  type CoreChangeRequest,
  type CoreMemoryDaily,
  type CoreMemoryEntry,
} from "./core-memory.js";
export {
  RECOVERY_KIND_BY_ACTION,
  assertWellFormedItem,
  buildDistillationSummary,
  planUndoItem,
  recoveryKindFor,
  type DistillationRecoveryKind,
  type DistillationSummary,
  type DistillationSummaryAction,
  type DistillationSummaryItem,
  type UndoPlan,
  type UndoStep,
} from "./recovery.js";
