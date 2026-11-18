import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EngineLogger } from "@cardiary/engine-adapter";
import type { JSONObject } from "@cardiary/protocol";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlChannel } from "../../src/control/channel.js";
import { startHost, UnavailableCredentials, type RunningHost } from "../../src/bootstrap.js";
import { REMOTE_ACCESS_SETTING_KEY } from "../../src/gateway/remote-access.js";
import { HOST_SERVICE_NAMES, type CardEnvironment } from "../../src/modules/contract.js";
import { registerRemoteControlRoutes } from "../../src/remote/control.js";
import { TestClient, waitUntil } from "../helpers.js";

/**
 * 裝置 Token 的持久化：產品組裝的狀態資料庫從 v3 就有 `device_tokens`。
 *
 * 這一組用真正的 Pi 組裝開資料夾（引擎有開啟但沒有回合），驗證重啟後
 * 舊 Token 仍然有效、撤銷仍然有效，以及資料庫和日誌都沒有明文。
 */

interface Booted {
  readonly host: RunningHost;
  readonly url: string;
  stop(): Promise<void>;
}

const hosts: Booted[] = [];

afterEach(async () => {
  while (hosts.length > 0) {
    await hosts.pop()?.stop();
  }
});

async function makeFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-token-store-"));
  const path = join(root, "Cardiary");
  await mkdir(path, { recursive: true });
  return path;
}

function collectingLogger(lines: string[]): EngineLogger {
  const write = (level: string, message: string, fields?: unknown): void => {
    lines.push(`${level} ${message} ${fields === undefined ? "" : JSON.stringify(fields)}`);
  };
  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

async function boot(folderPath: string, initializeFolder: boolean): Promise<Booted> {
  const lines: string[] = [];
  const host = await startHost({
    folderPath,
    clientToken: "Z".repeat(43),
    demo: true,
    assembly: "pi",
    initializeFolder,
    credentials: new UnavailableCredentials(),
    logger: collectingLogger(lines),
  });
  // 這一組驗證 Token 持久化；遠端開關本身由 access.test.ts 驗證。
  host.hostServices.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage).settings.set({
    key: REMOTE_ACCESS_SETTING_KEY,
    value: "true",
    level: "human-only",
    updatedBy: "test",
  });
  const booted: Booted = {
    host,
    url: `ws://127.0.0.1:${host.port}/v1/ws`,
    stop: async () => {
      await host.service.shutdown("test").catch(() => undefined);
      expect(lines.join("\n")).not.toMatch(/cdt_[A-Za-z0-9_-]{43}/);
    },
  };
  hosts.push(booted);
  return booted;
}

/** 模擬殼的控制通道：直接呼叫註冊的路由，權限永遠是 shell-control。 */
function fakeControl(host: RunningHost) {
  const handlers = new Map<string, (payload: JSONObject) => Promise<JSONObject>>();
  const channel = {
    onRequest: (route: string, handler: (payload: JSONObject) => Promise<JSONObject>) => {
      handlers.set(route, handler);
    },
  } as unknown as ControlChannel;
  registerRemoteControlRoutes(channel, host.gateway.remote, {
    closeDeviceConnections: (deviceId) => host.gateway.closeDeviceConnections(deviceId),
  });
  return {
    approve: (pairingRequestId: string) =>
      handlers.get("control.pairing.approve")!({ pairingRequestId } as JSONObject),
    list: () => handlers.get("control.devices.list")!({} as JSONObject),
    revoke: (deviceId: string) =>
      handlers.get("control.devices.revoke")!({ deviceId } as JSONObject),
  };
}

async function pairDevice(
  booted: Booted,
  kind: "web" | "ios" = "ios",
): Promise<{ deviceId: string; deviceToken: string }> {
  const control = fakeControl(booted.host);
  const device = await TestClient.connect(booted.url);
  const beginId = device.request("pairing.begin", { deviceName: "持久化手機", kind });
  const begin = (await device.waitForReply(beginId)).payload as { pairingRequestId: string };
  await control.approve(begin.pairingRequestId);
  const completeId = device.request("pairing.complete", {
    pairingRequestId: begin.pairingRequestId,
  });
  const complete = (await device.waitForReply(completeId)).payload as {
    deviceId: string;
    deviceToken: string;
  };
  await waitUntil(() => device.closed, 3000);
  await device.close();
  return complete;
}

