import { homedir } from "node:os";

import type { CardIndex } from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import { ImportCardWriter } from "./card-writer.js";
import { nodeSourceFileSystem, nodeReadonlyDatabase } from "./fs.js";
import { manifest } from "./manifest.js";
import { registerImportProtocol } from "./protocol.js";
import { ImportService } from "./service.js";
import { FileSkillCopier } from "./skills.js";
import { createAlmaAdapter } from "./sources/alma.js";
import { createGenericAdapter } from "./sources/generic.js";
import { createHermesAdapter } from "./sources/hermes.js";
import { createCodexAdapter, createClaudeCodeAdapter } from "./sources/coding-agents.js";
import { createOpenClawAdapter } from "./sources/openclaw.js";
import { createClaudeExportAdapter } from "./sources/claude-export.js";
import { ImportJobStore } from "./store.js";
import type { ImportSourceAdapter, ImportSourceKind } from "./types.js";

/**
 * 匯入模組的進入點。
 *
 * 卡片與技能都寫進 Cardiary 自己的資料夾；來源只用注入的唯讀介面開啟，
 * 所以「不修改來源」不是靠自律，而是沒有寫入的方法可用。
 */
export const hostModule: HostModule = {
  manifest,
  activate,
};

async function activate(context: ModuleActivationContext): Promise<void> {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const now = (): Date => context.services.clock.now();
  const fs = nodeSourceFileSystem;
  const home = homedir();
  const adapters = new Map<ImportSourceKind, ImportSourceAdapter>([
    ["generic", createGenericAdapter({ fs })],
    ["hermes", createHermesAdapter({ fs, openDatabase: nodeReadonlyDatabase, homeDir: home })],
    ["alma", createAlmaAdapter({ fs, openDatabase: nodeReadonlyDatabase, homeDir: home })],
    ["codex", createCodexAdapter({ fs })],
    ["claude-code", createClaudeCodeAdapter({ fs })],
    ["openclaw", createOpenClawAdapter({ fs })],
    ["claude", createClaudeExportAdapter({ fs })],
  ]);
  const service = new ImportService({
    fs,
    openDatabase: nodeReadonlyDatabase,
    adapters,
    store: new ImportJobStore({ db: cabinet.state, now }),
    cards: new ImportCardWriter({ cardsDirectory: context.services.paths.cards, now }),
    skills: new FileSkillCopier({ skillsDirectory: context.services.paths.skills }),
    rescanCards: async () => {
      const index = context.services.host.get<CardIndex>(HOST_SERVICE_NAMES.cardIndex);
      await index?.rescan();
    },
    models: () => context.services.host.get(HOST_SERVICE_NAMES.models),
    emitProgress: (payload) => {
      context.services.protocol.emit({
        kind: "module-event",
        type: "module.import.progress",
        payload: payload as JsonValue,
      });
    },
    logger: context.services.logger,
  });
  registerImportProtocol({ service, protocol: context.services.protocol });
  context.services.logger.info("匯入模組已啟用", { sources: [...adapters.keys()] });
}

/** 停用：沒有背景工作；已寫入的卡片與匯入紀錄都保留。 */
export function deactivate(): void {}
