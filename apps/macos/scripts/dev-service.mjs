/* global process */
// 開發用的主機服務替身（不是產品）。真正的服務由「協定閘道」工作產出。
//
// 這支腳本只實作殼需要的私有控制面：init／ready／hello／hello-ack、health、
// pause／resume／shutdown，足以讓 App 啟動、出現在選單列，並手動驗證 TCC 的
// 隱私提示歸屬。它不開資料庫、不簽發事件序號、不提供客戶端協定。
//
// 用法：build-app.sh 預設會把這支腳本放進 App bundle；發行版要換成真正的服務。

import readline from "node:readline";

const PROTOCOL = 1;
const controlToken = { value: null };
let brokerToken = null;
let folderPath = null;
let lifecycle = "idle";
let startedAt = Date.now();

function writeFrame(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`);
}

function log(message) {
  process.stderr.write(`dev-service: ${message}\n`);
}

function fail(code, reason) {
  log(reason);
  process.exit(code);
}

function isToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function respond(id, payload) {
  writeFrame({
    v: PROTOCOL,
    kind: "response",
    id: `res_${id}`,
    replyTo: id,
    auth: { token: brokerToken },
    ok: true,
    payload,
  });
}

const lines = readline.createInterface({ input: process.stdin, terminal: false });
const queue = [];
const waiters = [];
let stdinClosed = false;

lines.on("line", (line) => {
  if (waiters.length > 0) {
    waiters.shift()(line);
  } else {
    queue.push(line);
  }
});
lines.on("close", () => {
  stdinClosed = true;
  for (const waiter of waiters.splice(0)) waiter(null);
  // 租約中斷：關閉但不假裝是正常關閉（真正的服務會維持 clean_shutdown = 0）。
  log("stdin 結束，服務收工");
  process.exit(0);
});

function nextLine() {
  if (queue.length > 0) return Promise.resolve(queue.shift());
  if (stdinClosed) return Promise.resolve(null);
  return new Promise((resolve) => waiters.push(resolve));
}

async function main() {
  const initLine = await nextLine();
  if (!initLine) fail(2, "stdin 在 init 之前就結束");

  let init;
  try {
    init = JSON.parse(initLine);
  } catch {
    fail(2, "第一行不是 JSON");
  }
  if (init.type !== "init") fail(2, "第一行不是 init");
  if (init.protocol !== PROTOCOL) fail(2, "控制面版本不符");
  if (!isToken(init.token) || !isToken(init.brokerToken) || init.token === init.brokerToken) {
    fail(2, "Token 格式不合法或兩把相同");
  }
  controlToken.value = init.token;
  brokerToken = init.brokerToken;
  folderPath = init.folder?.path;
  if (typeof folderPath !== "string" || !folderPath.startsWith("/")) {
    fail(2, "folder.path 不是絕對路徑");
  }

  writeFrame({
    type: "ready",
    protocol: PROTOCOL,
    pid: process.pid,
    clientPort: 0,
    folderId: "dev-folder",
    epoch: `dev-${Date.now()}`,
  });
  writeFrame({
    v: PROTOCOL,
    kind: "hello",
    role: "host-service",
    pid: process.pid,
    auth: { token: brokerToken },
  });

  const ackLine = await nextLine();
  if (!ackLine) fail(3, "hello-ack 之前 stdin 就結束");
  let ack;
  try {
    ack = JSON.parse(ackLine);
  } catch {
    fail(3, "hello-ack 不是 JSON");
  }
  if (ack.kind !== "hello-ack" || ack.auth?.token !== controlToken.value) {
    fail(3, "hello-ack 的 Token 不符");
  }
  log(`交握完成 pid=${process.pid} folder=${folderPath}`);

  while (true) {
    const line = await nextLine();
    if (line === null) return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      fail(4, "收到不是 JSON 的 frame");
    }
    if (
      frame.v !== PROTOCOL ||
      frame.kind !== "request" ||
      frame.auth?.token !== controlToken.value
    ) {
      fail(4, "收到不合法或 Token 不符的 frame");
    }

    switch (frame.route) {
      case "control.health":
        respond(frame.id, {
          state: "running",
          epoch: `dev`,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          folderId: "dev-folder",
          clientPort: 0,
          lifecycle,
        });
        break;
      case "control.pause":
        lifecycle = "idle";
        respond(frame.id, {
          state: "paused",
          databasesClosed: true,
          interruptedSessionIds: [],
          terminatedProcesses: 0,
        });
        break;
      case "control.resume":
        lifecycle = "idle";
        respond(frame.id, {
          state: "ready",
          epoch: "dev",
          folderId: "dev-folder",
          engineReopened: true,
        });
        break;
      case "control.shutdown":
        respond(frame.id, { state: "closed", cleanShutdown: true });
        process.stdout.write("", () => process.exit(0));
        break;
      default:
        writeFrame({
          v: PROTOCOL,
          kind: "response",
          id: `res_${frame.id}`,
          replyTo: frame.id,
          auth: { token: brokerToken },
          ok: false,
          error: { code: "unsupported_route", message: "不支援的路由。", retryable: false },
        });
    }
  }
}

main().catch((error) => fail(70, `${error?.stack ?? error}`));
