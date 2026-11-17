import type { ManagedChild, SpawnRegistry } from "../../spawn/wrapper.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface Response {
  readonly id?: number;
  readonly vector?: number[];
  readonly error?: string;
  readonly type?: string;
  readonly progress?: unknown;
}

/** 嵌入子行程的 NDJSON 介面；子行程由主機的 spawn wrapper 建立與終止。 */
export class LocalEmbedder {
  #child: ManagedChild | undefined;
  #buffer = "";
  #nextId = 0;
  #pending = new Map<
    number,
    { resolve: (vector: Float32Array) => void; reject: (error: Error) => void }
  >();
  #idle: ReturnType<typeof setTimeout> | undefined;
  progress: unknown;

  constructor(
    private readonly spawn: SpawnRegistry,
    private readonly cache: string,
    private readonly onProgress?: (progress: unknown) => void,
  ) {}

  embed(text: string): Promise<Float32Array> {
    const child = this.#child ?? this.#start();
    if (this.#idle !== undefined) {
      clearTimeout(this.#idle);
      this.#idle = undefined;
    }
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      child.child.stdin?.write(`${JSON.stringify({ id, text })}\n`, (error) => {
        if (error === null) return;
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  stop(): void {
    if (this.#idle !== undefined) clearTimeout(this.#idle);
    this.#idle = undefined;
    const child = this.#child;
    this.#child = undefined;
    child?.signal("SIGTERM");
    for (const pending of this.#pending.values()) pending.reject(new Error("嵌入程序已停止"));
    this.#pending.clear();
  }

  #start(): ManagedChild {
    mkdirSync(join(this.cache, "tmp"), { recursive: true });
    const child = this.spawn.spawn({
      command: process.execPath,
      args: [fileURLToPath(new URL("./embedding-worker.js", import.meta.url)), this.cache],
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TMPDIR: join(this.cache, "tmp"),
        TMP: join(this.cache, "tmp"),
        TEMP: join(this.cache, "tmp"),
        HF_HOME: join(this.cache, "models"),
      },
    });
    this.#child = child;
    this.#buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      this.#buffer += chunk.toString("utf8");
      const lines = this.#buffer.split("\n");
      this.#buffer = lines.pop() ?? "";
      for (const line of lines) this.#handleLine(line.trim());
    });
    child.stderr?.on("data", () => {
      // 模型程式的警告只讓它自己留在 stderr，父行程不解析。
    });
    void child.exited.then(() => {
      if (this.#child === child) this.stop();
    });
    return child;
  }

  #handleLine(line: string): void {
    if (line.length === 0) return;
    let response: Response;
    try {
      response = JSON.parse(line) as Response;
    } catch {
      return; // 非協定行（例如函式庫的提示）直接忽略。
    }
    if (response.type === "progress") {
      this.progress = response.progress;
      this.onProgress?.(response.progress);
      return;
    }
    if (response.id === undefined) return;
    const pending = this.#pending.get(response.id);
    if (pending === undefined) return;
    this.#pending.delete(response.id);
    if (response.error !== undefined) pending.reject(new Error(response.error));
    else if (response.vector !== undefined) pending.resolve(Float32Array.from(response.vector));
    else pending.reject(new Error("嵌入程序沒有回傳向量"));
    if (this.#pending.size === 0 && this.#idle === undefined) {
      this.#idle = setTimeout(() => this.stop(), 10 * 60 * 1000);
      this.#idle.unref();
    }
  }
}
