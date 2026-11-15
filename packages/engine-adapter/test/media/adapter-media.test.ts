import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  ImageContent,
  Message,
  TextContent,
  ToolCall,
  UserMessage,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  createEngineAdapter,
  createInMemoryApprovalLedger,
  type EngineAdapter,
  type EngineEnvironment,
  type EngineModelSource,
  type ToolDefinition,
} from "../../src/index.js";
import type { MediaAssetReader } from "../../src/internal/media/content.js";
import { bundleOf, silentLogger, waitFor } from "../support.js";

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const SELECTION = { provider: "faux", model: "faux-1" } as const;
const ROLES = { main: SELECTION, small: SELECTION, writing: SELECTION, "system-one": SELECTION };

interface MediaFixture {
  readonly adapter: EngineAdapter;
  readonly faux: ReturnType<typeof fauxProvider>;
  readonly root: string;
  close(): Promise<void>;
}

async function createMediaFixture(
  input: readonly ("text" | "image" | "audio")[],
): Promise<MediaFixture> {
  const root = await mkdtemp(join(tmpdir(), "cardi-media-"));
  const environment: EngineEnvironment = {
    stateDir: join(root, "state"),
    tempDir: join(root, "tmp"),
    defaultWorkingDir: join(root, "work"),
  };
  const faux = fauxProvider();
  const modelSource: EngineModelSource = {
    async open() {
      const models = createModels();
      models.setProvider(faux.provider);
      return models;
    },
    async close() {},
  };
  const reader: MediaAssetReader = {
    // 翻牌應該用工具帶來的縮圖位元組；這個不同的值用來抓出誤用媒體服務的情況。
    read: (assetId) =>
      assetId === "asset-1"
        ? { bytes: Uint8Array.from([0xff, 0xd8, 0xff]), mediaType: "image/jpeg" }
        : null,
  };
  const adapter = createEngineAdapter({
    environment,
    approvals: createInMemoryApprovalLedger(),
    permissionGate: { evaluate: async () => ({ kind: "allow" }) },
    credentials: { resolve: async () => ({ provider: "faux", kind: "none", secret: "" }) },
    logger: silentLogger,
    models: modelSource,
    media: reader,
  });
  await adapter.open();
  await adapter.configureModels({
    providers: [
      {
        provider: "faux",
        credentialRef: "test",
        models: [
          {
            id: "faux-1",
            displayName: "Faux",
            contextWindow: 100000,
            input: [...input],
          },
        ],
      },
    ],
    roles: ROLES,
  });
  return {
    adapter,
    faux,
    root,
    async close() {
      await adapter.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function flipTool(): ToolDefinition {
  return {
    name: "card_flip",
    description: "測試用翻牌",
    replay: "safe",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return {
        ok: true,
        content: [{ type: "image", assetId: "asset-1", mediaType: "image/png", bytes: PNG_BYTES }],
      };
    },
  };
}

function imagesIn(messages: readonly Message[]): string[] {
  const images: string[] = [];
  for (const message of messages) {
    if (
      (message.role !== "toolResult" && message.role !== "user") ||
      typeof message.content === "string"
    ) {
      continue;
    }
    for (const block of message.content) {
      if (block.type === "image") {
        images.push(block.data);
      }
    }
  }
  return images;
}

async function waitForAssistant(
  adapter: EngineAdapter,
  conversationId: string,
  text: string,
): Promise<void> {
  await waitFor(async () => {
    const conversation = await adapter.getConversation(conversationId);
    if (conversation?.state !== "idle") {
      return undefined;
    }
    const history = await adapter.readConversationHistory({ conversationId });
    const assistant = [...history.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const content = assistant?.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    return content?.includes(text) === true ? true : undefined;
  }, `回合完成：${text}`);
}

describe("引擎的媒體內容區塊", () => {
  it("翻牌兩次送給模型的圖片位元組完全相同", async () => {
    const fixture = await createMediaFixture(["text", "image"]);
    try {
      await fixture.adapter.tools.register(bundleOf("test.media", [flipTool()], 1));
      const conversation = await fixture.adapter.createConversation({
        model: SELECTION,
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.media", generation: 1 }],
      });

      const seen: string[][] = [];
      const record = (context: { readonly messages: readonly Message[] }): void => {
        seen.push(imagesIn(context.messages));
      };
      fixture.faux.setResponses([
        (context) => {
          record(context);
          return fauxAssistantMessage([fauxToolCall("card_flip", {}) as ToolCall], {
            stopReason: "toolUse",
          });
        },
        (context) => {
          record(context);
          return fauxAssistantMessage("第一次完成");
        },
        (context) => {
          record(context);
          return fauxAssistantMessage([fauxToolCall("card_flip", {}) as ToolCall], {
            stopReason: "toolUse",
          });
        },
        (context) => {
          record(context);
          return fauxAssistantMessage("第二次完成");
        },
      ]);

      for (const label of ["第一次完成", "第二次完成"]) {
        await fixture.adapter.sendMessage({
          conversationId: conversation.id,
          content: [{ type: "text", text: "翻牌" }],
          delivery: "queue",
          sender: { kind: "human", clientId: "test" },
        });
        await waitForAssistant(fixture.adapter, conversation.id, label);
      }

      const onWire = seen.flat();
      expect(onWire.length).toBeGreaterThanOrEqual(2);
      expect(new Set(onWire)).toEqual(new Set([Buffer.from(PNG_BYTES).toString("base64")]));
    } finally {
      await fixture.close();
    }
  }, 30000);

  it("使用者訊息帶圖片時，由媒體服務讀到的位元組原樣送進模型", async () => {
    const fixture = await createMediaFixture(["text", "image"]);
    try {
      const conversation = await fixture.adapter.createConversation({
        model: SELECTION,
        systemContext: "前綴",
        toolBundles: [],
      });

      let userContent: UserMessage["content"] | undefined;
      fixture.faux.setResponses([
        (context) => {
          const message = context.messages.find((entry) => entry.role === "user");
          userContent =
            message !== undefined && message.role === "user" ? message.content : undefined;
          return fauxAssistantMessage("看到了");
        },
      ]);

      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "image", assetId: "asset-1", mediaType: "image/png" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      await waitForAssistant(fixture.adapter, conversation.id, "看到了");

      const image = (Array.isArray(userContent) ? userContent : []).find(
        (block) => block.type === "image",
      );
      expect(image).toEqual({
        type: "image",
        // fixture 的媒體服務回 JPEG 標記；重點是送出的就是服務給的位元組。
        data: Buffer.from([0xff, 0xd8, 0xff]).toString("base64"),
        mimeType: "image/jpeg",
      });
    } finally {
      await fixture.close();
    }
  }, 30000);

  it("模型不支援圖片時工具結果是文字替身與原因，回合仍完成", async () => {
    const fixture = await createMediaFixture(["text"]);
    try {
      await fixture.adapter.tools.register(bundleOf("test.media", [flipTool()], 1));
      const conversation = await fixture.adapter.createConversation({
        model: SELECTION,
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.media", generation: 1 }],
      });

      let toolResult: readonly (TextContent | ImageContent)[] | undefined;
      fixture.faux.setResponses([
        () =>
          fauxAssistantMessage([fauxToolCall("card_flip", {}) as ToolCall], {
            stopReason: "toolUse",
          }),
        (context) => {
          const message = context.messages.find((entry) => entry.role === "toolResult");
          toolResult =
            message !== undefined && message.role === "toolResult" ? message.content : undefined;
          return fauxAssistantMessage("完成");
        },
      ]);

      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "翻牌" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      await waitForAssistant(fixture.adapter, conversation.id, "完成");

      expect(toolResult?.some((block) => block.type === "image")).toBe(false);
      const text = (toolResult ?? [])
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n");
      expect(text).toContain("主模型不支援圖片輸入");
      expect(text).toContain("未送出原檔");
    } finally {
      await fixture.close();
    }
  }, 30000);

  it("使用者訊息帶音訊時回文字替身，不讓回合失敗", async () => {
    const fixture = await createMediaFixture(["text", "audio"]);
    try {
      const conversation = await fixture.adapter.createConversation({
        model: SELECTION,
        systemContext: "前綴",
        toolBundles: [],
      });

      let userContent: UserMessage["content"] | undefined;
      fixture.faux.setResponses([
        (context) => {
          const message = context.messages.find((entry) => entry.role === "user");
          userContent =
            message !== undefined && message.role === "user" ? message.content : undefined;
          return fauxAssistantMessage("收到");
        },
      ]);

      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [
          { type: "text", text: "聽一下" },
          { type: "audio", assetId: "audio-1", mediaType: "audio/mp4" },
        ],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      await waitForAssistant(fixture.adapter, conversation.id, "收到");

      const text =
        typeof userContent === "string"
          ? userContent
          : (userContent ?? [])
              .map((block) => (block.type === "text" ? block.text : ""))
              .join("\n");
      expect(text).toContain("引擎 1.5.2 沒有音訊內容區塊");
      expect(
        Array.isArray(userContent) && userContent.some((block) => block.type === "image"),
      ).toBe(false);
    } finally {
      await fixture.close();
    }
  }, 30000);
});
