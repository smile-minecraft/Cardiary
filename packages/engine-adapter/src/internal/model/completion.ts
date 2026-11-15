import { createModels, type Provider } from "@earendil-works/pi-ai";

import type { ModelProviderConfig, ProviderCredentialSource } from "../../model.js";
import { classifyModelFailure, type ModelFailure, type ModelFailureReason } from "./failure.js";
import { buildProviderForModels } from "./provider-source.js";

/**
 * 單次模型呼叫的接縫。
 *
 * 主機的 `ModelInvoker` 只認得「用哪個供應商與模型、送一段文字、拿回文字」；
 * 供應商型別、授權注入與錯誤分類都留在轉接層。模型集合不保存憑證：
 * 每次 `complete` 都經 `ProviderCredentialSource` 取一次金鑰。
 */
export interface ModelCompletionRequest {
  readonly provider: string;
  readonly model: string;
  readonly prompt: string;
  readonly system?: string;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

/** `stop` 是正常結束；`length` 代表輸出撞到上限；`error` 代表供應商失敗。 */
export type ModelCompletionStopReason = "stop" | "length" | "error";

export interface ModelCompletionResult {
  readonly text: string;
  readonly stopReason: ModelCompletionStopReason;
  /** 只有 `stopReason` 是 `error` 時才有值。 */
  readonly failure?: ModelFailure;
}

export interface ModelCompletion {
  complete(request: ModelCompletionRequest): Promise<ModelCompletionResult>;
  close(): Promise<void>;
}

export interface ModelCompletionOptions {
  /** 殼提供的憑證來源；只在請求當下呼叫。 */
  readonly credentials: ProviderCredentialSource;
  /** 這次呼叫可用的供應商；主機在設定變更後重建 completion。 */
  readonly providers: readonly ModelProviderConfig[];
}

/** 建立一個只給單次呼叫使用的模型集合；不含對話狀態，也不保存憑證。 */
export function createModelCompletion(options: ModelCompletionOptions): ModelCompletion {
  const models = createModels();
  for (const provider of options.providers) {
    const built = buildProviderForModels(provider, options.credentials);
    if (built !== null) {
      models.setProvider(built as Provider<"openai-completions">);
    }
  }

  return {
    async complete(request) {
      const model = models.getModel(request.provider, request.model);
      if (model === undefined) {
        return failure("model_not_configured");
      }
      try {
        const message = await models.complete(
          model,
          {
            messages: [
              {
                role: "user",
                content: request.prompt,
                timestamp: Date.now(),
              },
            ],
            ...(request.system === undefined ? {} : { system: request.system }),
          },
          {
            ...(request.maxOutputTokens === undefined
              ? {}
              : { maxTokens: request.maxOutputTokens }),
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        const text = message.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => block.text)
          .join("");
        if (message.stopReason === "error") {
          return {
            text,
            stopReason: "error",
            failure: classifyModelFailure(message.errorMessage),
          };
        }
        return {
          text,
          stopReason: message.stopReason === "length" ? "length" : "stop",
        };
      } catch (error) {
        return {
          text: "",
          stopReason: "error",
          failure: classifyModelFailure(error instanceof Error ? error.message : String(error)),
        };
      }
    },
    async close() {
      // 模型集合沒有外部資源；憑證也不在集合裡。
    },
  };
}

function failure(reason: ModelFailureReason): ModelCompletionResult {
  return { text: "", stopReason: "error", failure: classifyModelFailure(reason) };
}
