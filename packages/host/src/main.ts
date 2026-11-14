#!/usr/bin/env node
import { installStdoutGuard } from "./control/stdoutGuard.js";

// stdout 守門必須在其他模組載入之前安裝：覆寫 process.stdout.write，把非協定
// 輸出導到 stderr，並把 console 綁到 stderr。之後才動態載入入口。
const sink = installStdoutGuard();

const { run } = await import("./run.js");

try {
  const code = await run(process.argv.slice(2), sink);
  if (code !== 0) process.exitCode = code;
} catch (error) {
  process.stderr.write(`服務啟動失敗：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
