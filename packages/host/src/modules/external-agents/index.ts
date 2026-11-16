/**
 * 外部代理模組的進入點。
 *
 * 模組目錄會被 loader 自動掃到，不需要改共用的第一方清單。模組啟動時先做
 * 快取與暫存清理、把上次關機留下的懸空工作階段標為結果未知；主機關閉時
 * 中斷所有還活著的代理，避免留下孤兒行程。
 */
import { homedir } from "node:os";

import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";

import type { SpawnRegistry } from "../../spawn/wrapper.js";
import { HOST_SERVICE_NAMES, type AgentApprovalsService } from "../contract.js";
import { manifest } from "./manifest.js";
import { registerExternalAgentsProtocol } from "./protocol.js";
import { ExternalAgentsService, type ExternalAgentStateData } from "./service.js";

export const hostModule: HostModule = { manifest, activate, deactivate };

let active: ExternalAgentsService | null = null;

async function activate(context: ModuleActivationContext): Promise<void> {
  const approvals = context.services.host.require<AgentApprovalsService>(
    HOST_SERVICE_NAMES.agentApprovals,
  );
  const spawn = context.services.host.get<SpawnRegistry>(HOST_SERVICE_NAMES.spawn);
  if (spawn === undefined) {
    throw new Error("外部代理需要受控子行程服務才能啟動。");
  }
  const service = new ExternalAgentsService({
    paths: context.services.paths,
    spawn,
    approvals,
    emitState: (data) => emitState(context, data),
    logger: context.services.logger,
    now: () => context.services.clock.now(),
    homeDir: homedir(),
  });
  registerExternalAgentsProtocol({ service, protocol: context.services.protocol });
  await service.startupCleanup();
  active = service;
}

async function deactivate(): Promise<void> {
  await active?.shutdown();
  active = null;
}

/** 領域狀態轉成協定 `agent.state_changed` 的 payload。 */
function emitState(context: ModuleActivationContext, data: ExternalAgentStateData): void {
  const status = data.status === "completed" || data.status === "stopped" ? "stopped" : data.status;
  context.services.protocol.emit({
    kind: "external-agent-status",
    agentSessionId: data.agentSessionId,
    agentKind: data.agentKind,
    status,
    ...(data.progress
      ? {
          progress: {
            step: String(data.progress.step),
            label: data.progress.label,
            completed: data.progress.completed,
            total: data.progress.total,
          },
        }
      : {}),
    ...(data.message ? { message: data.message } : {}),
    ...(data.resultUnknown === true ? { resultUnknown: true } : {}),
    ...(data.pendingPermission
      ? {
          pendingPermission: {
            approvalId: data.pendingPermission.approvalId,
            toolName: data.pendingPermission.toolName,
            ...(data.pendingPermission.description === undefined
              ? {}
              : { description: data.pendingPermission.description }),
          },
        }
      : {}),
  });
}
