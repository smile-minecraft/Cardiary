/**
 * 外部代理的憑證讀寫。
 *
 * 版位：`state/external-agent-credentials.json` 是正本，屬敏感資料，0600，
 * 由橋接層（主機服務）負責；代理行程被 filesystem 規則擋住，不能讀寫。
 * 這裡只碰 Claude Code 的登入權杖，不接 Keychain、broker 或 env fallback。
 */
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CardiaryPaths } from "@cardiary/module-api";

const FILE_NAME = "external-agent-credentials.json";
const TEMP_FILE_NAME = ".external-agent-credentials.tmp";
const TOKEN_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

interface CredentialFile {
  readonly version: number;
  readonly claudeCode: { readonly token: unknown; readonly updatedAt: unknown };
}

function credentialPath(paths: CardiaryPaths): string {
  return join(paths.state, FILE_NAME);
}

/**
 * 讀出 Claude Code 的登入權杖；檔案不存在或內容無效回 null。
 *
 * 只在記憶體裡處理內容，不 logging，避免權杖進日誌。
 */
export async function loadClaudeToken(paths: CardiaryPaths): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(credentialPath(paths), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let parsed: CredentialFile;
  try {
    parsed = JSON.parse(raw) as CredentialFile;
  } catch {
    return null;
  }
  if (parsed?.version !== 1) return null;
  const token = parsed.claudeCode?.token;
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  return token;
}

/** 驗證格式後原子寫入權杖；暫存檔與正本同目錄、0600。 */
export async function saveClaudeToken(paths: CardiaryPaths, token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Claude Code 權杖格式不正確");

  await mkdir(paths.state, { recursive: true });
  const tempPath = join(paths.state, TEMP_FILE_NAME);
  const finalPath = credentialPath(paths);
  const content = JSON.stringify({
    version: 1,
    claudeCode: { token, updatedAt: new Date().toISOString() },
  });

  try {
    await writeFile(tempPath, content, { mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, finalPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
  await chmod(finalPath, 0o600);
}
