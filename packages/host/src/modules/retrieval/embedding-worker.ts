import { env, LogLevel, pipeline } from "@huggingface/transformers";
import { EMBEDDING_MODEL_ID, EMBEDDING_MODEL_REVISION } from "./model.js";
import { join } from "node:path";

const cache = process.argv[2];
if (cache === undefined) throw new Error("缺少模型快取目錄");
env.cacheDir = join(cache, "models");
env.allowRemoteModels = true;
env.allowLocalModels = true;
env.logLevel = LogLevel.ERROR;

let model: Awaited<ReturnType<typeof load>> | undefined;
async function load() {
  return pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
    revision: EMBEDDING_MODEL_REVISION,
    dtype: "q8",
    device: "cpu",
    progress_callback: (progress) => send({ type: "progress", progress }),
  });
}

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

let tail = Promise.resolve();
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    tail = tail.then(async () => {
      let request: { id: number; text: string };
      try {
        request = JSON.parse(trimmed) as { id: number; text: string };
      } catch {
        return;
      }
      try {
        model ??= await load();
        const output = await model([request.text], { pooling: "last_token", normalize: true });
        send({ id: request.id, vector: Array.from(output.data as Float32Array) });
      } catch (error) {
        model = undefined;
        send({ id: request.id, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }
});
