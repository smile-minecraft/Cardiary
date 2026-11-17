import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnRegistry } from "../../../src/spawn/wrapper.js";
import { LocalEmbedder } from "../../../src/modules/retrieval/embedder.js";

interface FakeChild {
  readonly child: { readonly stdin: Writable };
  readonly stdout: EventEmitter;
  readonly stderr: EventEmitter;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly pid: number;
  readonly signals: NodeJS.Signals[];
  signal(signal: NodeJS.Signals): void;
}

function createFakeSpawn(): { spawn: SpawnRegistry; children: FakeChild[] } {
  const children: FakeChild[] = [];
  const spawn = {
    spawn(): FakeChild {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const signals: NodeJS.Signals[] = [];
      let resolveExit: (info: {
        code: number | null;
        signal: NodeJS.Signals | null;
      }) => void = () => undefined;
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          resolveExit = resolve;
        },
      );
      const stdin = new Writable({
        write(chunk, _encoding, callback) {
          for (const line of chunk.toString("utf8").split("\n")) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;
            const request = JSON.parse(trimmed) as { id: number };
            stdout.emit(
              "data",
              Buffer.from(`${JSON.stringify({ id: request.id, vector: [0.25, 0.5] })}\n`),
            );
          }
          callback();
        },
      });
      const child: FakeChild = {
        child: { stdin },
        stdout,
        stderr,
        exited,
        pid: 900 + children.length,
        signals,
        signal(signal) {
          signals.push(signal);
          resolveExit({ code: null, signal });
        },
      };
      children.push(child);
      return child;
    },
  } as unknown as SpawnRegistry;
  return { spawn, children };
}

const IDLE_MS = 10 * 60 * 1000;

let folder: string;

beforeEach(() => {
  vi.useFakeTimers();
  folder = mkdtempSync(join(tmpdir(), "cardiary-embedder-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(folder, { recursive: true, force: true });
});

describe("嵌入子行程的閒置卸載", () => {
  it("連續兩次嵌入後，閒置十分鐘會送 SIGTERM", async () => {
    const fake = createFakeSpawn();
    const embedder = new LocalEmbedder(fake.spawn, folder);

    await expect(embedder.embed("第一張卡")).resolves.toEqual(Float32Array.from([0.25, 0.5]));
    await expect(embedder.embed("第二張卡")).resolves.toEqual(Float32Array.from([0.25, 0.5]));

    expect(fake.children).toHaveLength(1);
    expect(fake.children[0]!.signals).toEqual([]);

    // 第二次嵌入也要重新裝上閒置計時器；只修第一次會在這裡失敗。
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(fake.children[0]!.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.children[0]!.signals).toEqual(["SIGTERM"]);
    await expect(fake.children[0]!.exited).resolves.toEqual({ code: null, signal: "SIGTERM" });
  });

  it("送出嵌入要求時會取消已排定的閒置卸載", async () => {
    const fake = createFakeSpawn();
    const embedder = new LocalEmbedder(fake.spawn, folder);

    await embedder.embed("第一張卡");
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    await embedder.embed("第二張卡");
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(fake.children[0]!.signals).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(fake.children[0]!.signals).toEqual(["SIGTERM"]);
  });
});
