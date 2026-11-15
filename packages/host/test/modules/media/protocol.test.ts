import { afterEach, describe, expect, it } from "vitest";

import type { JsonValue } from "@cardiary/engine-adapter";
import type {
  ProtocolEventEmitter,
  ProtocolRequestContext,
  ProtocolRequestHandler,
} from "@cardiary/module-api";
import type { MediaImportResponsePayload } from "@cardiary/protocol";

import { ProtocolHandlerError } from "../../../src/modules/contract.js";
import { registerMediaProtocol } from "../../../src/modules/media/protocol.js";
import { fakeBroker, fakeModels, makeMediaFixture, type MediaFixture } from "./helpers.js";

const fixtures: MediaFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

async function fixture(): Promise<MediaFixture> {
  const created = await makeMediaFixture({
    recognition: fakeBroker({ ocr: { available: true, text: "預算 120 萬", locale: "zh-Hant" } }),
    models: fakeModels("白板上寫著預算。"),
  });
  fixtures.push(created);
  return created;
}

/** 只實作協定註冊；測試直接呼叫註冊進來的處理器。 */
function recordingProtocol(): {
  readonly protocol: ProtocolEventEmitter;
  handler(): ProtocolRequestHandler;
} {
  let registered: ProtocolRequestHandler | undefined;
  return {
    protocol: {
      emit: () => {},
      registerNamespace: (_key, handler) => {
        registered = handler;
        return { dispose: () => {} };
      },
      registerHttpRoute: () => {
        throw new Error("測試不註冊 HTTP 路由");
      },
    },
    handler: () => {
      if (registered === undefined) throw new Error("處理器沒有註冊");
      return registered;
    },
  };
}

function request(type: string, payload: Record<string, JsonValue>): ProtocolRequestContext {
  return { type, payload, clientId: "contract-test" };
}

async function importMedia(
  f: MediaFixture,
  payload: Record<string, JsonValue>,
): Promise<MediaImportResponsePayload> {
  const recording = recordingProtocol();
  registerMediaProtocol({ media: f.media, protocol: recording.protocol });
  return (await recording.handler()(
    request("media.import", payload),
  )) as unknown as MediaImportResponsePayload;
}

async function* chunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

function tinyPng(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

describe("media.import 協定處理器", () => {
  it("回卡片與文字替身狀態；文字替身來源與卡片內文一致", async () => {
    const f = await fixture();
    const blob = await f.store.put({ bytes: chunks(tinyPng()), mediaType: "image/png" });
    const response = await importMedia(f, { blobId: blob.blobId, title: "會議白板" });
    expect(response.cardId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(response.kind).toBe("image");
    expect(response.deduped).toBe(false);
    expect(response.textStandIn.sources).toEqual({
      ocr: "local",
      description: "small-model",
      transcript: "none",
      summary: "none",
    });
    expect(response.textStandIn.missingParts).toEqual([]);
  });

  it("同一個 blobId 重送回同一張卡，deduped 為 true", async () => {
    const f = await fixture();
    const blob = await f.store.put({ bytes: chunks(tinyPng()), mediaType: "image/png" });
    const first = await importMedia(f, { blobId: blob.blobId });
    const second = await importMedia(f, { blobId: blob.blobId });
    expect(second.cardId).toBe(first.cardId);
    expect(second.deduped).toBe(true);
  });

  it("未知的 blobId 回 not_found；格式錯誤回 invalid_message", async () => {
    const f = await fixture();
    await expect(importMedia(f, { blobId: "f".repeat(64) })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(importMedia(f, { blobId: "not-a-hash" })).rejects.toMatchObject({
      code: "invalid_message",
    });
    await expect(importMedia(f, {})).rejects.toMatchObject({ code: "invalid_message" });
  });

  it("沒有殼時仍回卡片，missingParts 說明缺少本機辨識", async () => {
    const created = await makeMediaFixture({ recognition: null, models: null });
    fixtures.push(created);
    const blob = await created.store.put({
      bytes: chunks(tinyPng()),
      mediaType: "image/png",
    });
    const response = await importMedia(created, { blobId: blob.blobId });
    expect(response.textStandIn.sources.ocr).toBe("none");
    expect(response.textStandIn.missingParts.join()).toContain("no_shell");
  });

  it("不認識的 media 型別回 not_found", async () => {
    const f = await fixture();
    const recording = recordingProtocol();
    registerMediaProtocol({ media: f.media, protocol: recording.protocol });
    await expect(
      recording.handler()(request("media.flip", { cardId: "x" })),
    ).rejects.toBeInstanceOf(ProtocolHandlerError);
  });
});