async function devices(booted: Booted): Promise<Record<string, unknown>[]> {
  const list = await fakeControl(booted.host).list();
  return (list as unknown as { devices: Record<string, unknown>[] }).devices;
}

async function stateFiles(folderPath: string): Promise<Buffer[]> {
  const directory = join(folderPath, "state");
  const files: Buffer[] = [];
  for (const name of ["cardiary.sqlite", "cardiary.sqlite-wal", "cardiary.sqlite-shm"]) {
    const file = join(directory, name);
    if (existsSync(file)) files.push(await readFile(file));
  }
  return files;
}

describe("遠端裝置 Token 持久化", () => {
  it("配對後重啟：舊 Token 仍可 hello，清單仍有一台，資料庫與日誌沒有明文", async () => {
    const folder = await makeFolder();
    const first = await boot(folder, true);
    const paired = await pairDevice(first);

    const before = await devices(first);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      deviceId: paired.deviceId,
      deviceKind: "ios",
      deviceName: "持久化手機",
    });
    expect(before[0]?.prefix).toMatch(/^cdt_[A-Za-z0-9_-]{8}$/);
    await first.stop();

    // 資料庫只有雜湊與顯示前綴，沒有 Token 明文；雜湊是正向對照。
    const files = await stateFiles(folder);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.includes(paired.deviceToken))).toBe(false);
    const hash = createHash("sha256").update(paired.deviceToken).digest("hex");
    expect(files.some((file) => file.includes(hash))).toBe(true);

    const second = await boot(folder, false);
    const after = await devices(second);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      deviceId: paired.deviceId,
      deviceName: "持久化手機",
      fingerprint: before[0]?.fingerprint,
      prefix: before[0]?.prefix,
    });
    // `device_tokens` 沒有種類欄位：重啟後種類未知，但仍是字串、其他欄位都在。
    expect(after[0]?.deviceKind).toBe("unknown");

    const client = await TestClient.connect(second.url);
    const helloId = await client.hello(paired.deviceToken);
    const hello = await client.waitForReply(helloId);
    expect(hello.kind).toBe("response");
    expect(hello.type).toBe("system.hello");

    // Token 不只用來握手：重啟後的一般請求也要能用。
    const listId = client.request("session.list", {});
    const listed = await client.waitForReply(listId);
    expect(listed.kind).toBe("response");
    expect(listed.type).toBe("session.list");
    expect(Array.isArray((listed.payload as { sessions?: unknown }).sessions)).toBe(true);
    await client.close();
    await second.stop();
  });

  it("撤銷後重啟：舊 Token 仍被拒，清單保留撤銷時間", async () => {
    const folder = await makeFolder();
    const first = await boot(folder, true);
    const paired = await pairDevice(first);

    const client = await TestClient.connect(first.url);
    const helloId = await client.hello(paired.deviceToken);
    await client.waitForReply(helloId);

    const revoked = await fakeControl(first.host).revoke(paired.deviceId);
    expect(revoked).toMatchObject({ revoked: true, closedConnections: 1 });
    await waitUntil(() => client.closed, 3000);
    expect(client.closeCode).toBe(1008);
    await first.stop();

    const second = await boot(folder, false);
    const after = await devices(second);
    expect(after).toHaveLength(1);
    expect(after[0]?.deviceId).toBe(paired.deviceId);
    expect(typeof after[0]?.revokedAt).toBe("string");

    const again = await TestClient.connect(second.url);
    await again.hello(paired.deviceToken);
    const rejected = await again.waitFor(
      (frame) => frame.kind === "error" && frame.code === "auth_invalid",
    );
    expect(rejected.code).toBe("auth_invalid");
    await again.close();
    await second.stop();
  });
});
