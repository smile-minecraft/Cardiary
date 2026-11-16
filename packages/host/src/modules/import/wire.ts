import type { JsonValue } from "@cardiary/engine-adapter";

import type { GenericListing } from "./sources/generic.js";
import type { ImportPreview, ImportWriteReport } from "./types.js";

/**
 * 主機內部格式轉成協定 payload。
 *
 * 兩件事只能在這裡發生：對話候選的 `transcript` 不進協定（逐字稿留在
 * 主機記憶體），以及一般卡片內容照原樣帶出去（預覽要看得到將建立的卡）。
 */
export function wireListing(listing: GenericListing): JsonValue {
  return {
    files: listing.files.map((file) => ({
      relativePath: file.relativePath,
      name: file.name,
      sizeBytes: file.sizeBytes,
      ...(file.modifiedAt === undefined ? {} : { modifiedAt: file.modifiedAt }),
      supported: file.supported,
    })),
    truncated: listing.truncated,
  } as unknown as JsonValue;
}

export function wirePreview(preview: ImportPreview): JsonValue {
  return {
    jobId: preview.jobId,
    source: preview.source,
    items: preview.items.map((item) => ({
      key: item.key,
      category: item.category,
      title: item.title,
      body: item.body,
      ...(item.summary === undefined ? {} : { summary: item.summary }),
      tags: item.tags,
      ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }),
      contentHash: item.contentHash,
      source: item.source,
      ...(item.key.startsWith("codex:project:") || item.key.startsWith("claude-code:project:")
        ? { origin: "project" }
        : {}),
      ...(item.importance === undefined ? {} : { importance: item.importance }),
      ...(item.duplicateCardId === undefined ? {} : { duplicateCardId: item.duplicateCardId }),
    })),
    skills: preview.skills.map((skill) => ({
      key: skill.key,
      name: skill.name,
      description: skill.description,
      slug: skill.slug,
      contentHash: skill.contentHash,
      source: skill.source,
      attachmentsNotCopied: skill.attachmentsNotCopied,
      ...(skill.existingSkillPath === undefined
        ? {}
        : { existingSkillPath: skill.existingSkillPath }),
    })),
    conversations: preview.conversations.map((conversation) => ({
      key: conversation.key,
      title: conversation.title,
      createdAt: conversation.createdAt,
      ...(conversation.updatedAt === undefined ? {} : { updatedAt: conversation.updatedAt }),
      messageCount: conversation.messageCount,
      characterCount: conversation.characterCount,
      ...(conversation.existingSummary === undefined
        ? {}
        : { existingSummary: conversation.existingSummary }),
      contentHash: conversation.contentHash,
      source: conversation.source,
      ...(conversation.unverified === true ? { unverified: true } : {}),
    })),
    skipped: preview.skipped,
    notes: preview.notes,
    warnings: preview.warnings,
    ...(preview.conversationEstimate === undefined
      ? {}
      : { conversationEstimate: preview.conversationEstimate }),
    newCards: preview.newCards,
    duplicates: preview.duplicates,
  } as unknown as JsonValue;
}

export function wireReport(report: ImportWriteReport): JsonValue {
  return report as unknown as JsonValue;
}
