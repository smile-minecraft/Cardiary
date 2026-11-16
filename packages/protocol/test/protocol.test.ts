/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { assertValidBoard } from "../../domain/src/boards/validate.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const schema = JSON.parse(
  readFileSync(`${packageRoot}/schema/protocol.schema.json`, "utf8"),
) as any;
const examples = JSON.parse(
  readFileSync(`${packageRoot}/examples/protocol-examples.json`, "utf8"),
) as Record<string, any>;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema);

const validateClient = ajv.compile({
  $ref: `${schema.$id}#/$defs/ClientFrame`,
});
const validateServer = ajv.compile({
  $ref: `${schema.$id}#/$defs/ServerFrame`,
});

function collectTypeConstants(): Set<string> {
  const types = new Set<string>();
  for (const definition of Object.values(schema.$defs) as any[]) {
    const constant = definition?.properties?.type?.const;
    if (typeof constant === "string") {
      types.add(constant);
    }
  }
  return types;
}

function definitionNamesForKind(kind: string): Set<string> {
  const names = new Set<string>();
  for (const [name, definition] of Object.entries(schema.$defs) as [string, any][]) {
    if (definition?.properties?.kind?.const === kind) {
      names.add(name);
    }
  }
  return names;
}

function unionRefs(name: string): Set<string> {
  const union = schema.$defs[name];
  return new Set((union.oneOf as any[]).map((entry) => String(entry.$ref).replace("#/$defs/", "")));
}

