import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CardiaryPaths } from "@cardiary/module-api";

import { loadClaudeToken, saveClaudeToken } from "./credentials.js";

const FILE_NAME = "external-agent-credentials.json";
const VALID_TOKEN = "sk-ant-1234567890abcdefghijklmnopqrst";

let root: string;
let paths: CardiaryPaths;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cardiary-credentials-"));
  paths = {
    root,
    cards: join(root, "cards"),
    assets: join(root, "assets"),
    boards: join(root, "boards"),
    skills: join(root, "skills"),
    state: join(root, "state"),
    modules: join(root, "modules"),
    cache: join(root, "cache"),
    tmp: join(root, "tmp"),
    logs: join(root, "logs"),
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRaw(content: string): Promise<void> {
  await mkdir(paths.state, { recursive: true });
  await writeFile(join(paths.state, FILE_NAME), content, "utf8");
}

describe("外部代理憑證檔", () => {
  it("存檔後讀回相同權杖，檔案格式與權限正確", async () => {
    await saveClaudeToken(paths, VALID_TOKEN);

    expect(await loadClaudeToken(paths)).toBe(VALID_TOKEN);
    const info = await stat(join(paths.state, FILE_NAME));
    expect(info.mode & 0o777).toBe(0o600);
    const raw = JSON.parse(await readFile(join(paths.state, FILE_NAME), "utf8")) as {
      version: number;
      claudeCode: { token: string; updatedAt: string };
    };
    expect(raw.version).toBe(1);
    expect(raw.claudeCode.token).toBe(VALID_TOKEN);
    expect(Number.isNaN(Date.parse(raw.claudeCode.updatedAt))).toBe(false);
  });

  it("檔案不存在回 null", async () => {
    expect(await loadClaudeToken(paths)).toBeNull();
  });

  it("JSON 不合法回 null", async () => {
    await writeRaw("{not json");
    expect(await loadClaudeToken(paths)).toBeNull();
  });

  it("version 不是 1 回 null", async () => {
    await writeRaw(
      JSON.stringify({
        version: 2,
        claudeCode: { token: VALID_TOKEN, updatedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    expect(await loadClaudeToken(paths)).toBeNull();
  });

  it("token 格式不正確回 null", async () => {
    await writeRaw(
      JSON.stringify({
        version: 1,
        claudeCode: { token: "bad-token", updatedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    expect(await loadClaudeToken(paths)).toBeNull();
  });

  it("存檔時拒絕格式不正確的權杖", async () => {
    await expect(saveClaudeToken(paths, "bad-token")).rejects.toThrow("Claude Code 權杖格式不正確");
  });
});
