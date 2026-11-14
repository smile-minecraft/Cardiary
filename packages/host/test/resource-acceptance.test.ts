import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { startHost, UnavailableCredentials, type RunningHost } from "../src/bootstrap.js";

/**
 * 第 13 章資源管理的端到端驗證：接上真正的持久化儲存與 Pi Durable 轉接層。
 *
 * 這一組測試只碰系統層（暫存區、資料夾邊界、快取、資料夾不可用），
 * 不需要模型；引擎有開啟，但沒有回合。
 */
const hosts: RunningHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.service.abort("test").catch(() => undefined);
  }
});

async function makeFolder(): Promise<{ readonly root: string; readonly path: string }> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-acceptance-"));
  const path = join(root, "Cardiary");
  await mkdir(path, { recursive: true });
  return { root, path };
}

async function boot(folderPath: string): Promise<RunningHost> {
  const host = await startHost({
    folderPath,
    clientToken: "Z".repeat(43),
    demo: true,
    assembly: "pi",
    initializeFolder: true,
    credentials: new UnavailableCredentials(),
  });
  hosts.push(host);
  return host;
}

async function listTree(path: string): Promise<string[]> {
  const entries: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    const dirents = await readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      const relative = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
      entries.push(relative);
      if (dirent.isDirectory()) {
        await walk(join(current, dirent.name), relative);
      }
    }
  };
  await walk(path, "");
  return entries.sort();
}

describe("資源管理的端到端驗收", () => {
  it("暫存區為空：啟動清掉殘留，執行後 tmp 裡沒有暫存檔", async () => {
    const { path } = await makeFolder();
    const first = await boot(path);
    await first.service.shutdown("test");
    hosts.splice(hosts.indexOf(first), 1);

    await writeFile(join(path, "tmp", "leftover.tmp"), "殘留");
    const second = await boot(path);
    const tmpEntries = await readdir(join(path, "tmp"));
    expect(tmpEntries).not.toContain("leftover.tmp");
    await second.service.shutdown("test");
    hosts.splice(hosts.indexOf(second), 1);
    expect(await readdir(join(path, "tmp"))).toEqual([]);
  });

  it("資料夾以外新增檔案數為零", async () => {
    const { root, path } = await makeFolder();
    const before = await listTree(root);
    const host = await boot(path);
    // 建立對話與一則系統狀態，讓事件與三個資料庫真的寫入。
    const created = await host.engine.createConversation({
      title: "邊界測試",
      model: { provider: "faux", model: "faux-1" },
      systemContext: "驗證資料夾邊界",
      toolBundles: [],
    });
    expect(created.id.length).toBeGreaterThan(0);
    await host.gateway.emitSystemStatus();
    const during = await listTree(root);
    const added = during.filter((entry) => !before.includes(entry));
    const outside = added.filter((entry) => entry !== "Cardiary" && !entry.startsWith("Cardiary/"));
    expect(outside).toEqual([]);
    await host.service.shutdown("test");
    hosts.splice(hosts.indexOf(host), 1);
  });

  it("刪掉快取資料庫後重開會重建，服務回到可用", async () => {
    const { path } = await makeFolder();
    const first = await boot(path);
    await first.service.shutdown("test");
    hosts.splice(hosts.indexOf(first), 1);

    const cachePath = join(path, "cache", "index.sqlite");
    await rm(cachePath, { force: true });
    await expect(stat(cachePath)).rejects.toMatchObject({ code: "ENOENT" });

    const second = await boot(path);
    expect((await stat(cachePath)).size).toBeGreaterThan(0);
    expect(second.service.health().state).toBe("running");
    await second.service.shutdown("test");
    hosts.splice(hosts.indexOf(second), 1);
  });

  it("資料夾不見時不啟動，也不在原路徑留下任何東西", async () => {
    const { root, path } = await makeFolder();
    const moved = join(root, "moved-away");
    await rename(path, moved);
    await expect(boot(path)).rejects.toMatchObject({ code: "folder-unavailable" });
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
