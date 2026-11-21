import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startTestHost, TestClient, type TestHost } from "../helpers.js";

/**
 * 規格第 11 章「M5 權限模式裁決」：全部允許只由人開啟，緊急全部暫停優先。
 *
 * 暫停之後，先前開的全部允許必須已經失效，代理不能在人按下暫停後
 * 繼續靠它自動放行；撤銷要寫回正本，重啟後也不會復活。
 */

const hosts: TestHost[] = [];

afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()?.close();
});

describe("全部允許沒有期限", () => {
  it("主機重啟後仍然開著，直到撤銷", async () => {
    const first = await startTestHost();
    hosts.push(first);
    first.host.agentPermissions.grantAllowAll({
      tools: ["write_file"],
      paths: [first.folder.path],
    });

    await first.close();
    hosts.pop();
    const second = await startTestHost({ folder: first.folder });
    hosts.push(second);
    expect(second.host.agentPermissions.allowAll()).toMatchObject({ tools: ["write_file"] });

    const client = await TestClient.connect(second.url);
    await client.waitForReply(await client.hello(second.token));
    const reply = await client.waitForReply(
      client.request("system.permissions.revoke_allow_all", { clientRequestId: "revoke-1" }),
    );
    expect(reply.kind, JSON.stringify(reply)).toBe("response");
    await client.close();
    expect(second.host.agentPermissions.allowAll()).toBeNull();
  });
});

describe("緊急全部暫停優先於全部允許", () => {
  it("暫停後全部允許失效，正本清空，重啟後仍是關閉", async () => {
    const first = await startTestHost();
    hosts.push(first);
    first.host.agentPermissions.grantAllowAll({
      tools: ["write_file"],
      paths: [first.folder.path],
    });
    expect(first.host.agentPermissions.allowAll()).not.toBeNull();

    const client = await TestClient.connect(first.url);
    await client.waitForReply(await client.hello(first.token));
    const pauseId = client.request("approval.pause_all", { reason: "契約測試：緊急暫停" });
    const reply = await client.waitForReply(pauseId, 10_000);
    expect(reply.kind, JSON.stringify(reply)).toBe("response");
    await client.close();

    expect(first.host.agentPermissions.allowAll()).toBeNull();
    const stored = JSON.parse(
      await readFile(join(first.folder.path, "state", "agent-permissions.json"), "utf8"),
    ) as { allowAll: unknown };
    expect(stored.allowAll).toBeNull();

    await first.close();
    hosts.pop();
    const second = await startTestHost({ folder: first.folder });
    hosts.push(second);
    expect(second.host.agentPermissions.allowAll()).toBeNull();
  });

  it("沒有開全部允許時，暫停照常回應，不會寫出多餘的授權", async () => {
    const host = await startTestHost();
    hosts.push(host);
    const client = await TestClient.connect(host.url);
    await client.waitForReply(await client.hello(host.token));
    const reply = await client.waitForReply(client.request("approval.pause_all", {}), 10_000);
    expect(reply.kind, JSON.stringify(reply)).toBe("response");
    await client.close();
    expect(host.host.agentPermissions.allowAll()).toBeNull();
  });
});
