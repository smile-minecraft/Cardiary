import type {
  JsonValue,
  ModuleActivationContext,
  ModuleServices,
  RegistrationHandle,
} from "@cardiary/module-api";
import type { ToolBundleDraft, ToolDefinition, ToolOutcome } from "@cardiary/engine-adapter";
import { ProcessSupervisor } from "@cardiary/engine-adapter";

import {
  localToolDefinitions,
  type LocalToolsEnvironment,
} from "../../../src/modules/local-tools/tools.js";
import { TurnOverflowTracker } from "../../../src/modules/local-tools/output.js";
import { createCommandSandbox } from "../../../src/permissions/sandbox.js";
import { openPermissionFixture, type PermissionFixture } from "../../permissions/support.js";

export interface LocalToolsHarness {
  readonly fixture: PermissionFixture;
  readonly tracker: TurnOverflowTracker;
  readonly supervisor: ProcessSupervisor;
  readonly tools: readonly ToolDefinition[];
  readonly environment: LocalToolsEnvironment;
  run(
    toolName: string,
    input: JsonValue,
    options?: { readonly signal?: AbortSignal; readonly turnId?: string; readonly callId?: string },
  ): Promise<ToolOutcome>;
  cleanup(): Promise<void>;
}

/** 小上限讓截斷在測試裡真的發生。 */
export const TEST_LIMITS = {
  maxInlineChars: 200,
  headChars: 60,
  tailChars: 60,
  maxSpillChars: 4096,
};

export interface LocalToolsHarnessOptions {
  /** 子行程的家目錄；沙盒的敏感讀取規則也用它。預設沿用測試行程的 HOME。 */
  readonly homeDir?: string;
  /** `folder` 讓工作目錄等於資料夾根，與產品的預設相同。 */
  readonly workingDir?: "project" | "folder";
}

export async function makeLocalToolsHarness(
  overrides: Partial<LocalToolsEnvironment> = {},
  options: LocalToolsHarnessOptions = {},
): Promise<LocalToolsHarness> {
  const fixture = openPermissionFixture();
  const supervisor = new ProcessSupervisor({
    tempDir: `${fixture.folder}/tmp`,
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
  });
  const tracker = new TurnOverflowTracker();
  const workingDir = options.workingDir === "folder" ? fixture.folder : fixture.project;
  const environment: LocalToolsEnvironment = {
    workingDir,
    folderRoot: fixture.folder,
    limits: TEST_LIMITS,
    spill: {
      registry: fixture.storage.registry,
      now: () => new Date("2026-11-15T00:00:00.000Z"),
      onSpill: ({ turnId, callId, tempDir }) => tracker.track(turnId, callId, tempDir),
    },
    commandTimeoutMs: 10_000,
    maxReadBytes: 4096,
    maxListEntries: 20,
    sandbox: createCommandSandbox({
      workingDir,
      folderRoot: fixture.folder,
      ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    }),
    ...overrides,
  };
  const tools = localToolDefinitions(environment);
  return {
    fixture,
    tracker,
    supervisor,
    tools,
    environment,
    async run(toolName, input, options = {}) {
      const tool = tools.find((candidate) => candidate.name === toolName);
      if (tool === undefined) {
        throw new Error(`找不到工具 ${toolName}`);
      }
      return tool.execute(input, {
        conversationId: "c1",
        turnId: options.turnId ?? "turn-1",
        callId: options.callId ?? "call-1",
        toolName,
        signal: options.signal ?? new AbortController().signal,
        tempDir: `${fixture.folder}/tmp`,
        workingDir: environment.workingDir,
        spawn: (spec) => supervisor.spawn({ ...spec, cwd: spec.cwd ?? environment.workingDir }),
        requestApproval: async () => {
          throw new Error("測試不應該在工具內要求審批");
        },
      });
    },
    async cleanup() {
      await supervisor.terminateAll(100);
      fixture.cleanup();
    },
  };
}

/** 最小可用的 `ModuleActivationContext`；只記下註冊了什麼。 */
export function activationContext(options: {
  readonly paths: { readonly root: string };
  readonly services?: Partial<ModuleServices>;
}): {
  readonly context: ActivationContext;
  readonly bundles: ToolBundleDraft[];
  readonly hooks: Array<{ point: string }>;
  readonly provided: Map<string, unknown>;
  readonly disposed: string[];
} {
  const bundles: ToolBundleDraft[] = [];
  const hooks: Array<{ point: string }> = [];
  const provided = new Map<string, unknown>();
  const disposed: string[] = [];
  let counter = 0;
  const handle = (label: string): RegistrationHandle => {
    counter += 1;
    const registrationId = `${label}-${counter}`;
    return {
      registrationId,
      async dispose() {
        disposed.push(registrationId);
      },
    };
  };
  const services: ModuleServices = {
    models: { invoke: async () => ({ text: "" }) },
    backgroundTasks: {
      run: async () => ({ conversationId: "c1", status: "completed", summary: null }),
    },
    protocol: {
      emit: () => undefined,
      registerNamespace: () => handle("protocol"),
      registerHttpRoute: () => handle("http"),
    },
    storage: {
      dataDir: `${options.paths.root}/modules/local-tools`,
      cacheDir: `${options.paths.root}/cache`,
      tempDir: `${options.paths.root}/tmp`,
    },
    paths: {
      root: options.paths.root,
      cards: `${options.paths.root}/cards`,
      assets: `${options.paths.root}/assets`,
      boards: `${options.paths.root}/boards`,
      skills: `${options.paths.root}/skills`,
      state: `${options.paths.root}/state`,
      modules: `${options.paths.root}/modules`,
      cache: `${options.paths.root}/cache`,
      tmp: `${options.paths.root}/tmp`,
      logs: `${options.paths.root}/logs`,
    },
    settings: {
      get: () => undefined,
      getLevel: () => "human-only",
      onChange: () => () => undefined,
    },
    secrets: { withSecret: async (_ref, use) => use("") },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    clock: { now: () => new Date("2026-11-15T00:00:00.000Z") },
    host: {
      provide<T>(name: string, value: T) {
        provided.set(name, value);
      },
      get<T>(name: string) {
        return (provided.get(name) ?? (options.services?.host?.get?.(name) as T)) as T | undefined;
      },
      require<T>(name: string) {
        const value = provided.get(name);
        if (value === undefined) throw new Error(`缺少服務 ${name}`);
        return value as T;
      },
    },
    ...options.services,
  };
  const context: ModuleActivationContext = {
    identity: { id: "local-tools", version: "0.1.0", generation: 1 },
    services,
    registerToolBundle(draft) {
      bundles.push(draft);
      return handle("bundle");
    },
    registerContextSection() {
      return handle("section");
    },
    registerHook(hook) {
      hooks.push(hook as { point: string });
      return handle("hook");
    },
    registerSchedule() {
      return handle("schedule");
    },
  };
  return { context, bundles, hooks, provided, disposed };
}
