/**
 * 統一 diff（unified）的套用與整段取代。
 *
 * 套用前比對 baseRevision 由呼叫端負責；這裡只負責「把 diff 套到內文上」。
 * 任何一步對不上就丟 CardPatchError，不猜測、不部分套用。
 */

export interface CardPatchErrorDetails {
  readonly reason: "patch_failed";
  readonly message: string;
}

/** 補丁套用失敗；呼叫端轉成 invalid_message + details.reason = patch_failed。 */
export class CardPatchError extends Error {
  readonly reason = "patch_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "CardPatchError";
  }
}

export interface PatchText {
  readonly format: "unified" | "replace";
  readonly text: string;
}

export function applyPatch(body: string, patch: PatchText): string {
  if (patch.format === "replace") {
    if (patch.text.length === 0) {
      throw new CardPatchError("取代的內文是空的");
    }
    return patch.text;
  }
  return applyUnifiedDiff(body, patch.text);
}

interface HunkLine {
  readonly kind: "context" | "removed" | "added";
  readonly text: string;
}

interface Hunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: HunkLine[];
}

export function applyUnifiedDiff(body: string, diff: string): string {
  const hunks = parseUnifiedDiff(diff);
  const sourceLines = body.split("\n");
  const result: string[] = [];
  let cursor = 0; // sourceLines 的索引
  for (const hunk of hunks) {
    // 找到 hunk 在原文中的位置；允許最多往下 2 行的位移（標準 unified 容差）。
    const target = hunk.oldStart === 0 && hunk.oldCount === 0 ? 0 : hunk.oldStart - 1;
    let offset = target - cursor;
    if (offset < 0) {
      throw new CardPatchError("補丁的行號倒退");
    }
    if (offset > 0) {
      const relocated = relocate(sourceLines, cursor, hunk, offset);
      if (relocated === null) {
        throw new CardPatchError(`補丁的上下文對不上第 ${hunk.oldStart} 行附近`);
      }
      offset = relocated;
    }
    for (let index = cursor; index < cursor + offset; index += 1) {
      result.push(sourceLines[index] as string);
    }
    cursor += offset;
    for (const line of hunk.lines) {
      if (line.kind === "added") {
        result.push(line.text);
        continue;
      }
      const actual = sourceLines[cursor];
      if (actual === undefined || actual !== line.text) {
        throw new CardPatchError(`補丁的上下文對不上：預期「${line.text}」`);
      }
      if (line.kind === "context") {
        result.push(actual);
      }
      cursor += 1;
    }
  }
  for (let index = cursor; index < sourceLines.length; index += 1) {
    result.push(sourceLines[index] as string);
  }
  // body.split("\n") 的第一個與最後一個元素帶著首尾換行的邊界；
  // join("\n") 還原的是「以 \n 切開再接回去」的原樣字串。
  return result.join("\n");
}

/** 在原文中找 hunk 的實際位置；只往下找，最多 FUZZ 行。 */
const FUZZ = 2;

function relocate(
  sourceLines: readonly string[],
  cursor: number,
  hunk: Hunk,
  offset: number,
): number | null {
  for (let extra = 0; extra <= FUZZ; extra += 1) {
    const candidate = offset + extra;
    if (hunkMatchesAt(sourceLines, cursor + candidate, hunk)) {
      return candidate;
    }
  }
  if (offset === 0) {
    return 0;
  }
  return null;
}

function hunkMatchesAt(sourceLines: readonly string[], position: number, hunk: Hunk): boolean {
  let index = position;
  for (const line of hunk.lines) {
    if (line.kind === "added") continue;
    if (sourceLines[index] !== line.text) return false;
    index += 1;
  }
  return true;
}

function parseUnifiedDiff(diff: string): Hunk[] {
  const lines = diff.split("\n");
  // 檔案以換行結尾時 split 會多一個空字串；最後一行是真正的上下文時
  // diff 會以空格前綴表示，所以這裡只丟掉結尾多出的一個空字串。
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const hunks: Hunk[] = [];
  let current: { header: [number, number, number, number]; lines: HunkLine[] } | null = null;
  let sawAnyHunk = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.startsWith("@@")) {
      const header = parseHunkHeader(line);
      if (header === null) {
        throw new CardPatchError(`補丁的 hunk 標頭不合法：${line}`);
      }
      if (current !== null) {
        hunks.push(toHunk(current));
      }
      current = { header, lines: [] };
      sawAnyHunk = true;
      continue;
    }
    if (current === null) {
      // --- +++ diff --git index ... 這些標頭行略過；其他內容不允許。
      if (
        line.startsWith("---") ||
        line.startsWith("+++") ||
        line.startsWith("diff ") ||
        line.startsWith("index ") ||
        line.startsWith("new file") ||
        line.startsWith("deleted file") ||
        line.startsWith("old mode") ||
        line.startsWith("new mode") ||
        line.trim().length === 0
      ) {
        continue;
      }
      if (line.startsWith("\\")) continue;
      throw new CardPatchError(`補丁在 hunk 之前有無法辨識的行：${line}`);
    }
    if (line.startsWith("\\")) {
      // "\ No newline at end of file"：目前不改變行尾語意，略過。
      continue;
    }
    const marker = line.charAt(0);
    const text = line.slice(1);
    if (marker === " " || line.length === 0) {
      current.lines.push({ kind: "context", text: line.length === 0 ? "" : text });
      continue;
    }
    if (marker === "-") {
      current.lines.push({ kind: "removed", text });
      continue;
    }
    if (marker === "+") {
      current.lines.push({ kind: "added", text });
      continue;
    }
    throw new CardPatchError(`補丁有無法辨識的行：${line}`);
  }
  if (current !== null) {
    hunks.push(toHunk(current));
  }
  if (!sawAnyHunk) {
    throw new CardPatchError("補丁沒有 hunk");
  }
  for (const hunk of hunks) {
    const oldLines = hunk.lines.filter((line) => line.kind !== "added").length;
    const newLines = hunk.lines.filter((line) => line.kind !== "removed").length;
    if (oldLines !== hunk.oldCount) {
      throw new CardPatchError("補丁的 hunk 行數與標頭不符");
    }
    if (newLines !== hunk.newCount) {
      throw new CardPatchError("補丁的 hunk 行數與標頭不符");
    }
  }
  return hunks;
}

function parseHunkHeader(line: string): [number, number, number, number] | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return null;
  const oldStart = Number(match[1]);
  const oldCount = match[2] === undefined ? 1 : Number(match[2]);
  const newStart = Number(match[3]);
  const newCount = match[4] === undefined ? 1 : Number(match[4]);
  if (![oldStart, oldCount, newStart, newCount].every(Number.isFinite)) {
    return null;
  }
  return [oldStart, oldCount, newStart, newCount];
}

function toHunk(current: { header: [number, number, number, number]; lines: HunkLine[] }): Hunk {
  const [oldStart, oldCount, newStart, newCount] = current.header;
  return { oldStart, oldCount, newStart, newCount, lines: current.lines };
}
