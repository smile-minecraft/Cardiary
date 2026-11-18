import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ModuleActivationContext,
  ProtocolEventIntent,
  SettingChange,
} from "@cardiary/module-api";
import { afterEach, describe, expect, it } from "vitest";
import type { SpawnRegistry } from "../../host/src/spawn/wrapper.js";
import {
  CardFileStore,
  CardIndexStore,
  LocalAssetStore,
  Storage,
  type Database,
} from "../../storage/src/index.js";

import { CardStateStore } from "../../host/src/modules/cards/state.js";
import { CardLibrary } from "../../host/src/modules/cards/library.js";
import type { CardEnvironment } from "../../host/src/modules/contract.js";
import { HOST_SERVICE_NAMES } from "../../host/src/modules/contract.js";
import { EMBEDDING_INDEX_KEY } from "../../host/src/modules/retrieval/model.js";
import { hostModule } from "../../host/src/modules/retrieval/index.js";
import type { RetrievalService } from "../../host/src/modules/retrieval/service.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newUlid(offset = 0): string {
  let time = BigInt(Date.now() + offset);
  const timePart = new Array<string>(10);
  for (let index = 9; index >= 0; index -= 1) {
    timePart[index] = CROCKFORD[Number(time & 31n)] as string;
    time >>= 5n;
  }
  const randomPart = new Array<string>(16);
  for (let index = 0; index < 16; index += 1) {
    randomPart[index] = CROCKFORD[Math.floor(Math.random() * 32)] as string;
  }
  return `${timePart.join("")}${randomPart.join("")}`;
}

function fakeVector(text: string): Float32Array {
  const dimension = 16;
  const vector = new Float32Array(dimension);
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let state = hash >>> 0;
  for (let index = 0; index < dimension; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    vector[index] = (state / 4294967296) * 2 - 1;
  }
  return vector;
}

const EMBED_FAILURE_MARK = "FAIL_EMBED";
const QUERY_PREFIX = "Instruct:";

interface FakeChild {
  readonly child: { readonly stdin: Writable };
  readonly stdin: Writable;
  readonly stdout: EventEmitter;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly pid: number;
  readonly signals: NodeJS.Signals[];
  signal(signal: NodeJS.Signals): void;
  write(data: string): void;
  closeInput(): void;
}

function createFakeSpawn(): {
  readonly spawn: SpawnRegistry;
  readonly children: FakeChild[];
  hold(): void;
  release(): void;
} {
  const children: FakeChild[] = [];
  let held = false;
  const gates: Array<() => void> = [];
  const hold = (): void => {
    held = true;
  };
  const release = (): void => {
    held = false;
    const pending = gates.splice(0, gates.length);
    for (const releaseGate of pending) releaseGate();
  };

  const spawn = {
    spawn(options: { stdio?: readonly unknown[] }): FakeChild {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      let resolveExit: (info: {
        code: number | null;
        signal: NodeJS.Signals | null;
      }) => void = () => undefined;
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          resolveExit = resolve;
        },
      );
      const handleLine = (raw: string): void => {
        const line = raw.trim();
        if (line.length === 0) return;
        let request: { id?: number; text?: string };
        try {
          request = JSON.parse(line) as { id?: number; text?: string };
        } catch {
          return;
        }
        if (request.id === undefined || request.text === undefined) return;
        const text = request.text;
        const respond = (): void => {
          const id = request.id as number;
          const isFailure = text.includes(EMBED_FAILURE_MARK);
          const response = isFailure
            ? { id, error: "嵌入失敗（測試用）" }
            : { id, vector: Array.from(fakeVector(text)) };
          stdout.emit("data", Buffer.from(`${JSON.stringify(response)}\n`, "utf8"));
        };
        if (held && !text.startsWith(QUERY_PREFIX) && !text.includes(EMBED_FAILURE_MARK)) {
          gates.push(respond);
          return;
        }
        respond();
      };
      const stdin = new Writable({
        write(chunk, _encoding, callback) {
          queueMicrotask(() => handleLine(chunk.toString("utf8")));
          callback();
        },
      });
      const signals: NodeJS.Signals[] = [];
      const child: FakeChild = {
        pid: 4242 + children.length,
        child: { stdin },
        stdin,
        stdout,
        stderr,
        exited,
        signals,
        signal(signal) {
          signals.push(signal);
          resolveExit({ code: null, signal });
        },
        write(data: string) {
          stdin.write(data);
        },
        closeInput() {
          stdin.end();
        },
      } as FakeChild;
      children.push(child);
      // 模組讀 stdout 的方式是 `on("data")`；保持與 EventEmitter 相同的介面。
      void options.stdio;
      return child;
    },
  } as unknown as SpawnRegistry;

  return { spawn, children, hold, release };
}