describe("協定 schema 與範例", () => {
  it("產生的 TypeScript 和 Swift 與 schema 一致", () => {
    const temp = mkdtempSync(join(tmpdir(), "cardiary-protocol-"));
    try {
      const target = join(temp, "packages/protocol");
      mkdirSync(join(target, "schema"), { recursive: true });
      mkdirSync(join(target, "scripts"));
      cpSync(
        join(packageRoot, "schema/protocol.schema.json"),
        join(target, "schema/protocol.schema.json"),
      );
      cpSync(join(packageRoot, "scripts/generate.mjs"), join(target, "scripts/generate.mjs"));
      symlinkSync(join(packageRoot, "node_modules"), join(target, "node_modules"), "dir");
      execFileSync(process.execPath, [join(target, "scripts/generate.mjs")]);
      for (const path of [
        "packages/protocol/src/generated/protocol.ts",
        "apple/CardiaryKit/Sources/CardiaryKit/Generated/ProtocolTypes.swift",
      ]) {
        expect(readFileSync(join(temp, path), "utf8"), path).toBe(
          readFileSync(join(repoRoot, path), "utf8"),
        );
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it("白板範例同時符合領域規則，拒絕小數及超出安全範圍的格點", () => {
    const example = structuredClone(examples.boardSaveRequest);
    expect(validateClient(example)).toBe(true);
    expect(() => assertValidBoard({ board: example.payload.board })).not.toThrow();
    for (const value of [0.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = structuredClone(example);
      invalid.payload.board.items[0].position.x = value;
      expect(validateClient(invalid)).toBe(false);
      expect(() => assertValidBoard({ board: invalid.payload.board })).toThrow();
    }
  });

  it("每個範例都符合對應的影格 schema", () => {
    for (const [name, example] of Object.entries(examples)) {
      const validator = example.kind === "request" ? validateClient : validateServer;
      const valid = validator(example);
      expect(valid, `${name} 不符合 schema：\n${JSON.stringify(validator.errors, null, 2)}`).toBe(
        true,
      );
    }
  });

  it("schema 中的每個訊息型別至少有一個範例", () => {
    const types = collectTypeConstants();
    for (const type of types) {
      const hasExample = Object.values(examples).some((example) => example.type === type);
      expect(hasExample, `${type} 沒有範例`).toBe(true);
    }

    expect(Object.values(examples).some((example) => example.kind === "error")).toBe(true);
    for (const kind of ["request", "response", "event"]) {
      expect(
        Object.values(examples).some(
          (example) =>
            example.kind === kind &&
            typeof example.type === "string" &&
            example.type.startsWith("module."),
        ),
        `module ${kind} 沒有範例`,
      ).toBe(true);
    }
  });

  it("每個請求、回應與事件都列在對應的影格聯集", () => {
    const clientFrames = unionRefs("ClientFrame");
    const serverFrames = unionRefs("ServerFrame");

    for (const name of definitionNamesForKind("request")) {
      expect(clientFrames.has(name), `${name} 不在 ClientFrame`).toBe(true);
    }
    for (const kind of ["response", "event", "error"]) {
      for (const name of definitionNamesForKind(kind)) {
        expect(serverFrames.has(name), `${name} 不在 ServerFrame`).toBe(true);
      }
    }
  });

  it("拒絕版本、未知欄位與錯誤的列舉值", () => {
    const base = structuredClone(examples.helloRequest);
    base.v = 2;
    expect(validateClient(base)).toBe(false);

    const extra = structuredClone(examples.helloRequest);
    extra.unknownField = true;
    expect(validateClient(extra)).toBe(false);

    const missing = structuredClone(examples.helloRequest);
    delete missing.payload;
    expect(validateClient(missing)).toBe(false);

    const badDelivery = structuredClone(examples.sessionSendMessageRequest);
    badDelivery.payload.delivery = "fork";
    expect(validateClient(badDelivery)).toBe(false);

    // M1 新增的 steer 是合法值；插話語義見設計文件第 14.5 節。
    const steerDelivery = structuredClone(examples.sessionSendMessageRequest);
    steerDelivery.payload.delivery = "steer";
    expect(validateClient(steerDelivery)).toBe(true);

    const badKind = structuredClone(examples.cardCreateRequest);
    badKind.payload.kind = "whiteboard";
    expect(validateClient(badKind)).toBe(false);

    const patchWithoutBase = structuredClone(examples.cardPatchRequest);
    delete patchWithoutBase.payload.baseRevision;
    expect(validateClient(patchWithoutBase)).toBe(false);

    const badPatchFormat = structuredClone(examples.cardPatchRequest);
    badPatchFormat.payload.patch.format = "binary";
    expect(validateClient(badPatchFormat)).toBe(false);

    const badLayer = structuredClone(examples.contextGetResponse);
    badLayer.payload.context.entries[0].layer = "history";
    expect(validateServer(badLayer)).toBe(false);

    const deleteWithoutKey = structuredClone(examples.sessionDeleteRequest);
    delete deleteWithoutKey.payload.clientRequestId;
    expect(validateClient(deleteWithoutKey)).toBe(false);

    const badRoleMode = structuredClone(examples.systemModelsSetRequest);
    badRoleMode.payload.roles[0].mode = "inherit";
    expect(validateClient(badRoleMode)).toBe(false);

    const badLevel = structuredClone(examples.systemSettingsGetResponse);
    badLevel.payload.settings[0].level = "public";
    expect(validateServer(badLevel)).toBe(false);

    const badRole = structuredClone(examples.sessionGetHistoryResponse);
    badRole.payload.entries[0].role = "system";
    expect(validateServer(badRole)).toBe(false);

    const badModuleType = structuredClone(examples.moduleRequest);
    badModuleType.type = "cards.search";
    expect(validateClient(badModuleType)).toBe(false);
  });

  it("media.import 的 blobId 與文字替身狀態有固定形狀", () => {
    const missingBlob = structuredClone(examples.mediaImportRequest);
    delete missingBlob.payload.blobId;
    expect(validateClient(missingBlob)).toBe(false);

    const badBlob = structuredClone(examples.mediaImportRequest);
    badBlob.payload.blobId = "not-a-sha256";
    expect(validateClient(badBlob)).toBe(false);

    const badKind = structuredClone(examples.mediaImportResponse);
    badKind.payload.kind = "video";
    expect(validateServer(badKind)).toBe(false);

    const missingStandIn = structuredClone(examples.mediaImportResponse);
    delete missingStandIn.payload.textStandIn;
    expect(validateServer(missingStandIn)).toBe(false);

    const badSource = structuredClone(examples.mediaImportResponse);
    badSource.payload.textStandIn.sources.ocr = "remote";
    expect(validateServer(badSource)).toBe(false);

    const missingParts = structuredClone(examples.mediaImportResponse);
    missingParts.payload.textStandIn.missingParts = "no_shell";
    expect(validateServer(missingParts)).toBe(false);

    const missingDeduped = structuredClone(examples.mediaImportResponse);
    delete missingDeduped.payload.deduped;
    expect(validateServer(missingDeduped)).toBe(false);

    const unknownField = structuredClone(examples.mediaImportRequest);
    unknownField.payload.needAudio = true;
    expect(validateClient(unknownField)).toBe(false);
  });

  it("epoch 與 streaming 的必填與選填規則", () => {
    // hello 回應一定要帶 epoch：沒有它，客戶端無法判斷上次的事件歷史是否還連續。
    const helloWithoutEpoch = structuredClone(examples.helloResponse);
    delete helloWithoutEpoch.payload.epoch;
    expect(validateServer(helloWithoutEpoch)).toBe(false);

    const subscribeWithoutEpoch = structuredClone(examples.systemSubscribeResponse);
    delete subscribeWithoutEpoch.payload.epoch;
    expect(validateServer(subscribeWithoutEpoch)).toBe(false);

    const sessionSubscribeWithoutEpoch = structuredClone(examples.sessionSubscribeResponse);
    delete sessionSubscribeWithoutEpoch.payload.epoch;
    expect(validateServer(sessionSubscribeWithoutEpoch)).toBe(false);

    // 訂閱請求的 epoch 是選填；客戶端第一次連線時可以只帶 lastSeq 或都不帶。
    const requestWithoutEpoch = structuredClone(examples.sessionSubscribeRequest);
    delete requestWithoutEpoch.payload.epoch;
    expect(validateClient(requestWithoutEpoch)).toBe(true);

    // 快照的 streaming 是選填；進行中訊息的 messageId、turnId、text 與 startedAt 是必填。
    const snapshotWithoutStreaming = structuredClone(examples.sessionSubscribeResponse);
    delete snapshotWithoutStreaming.payload.snapshot.streaming;
    expect(validateServer(snapshotWithoutStreaming)).toBe(true);

    const streamingMissingTurnId = structuredClone(examples.sessionSubscribeResponse);
    delete streamingMissingTurnId.payload.snapshot.streaming.turnId;
    expect(validateServer(streamingMissingTurnId)).toBe(false);

    const streamingMissingText = structuredClone(examples.sessionSubscribeResponse);
    delete streamingMissingText.payload.snapshot.streaming.text;
    expect(validateServer(streamingMissingText)).toBe(false);

    const streamingWrongType = structuredClone(examples.sessionSubscribeResponse);
    streamingWrongType.payload.snapshot.streaming.truncated = "no";
    expect(validateServer(streamingWrongType)).toBe(false);
  });

  it("TurnError 的 details 只接受定義過的欄位與型別", () => {
    const withDetails = structuredClone(examples.streamTurnStateFailedEvent);
    expect(validateServer(withDetails)).toBe(true);
    expect(withDetails.payload.error.details.reason).toBe("quota_exceeded");

    const withoutDetails = structuredClone(examples.streamTurnStateFailedWithoutDetailsEvent);
    expect(validateServer(withoutDetails)).toBe(true);
    expect(withoutDetails.payload.error.details).toBeUndefined();

    // 三個欄位都是選填；只帶其中一個也合法。
    const reasonOnly = structuredClone(withDetails);
    reasonOnly.payload.error.details = { reason: "credential_missing" };
    expect(validateServer(reasonOnly)).toBe(true);

    const fieldOnly = structuredClone(withDetails);
    fieldOnly.payload.error.details = { field: "roles" };
    expect(validateServer(fieldOnly)).toBe(true);

    const unknownField = structuredClone(withDetails);
    unknownField.payload.error.details.apiKey = "secret";
    expect(validateServer(unknownField)).toBe(false);

    const wrongReason = structuredClone(withDetails);
    wrongReason.payload.error.details.reason = 42;
    expect(validateServer(wrongReason)).toBe(false);

    const negativeDelay = structuredClone(withDetails);
    negativeDelay.payload.error.details.retryAfterMs = -1;
    expect(validateServer(negativeDelay)).toBe(false);

    const fractionalDelay = structuredClone(withDetails);
    fractionalDelay.payload.error.details.retryAfterMs = 1.5;
    expect(validateServer(fractionalDelay)).toBe(false);

    const wrongField = structuredClone(withDetails);
    wrongField.payload.error.details.field = ["roles"];
    expect(validateServer(wrongField)).toBe(false);

    const stringDetails = structuredClone(withDetails);
    stringDetails.payload.error.details = "credential_invalid";
    expect(validateServer(stringDetails)).toBe(false);
  });

  it("schema 與設計文件沒有出現引擎的型別或欄位名稱", () => {
    // 設計文件（docs/design/protocol.md）不進版控：公開前重寫歷史後，公開 clone 與 CI 沒有這個檔案。
    // 這裡只把它當成額外的本機檢查，檔案不存在時略過；核心斷言（schema 本身）一定執行，
    // 不讓 CI 因為缺少未版控的私人文件而失敗，也不把 docs/ 加回版控。
    const designDocPath = `${repoRoot}/docs/design/protocol.md`;
    const sources: [string, string][] = [["schema", JSON.stringify(schema)]];
    if (existsSync(designDocPath)) {
      sources.push(["設計文件", readFileSync(designDocPath, "utf8")]);
    }
    const engineIdentifiers = [
      "@earendil-works",
      "observeCommits",
      "CommitPublication",
      "commitSeq",
      "whenBusy",
      "ConversationBusy",
      "InboxDoc",
      "harness",
      "sleepUntil",
      "defineDoc",
      "defineSignal",
      "ConversationTranscript",
      "NodeExecutionEnv",
      "createBashTool",
      "fauxProvider",
      "pi.agent",
      "pi.user",
      "pi.system",
      "pi.assistant",
      "pi.tool-result",
    ];

    for (const [label, source] of sources) {
      for (const identifier of engineIdentifiers) {
        expect(source.includes(identifier), `${label} 出現了引擎識別字 ${identifier}`).toBe(false);
      }
    }
  });
});
