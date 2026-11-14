import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { startHost, UnavailableCredentials, type RunningHost } from "../src/bootstrap.js";

const run = promisify(execFile);

/**
 * 可卸載磁碟的端到端驗證：真的建一個 APFS 磁碟映像、掛載、暫停、卸載、
 * 再接回。
 *
 * 會碰到系統的磁碟掛載，預設不跑；用 `CARDIARY_HDIUTIL_TESTS=1` 開啟。
 * CI 沒有這個權限，這一項在本機執行並把觀察結果寫進
 * `docs/acceptance/chapter-13.md`。
 */
const enabled = process.env.CARDIARY_HDIUTIL_TESTS === "1";
const hosts: RunningHost[] = [];
let mounted: string | null = null;
let imageDirectory: string | null = null;

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.service.abort("test").catch(() => undefined);
  }
  if (mounted !== null) {
    await run("hdiutil", ["detach", mounted, "-force"]).catch(() => undefined);
    mounted = null;
  }
  if (imageDirectory !== null) {
    await rm(imageDirectory, { recursive: true, force: true });
    imageDirectory = null;
  }
});

async function createImage(
  label: string,
): Promise<{ readonly mount: string; readonly folder: string }> {
  imageDirectory = await mkdtemp(join(tmpdir(), "cardiary-disk-"));
  const image = join(imageDirectory, `${label}.sparseimage`);
  await run("hdiutil", [
    "create",
    "-size",
    "40m",
    "-fs",
    "APFS",
    "-volname",
    "CardiaryTest",
    "-type",
    "SPARSE",
    image,
  ]);
  const attached = await run("hdiutil", ["attach", "-nobrowse", "-plist", image]);
  const mount = (attached.stdout.match(/<string>\/Volumes\/[^<]+<\/string>/g) ?? [])
    .map((entry) => entry.replace(/<\/?string>/g, ""))
    .find((entry) => entry.startsWith("/Volumes/"));
  if (mount === undefined) throw new Error(`找不到掛載點：${attached.stdout}`);
  mounted = mount;
  const folder = join(mount, "Cardiary");
  await mkdir(folder, { recursive: true });
  return { mount, folder };
}

async function boot(folderPath: string): Promise<RunningHost> {
  const host = await startHost({
    folderPath,
    clientToken: "Q".repeat(43),
    demo: true,
    assembly: "pi",
    initializeFolder: true,
    credentials: new UnavailableCredentials(),
  });
  hosts.push(host);
  return host;
}

describe.skipIf(!enabled)("可卸載磁碟", () => {
  it("正常卸載再接回：暫停期間 epoch 不變，資料庫關閉後才卸載", async () => {
    const { mount, folder } = await createImage("normal");
    const host = await boot(folder);
    const epoch = host.epoch;
    expect(await host.storage.runtime.current()).not.toBeNull();

    const paused = await host.service.pause("unmount", 5000);
    expect(paused.state).toBe("paused");
    expect(paused.databasesClosed).toBe(true);

    // 只卸載檔案系統（不移除整個磁碟）；卸不掉時把佔用的行程印出來。
    try {
      await run("diskutil", ["unmount", mount]);
    } catch (error) {
      const holders = await run("lsof", ["+D", mount]).catch(() => ({ stdout: "" }));
      throw new Error(`卸載失敗；佔用的檔案：\n${holders.stdout}`, { cause: error });
    }
    mounted = null;

    const unavailable = await host.service.resume();
    expect(unavailable.state).toBe("paused");
    expect(unavailable.reason).toBe("storage_unavailable");

    const attached = await run("hdiutil", [
      "attach",
      "-nobrowse",
      "-plist",
      join(imageDirectory!, "normal.sparseimage"),
    ]);
    const remounted = (attached.stdout.match(/<string>\/Volumes\/[^<]+<\/string>/g) ?? [])
      .map((entry) => entry.replace(/<\/?string>/g, ""))
      .find((entry) => entry.startsWith("/Volumes/"));
    expect(remounted).toBeDefined();
    mounted = remounted ?? null;

    const resumed = await host.service.resume();
    expect(resumed.state).toBe("ready");
    expect(resumed.epoch).toBe(epoch);
    expect(resumed.engineReopened).toBe(true);
    await host.service.shutdown("test");
    hosts.splice(hosts.indexOf(host), 1);
  }, 120_000);

  it("強制卸載：重開換 epoch，不在 /Volumes 留下空資料夾", async () => {
    const { mount, folder } = await createImage("forced");
    const before = await readdir("/Volumes");
    // 強制卸載會讓同一個行程的檔案句柄失效；服務跑在子行程裡，測試 runner
    // 才不會跟著受影響。
    const child = spawnHostProcess(folder, true);
    const firstEpoch = await child.ready;
    expect(firstEpoch.length).toBeGreaterThan(0);

    await run("hdiutil", ["detach", mount, "-force"]);
    mounted = null;
    // 強制卸載不一定當場送 SIGBUS（要看行程有沒有碰到已卸載的頁面）；
    // 這裡驗的是「下次啟動換 epoch」與「不留空資料夾」，SIGBUS 本身列手動。
    child.stop();
    await child.exited;

    const after = await readdir("/Volumes");
    expect(after.filter((entry) => !before.includes(entry))).toEqual([]);

    const attached = await run("hdiutil", [
      "attach",
      "-nobrowse",
      "-plist",
      join(imageDirectory!, "forced.sparseimage"),
    ]);
    const remounted = (attached.stdout.match(/<string>\/Volumes\/[^<]+<\/string>/g) ?? [])
      .map((entry) => entry.replace(/<\/?string>/g, ""))
      .find((entry) => entry.startsWith("/Volumes/"));
    expect(remounted).toBeDefined();
    mounted = remounted ?? null;

    const again = spawnHostProcess(join(remounted!, "Cardiary"), false);
    const secondEpoch = await again.ready;
    expect(secondEpoch).not.toBe(firstEpoch);
    again.stop();
    await again.exited;
  }, 120_000);
});

/** 用子行程跑主機服務；`ready` 回 epoch，結束時回退出碼與訊號。 */
function spawnHostProcess(
  folder: string,
  initialize: boolean,
): {
  readonly ready: Promise<string>;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  stop(): void;
} {
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(here, "../dist/main.js");
  const args = [entry, "--engine", "pi", "--demo", "--folder", folder];
  if (initialize) args.push("--initialize-folder");
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      TMPDIR: join(folder, "tmp"),
      TMP: join(folder, "tmp"),
      TEMP: join(folder, "tmp"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let resolveReady: (epoch: string) => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<string>((resolvePromise, reject) => {
    resolveReady = resolvePromise;
    rejectReady = reject;
  });
  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    try {
      const frame = JSON.parse(line) as { type?: string; epoch?: string };
      if (frame.type === "ready" && frame.epoch !== undefined) resolveReady(frame.epoch);
    } catch {
      // 非 JSON 只會出現在 stdout 守門失效時；交給下面的逾時處理。
    }
  });
  child.once("error", (error) => rejectReady(error));
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const timer = setTimeout(() => rejectReady(new Error("等不到 ready")), 30_000);
  timer.unref?.();
  return {
    ready,
    exited,
    stop() {
      clearTimeout(timer);
      child.kill("SIGTERM");
    },
  };
}