interface Fixture {
  readonly folder: string;
  readonly storage: Storage;
  readonly library: CardLibrary;
  readonly cabinet: CardEnvironment;
  readonly events: ProtocolEventIntent[];
  readonly provided: Map<string, unknown>;
  readonly warnings: string[];
  readonly onChangeListeners: Array<(change: SettingChange) => void>;
  readonly fakeSpawn: ReturnType<typeof createFakeSpawn>;
  /** 呼叫 `cabinet.cache()` 的次數；未同意時必須是 0。 */
  readonly counters: { cacheCalls: number };
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    try {
      hostModule.deactivate?.({ reason: "user" });
    } catch {
      // 已停用；忽略。
    }
    try {
      fixture.storage.close();
    } catch {
      // 已關閉；忽略。
    }
    await rm(fixture.folder, { recursive: true, force: true });
  }
});

async function makeFixture(cardCount: number): Promise<Fixture> {
  const folder = await mkdtemp(join(tmpdir(), "cardiary-retrieval-status-"));
  const storage = Storage.open({ path: folder, initialize: true });
  const now = (): Date => new Date();
  const files = new CardFileStore({ layout: storage.layout, now });
  const index = (): CardIndexStore => new CardIndexStore({ db: storage.cache, now });
  const assets = (): LocalAssetStore =>
    new LocalAssetStore({ layout: storage.layout, index: index(), now });
  const state = new CardStateStore({ db: () => storage.state, now });
  const events: ProtocolEventIntent[] = [];
  const library = new CardLibrary({
    files,
    index,
    assets,
    state,
    now,
    emit: (intent) => events.push(intent),
  });
  await library.initialize();
  for (let index = 0; index < cardCount; index += 1) {
    await library.create({
      kind: "note",
      title: `卡 ${newUlid(index + 1).slice(0, 6)}`,
      body: `手寫字練習筆記 ${index}。\n`,
    });
  }
  const counters = { cacheCalls: 0 };
  const cabinet: CardEnvironment = {
    layout: storage.layout,
    state: storage.state,
    cache: () => {
      counters.cacheCalls += 1;
      return storage.cache;
    },
    settings: storage.settings,
    ownsConnections: false,
    close: () => {},
  };
  const provided = new Map<string, unknown>();
  const warnings: string[] = [];
  const onChangeListeners: Array<(change: SettingChange) => void> = [];
  const fakeSpawn = createFakeSpawn();
  const fixture: Fixture = {
    folder,
    storage,
    library,
    cabinet,
    events,
    provided,
    warnings,
    onChangeListeners,
    fakeSpawn,
    counters,
  };
  fixtures.push(fixture);
  return fixture;
}

function makeContext(fixture: Fixture): ModuleActivationContext {
  const noop = (): void => undefined;
  const pathsRoot = fixture.folder;
  const services = {
    paths: {
      root: pathsRoot,
      cards: join(pathsRoot, "cards"),
      assets: join(pathsRoot, "assets"),
      boards: join(pathsRoot, "boards"),
      skills: join(pathsRoot, "skills"),
      state: join(pathsRoot, "state"),
      modules: join(pathsRoot, "modules"),
      cache: join(pathsRoot, "cache"),
      tmp: join(pathsRoot, "tmp"),
    },
    logger: {
      debug: noop,
      info: noop,
      warn: (message: string, fields?: Record<string, unknown>) =>
        fixture.warnings.push(`${message}: ${JSON.stringify(fields ?? {})}`),
      error: noop,
    },
    protocol: {
      emit: (intent: ProtocolEventIntent) => fixture.events.push(intent),
      registerNamespace: () => ({ dispose: noop }),
    },
    settings: {
      // 模組的機讀介面會擋掉 human-only 的值；呼叫時必須拿不到同意設定。
      get: () => undefined,
      getLevel: () => "human-only" as const,
      onChange: (listener: (change: SettingChange) => void) => {
        fixture.onChangeListeners.push(listener);
        return () => undefined;
      },
    },
    clock: { now: () => new Date() },
    host: {
      provide: (name: string, value: unknown) => fixture.provided.set(name, value),
      get: () => undefined,
      require: (name: string): unknown => {
        if (name === HOST_SERVICE_NAMES.cards) return fixture.library;
        if (name === HOST_SERVICE_NAMES.cardStorage) return fixture.cabinet;
        if (name === HOST_SERVICE_NAMES.spawn) return fixture.fakeSpawn.spawn;
        throw new Error(`測試用的 require 沒有服務 ${name}`);
      },
    },
  };
  return {
    identity: { moduleId: "retrieval", generation: 1 },
    services,
    registerToolBundle: noop,
    registerContextSection: noop,
    registerHook: noop,
    registerSchedule: noop,
  } as unknown as ModuleActivationContext;
}

function changeFor(value: boolean): SettingChange {
  return {
    key: "retrieval.allowModelDownload",
    previousValue: !value,
    nextValue: value,
    level: "human-only",
    changedBy: { kind: "human", id: "user:tester" },
    changedAt: new Date().toISOString(),
  } as unknown as SettingChange;
}

function retrievalStatuses(events: readonly ProtocolEventIntent[]) {
  return events.flatMap((intent) =>
    intent.kind === "module-event" && intent.type === "module.retrieval.status"
      ? [intent.payload as Record<string, unknown>]
      : [],
  );
}

