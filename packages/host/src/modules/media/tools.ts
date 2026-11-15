import { createHash } from "node:crypto";

import type { JsonValue, ToolBundleDraft, ToolOutcome } from "@cardiary/engine-adapter";
import type { MediaService } from "./pipeline.js";
import { MediaError } from "./errors.js";

export const MEDIA_TOOL_BUNDLE_ID = "module.media";

/** 翻牌工具的權限分類；前方權限閘道用工具名稱對照，這裡只是宣告。 */
export const MEDIA_TOOL_POLICY = {
  card_flip: { approval: "auto", subjectField: "cardId" },
} as const;

export interface MediaToolsOptions {
  readonly media: MediaService;
}

/**
 * 翻牌工具。
 *
 * 預設只回文字替身；呼叫後才把原檔放進下一個模型請求。圖片一定先縮成
 * 固定規格；音訊一律回文字替身——Pi Durable 1.5.2 沒有音訊內容區塊，
 * 引擎送不出去，等引擎支援後再接原檔路徑。
 */
export function createMediaToolBundle(options: MediaToolsOptions): ToolBundleDraft {
  return {
    bundleId: MEDIA_TOOL_BUNDLE_ID,
    label: "多模態",
    tools: [
      {
        name: "card_flip",
        description:
          "翻牌：把圖片或音訊卡片載入下一個模型請求。圖片會縮成固定規格；" +
          "音訊一律回文字替身與原因，M1 的引擎沒有音訊內容區塊，送不出原檔。",
        parameters: {
          type: "object",
          properties: {
            cardId: { type: "string", description: "圖片或音訊卡片的識別碼。" },
            needAudio: {
              type: "boolean",
              description:
                "音訊卡片：是否要聽聲音細節；預設 false。M1 引擎不支援音訊輸入，" +
                "兩種情況都回文字替身，只有原因不同。",
              default: false,
            },
          },
          required: ["cardId"],
          additionalProperties: false,
        },
        replay: "safe",
        async execute(input, context): Promise<ToolOutcome> {
          try {
            const record = objectOf(input);
            const cardId = stringOf(record, "cardId");
            const needAudio = record["needAudio"] === true;
            const result = await options.media.flip({
              cardId,
              conversationId: context.conversationId,
              needAudio,
            });
            if (!result.loaded) {
              const text = result.text ?? "這張卡沒有可用的文字替身。";
              return {
                ok: true,
                content: [
                  {
                    type: "text",
                    text: `${text}\n\n（未載入原檔：${result.reason ?? "unknown"}）`,
                  },
                ],
                metadata: {
                  cardId,
                  loaded: false,
                  reason: result.reason ?? "unknown",
                  mediaType: result.mediaType,
                },
              };
            }
            const bytes = result.bytes;
            if (bytes === undefined) {
              return {
                ok: true,
                content: [{ type: "text", text: "已翻牌，但沒有可送出的位元組。" }],
                metadata: { cardId, loaded: true, mediaType: result.mediaType },
              };
            }
            const digest = createHash("sha256").update(bytes).digest("hex");
            const assetId = result.assetId ?? cardId;
            return {
              ok: true,
              content: [
                {
                  type: "text",
                  text: `已載入圖片原檔（${bytes.byteLength} bytes，sha256 ${digest}）。`,
                },
                {
                  type: "image" as const,
                  assetId,
                  mediaType: result.mediaType,
                  // 翻牌當下的縮圖位元組；轉接層原樣送給模型，不再重新編碼。
                  bytes,
                },
              ],
              metadata: {
                cardId,
                loaded: true,
                mediaType: result.mediaType,
                byteLength: bytes.byteLength,
                sha256: digest,
              },
            };
          } catch (error) {
            if (error instanceof MediaError) {
              return {
                ok: false,
                message: error.message,
                metadata: (error.details ?? null) as JsonValue,
              };
            }
            return {
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        },
      },
    ],
  };
}

function objectOf(input: JsonValue): { readonly [key: string]: JsonValue } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MediaError("invalid_message", "工具輸入必須是物件。");
  }
  return input as { readonly [key: string]: JsonValue };
}

function stringOf(input: { readonly [key: string]: JsonValue }, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new MediaError("invalid_message", `缺少或型別不符的欄位：${key}`, { field: key });
  }
  return value;
}
