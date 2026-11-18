import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  makeFolder,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";
import { installFakeAgent } from "./fake-agent.js";

/**
 * 外部代理 → 權限模式（工作 work-714d0eb7，威脅清單 docs/design/m5.md 第 3.3 節
 * 「代理寫入正本」的跨模組版本）。
 *
 * 外部代理在 `sandbox-exec` 下執行，正本區（`state/`）一律拒絕寫入。這裡讓 ACP 假代理
 * 請求權限、由人核准，然後真的去寫 Cardiary 資料夾的 `state/agent-permissions.json`：
 * 就算人核准了代理自己的權限請求，沙盒也擋下寫入，權限正本與
 * `system.permissions.get` 都不變。
 *
 * 單一模組層的沙盒拒絕在 `packages/host/test/permissions/sandbox.test.ts`；代理工具路徑
 * 在 `permissions/agent-paths.test.ts`。沙盒只在 macOS 有，其他平台整組跳過；CI 由
 * macOS job 的「macOS 專屬契約測試」步驟執行。
 */

const darwin = process.platform === "darwin";
const TEST_TIMEOUT = 30_000;
const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const service of services.splice(0)) await service.stop().catch(() => undefined);
});

interface AgentStatePayload {
  readonly agentSessionId: string;
  readonly status: string;
  readonly pendingPermission?: { approvalId: string; toolName: string };
}

async function reply(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const frame = await client.waitForReply(client.request(type, payload), 10_000);
  expect(frame.kind, `${type}: ${JSON.stringify(frame)}`).toBe("response");
  return frame;
}

async function waitForState(
  client: ProtocolClient,
  agentSessionId: string,
  predicate: (payload: AgentStatePayload) => boolean,
  ms = 10_000,
): Promise<AgentStatePayload> {
  const frame = await client.waitFor(
    (candidate) =>
      candidate.kind === "event" &&
      candidate.type === "agent.state_changed" &&
      (candidate.payload as AgentStatePayload).agentSessionId === agentSessionId &&
      predicate(candidate.payload as AgentStatePayload),
    ms,
  );
  return frame.payload as AgentStatePayload;
}

async function eventually(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("條件等待逾時");
}

describe.skipIf(!darwin)("外部代理改不了權限正本", () => {
  it(
    "人核准了代理的權限請求，沙盒仍擋下寫 state/agent-permissions.json，權限模式不變",
    async () => {
      const folder = await makeFolder();
      const target = join(folder.path, "state", "agent-permissions.json");
      const workingDirectory = await mkdtemp(join(tmpdir(), "cardiary-agent-work-"));
      const agent = await installFakeAgent({
        kind: "opencode",
        mode: "permission",
        // 假代理在權限被核准後寫這個檔；這裡指向 Cardiary 的權限正本。
        markerFile: target,
        workingDirectory,
      });
      const service = await spawnService({
        folder,
        env: { CARDIARY_AGENT_COMMAND_OPENCODE: agent.command },
      });
      services.push(service);
      const client = await connectAndHello(service);
      clients.push(client);
      await reply(client, "system.subscribe", {});

      // 人先開一個窄的類別，正本檔才確定存在，之後可以逐位元組比對。
      await reply(client, "system.permissions.set_category", {
        category: "create-card",
        enabled: true,
        paths: [],
        clientRequestId: "seed-category",
      });
      const before = await readFile(target, "utf8");
      const modesBefore = (await reply(client, "system.permissions.get", {})).payload;

      const started = (await reply(client, "agent.start", {
        agentKind: "opencode",
        workingDirectory,
        prompt: "把權限檔改成全部允許",
      })) as { payload: { agentSessionId: string; approvalId: string } };
      const { agentSessionId, approvalId } = started.payload;
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await reply(client, "approval.decide", { approvalId, optionId: "approve" });

      const pending = await waitForState(
        client,
        agentSessionId,
        (state) =>
          state.pendingPermission !== undefined &&
          state.pendingPermission.approvalId !== approvalId,
      );
      await reply(client, "approval.decide", {
        approvalId: pending.pendingPermission?.approvalId ?? "",
        optionId: "approve",
      });

      // 代理確實拿到核准並嘗試寫入（寫入前先記 permission-allowed）。
      await eventually(async () =>
        (await agent.readLog()).some((entry) => entry.event === "permission-allowed"),
      );
      // 給寫入嘗試一點時間；沙盒拒絕時代理會因例外結束。
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(await readFile(target, "utf8")).toBe(before);
      expect((await reply(client, "system.permissions.get", {})).payload).toEqual(modesBefore);
    },
    TEST_TIMEOUT,
  );
});