function retrievalProgress(events: readonly ProtocolEventIntent[]) {
  return events.flatMap((intent) =>
    intent.kind === "module-event" && intent.type === "module.retrieval.progress"
      ? [intent.payload as Record<string, unknown>]
      : [],
  );
}

function vectorCount(cache: Database): number {
  const row = cache.get<{ count: number }>("SELECT COUNT(*) AS count FROM vec_cards");
  return row === undefined ? 0 : Number(row.count);
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("條件等待逾時");
}

describe("retrieval 模組的可觀察狀態", () => {
  it("未同意時 activate 只回報 disabled，不開資料庫、不啟動子行程", async () => {
    const fixture = await makeFixture(2);
    const statusesBefore = retrievalStatuses(fixture.events);

    await hostModule.activate(makeContext(fixture));

    const statuses = retrievalStatuses(fixture.events);
    expect(fixture.fakeSpawn.children).toHaveLength(0);
    expect(fixture.counters.cacheCalls).toBe(0);
    expect(statuses.at(-1)).toEqual({
      state: "disabled",
      reason: "consent-required",
      fallback: "fts",
    });
    // 服務仍然提供，查詢走全文路徑。
    const service = fixture.provided.get("retrieval");
    expect(service).toBeDefined();
    expect(statusesBefore).toHaveLength(0);
  });

  it("同意後：重建開始 → 完成，模組事件記錄 building→ready", async () => {
    const fixture = await makeFixture(3);
    await hostModule.activate(makeContext(fixture));

    // 人按下同意：直接寫原始值，再通知模組。
    fixture.cabinet.settings.set({
      key: "retrieval.allowModelDownload",
      value: JSON.stringify(true),
      level: "human-only",
      updatedBy: "user:tester",
    });
    fixture.fakeSpawn.hold();
    for (const listener of fixture.onChangeListeners) listener(changeFor(true));

    await waitFor(
      () => retrievalStatuses(fixture.events).some((status) => status.state === "building"),
      1000,
    );
    const building = retrievalStatuses(fixture.events).find(
      (status) => status.state === "building",
    );
    expect(building).toMatchObject({ state: "building", fallback: "fts", total: 3 });

    // 放行，直到 ready。
    fixture.fakeSpawn.release();
    await waitFor(
      () => retrievalStatuses(fixture.events).some((status) => status.state === "ready"),
      5000,
    );
    expect(vectorCount(fixture.storage.cache)).toBe(3);
    const distinctModels = fixture.storage.cache.all<{ model: string }>(
      "SELECT DISTINCT model FROM vec_cards",
    );
    expect(distinctModels.map((row) => row.model)).toEqual([EMBEDDING_INDEX_KEY]);
    expect(retrievalProgress(fixture.events)).toContainEqual({
      phase: "index",
      completed: 3,
      total: 3,
    });

    // 翻回未同意：應收到 disabled，子行程收到 SIGTERM 並結束。
    const childBefore = fixture.fakeSpawn.children.at(-1);
    expect(childBefore).toBeDefined();
    fixture.cabinet.settings.set({
      key: "retrieval.allowModelDownload",
      value: JSON.stringify(false),
      level: "human-only",
      updatedBy: "user:tester",
    });
    for (const listener of fixture.onChangeListeners) listener(changeFor(false));
    const last = retrievalStatuses(fixture.events).at(-1);
    expect(last).toEqual({ state: "disabled", reason: "consent-required", fallback: "fts" });
    expect(childBefore?.signals).toContain("SIGTERM");
    await expect(childBefore?.exited).resolves.toEqual({ code: null, signal: "SIGTERM" });

    // 服務從模組的提供面仍然可用，且不再需要向量。
    const service = fixture.provided.get("retrieval") as RetrievalService;
    const result = await service.search({ query: "手寫字" }, "search");
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("重建失敗：回報 degraded，全文檢索仍然可用", async () => {
    const folderFixture = await makeFixture(2);
    // 讓其中一張卡的嵌入必然失敗。
    await folderFixture.library.create({
      kind: "note",
      title: "失敗卡",
      body: `手寫字練習 ${EMBED_FAILURE_MARK}\n`,
    });
    await hostModule.activate(makeContext(folderFixture));
    folderFixture.cabinet.settings.set({
      key: "retrieval.allowModelDownload",
      value: JSON.stringify(true),
      level: "human-only",
      updatedBy: "user:tester",
    });
    for (const listener of folderFixture.onChangeListeners) listener(changeFor(true));

    await waitFor(
      () => retrievalStatuses(folderFixture.events).some((status) => status.state === "degraded"),
      5000,
    );
    const degraded = retrievalStatuses(folderFixture.events).find(
      (status) => status.state === "degraded",
    );
    expect(degraded?.fallback).toBe("fts");
    expect(typeof degraded?.reason).toBe("string");
    expect((degraded?.reason as string).length).toBeGreaterThan(0);

    const service = folderFixture.provided.get("retrieval") as RetrievalService;
    const result = await service.search({ query: "手寫字" }, "search");
    expect(result.items.length).toBeGreaterThan(0);
  });
});
