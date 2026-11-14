import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { AssistantMessage, JsonObject, ToolCall } from "@earendil-works/pi-ai";

import type { EngineModelSource } from "../engine.js";
import type { ModelSettings } from "../model.js";
import type { JsonValue } from "../json.js";
import type { ToolName } from "../ids.js";

/** 由測試腳本餵入的模型回應；不連網、不需要金鑰。 */
export interface ScriptedModels {
  /** 交給 `EngineAdapterOptions.models`。 */
  readonly source: EngineModelSource;
  /** 追加一則純文字回應。 */
  text(content: string): void;
  /** 追加一則工具呼叫回應。 */
  toolCall(toolName: ToolName, input: JsonValue): void;
  /** 清空還沒用掉的回應。 */
  reset(): void;
}

/**
 * 可腳本化的模型來源。
 *
 * 正式產品由殼提供供應商 SDK 與金鑰；契約測試與端到端測試用這個來源，
 * 讓 Pi Durable 的轉接層跑真正的引擎，但模型回應是固定的。
 */
export function createScriptedModels(): ScriptedModels {
  const faux = fauxProvider();
  const queue: AssistantMessage[] = [];
  const flush = (): void => {
    faux.setResponses([...queue]);
  };
  return {
    source: {
      async open(): Promise<unknown> {
        const models = createModels();
        models.setProvider(faux.provider);
        flush();
        return models;
      },
      async close(): Promise<void> {
        // 沒有需要釋放的資源。
      },
    },
    text(content: string): void {
      queue.push(fauxAssistantMessage(content));
      flush();
    },
    toolCall(toolName: ToolName, input: JsonValue): void {
      queue.push(
        fauxAssistantMessage([fauxToolCall(toolName, input as JsonObject) as ToolCall], {
          stopReason: "toolUse",
        }),
      );
      flush();
    },
    reset(): void {
      queue.length = 0;
      flush();
    },
  };
}

/** 腳本化模型來源要用的 `ModelSettings`；provider 名稱固定是 `faux`。 */
export function scriptedModelSettings(): ModelSettings {
  const selection = { provider: "faux", model: "faux-1" };
  return {
    providers: [
      {
        provider: "faux",
        credentialRef: "test",
        models: [{ id: "faux-1", displayName: "Faux", contextWindow: 100000, input: ["text"] }],
      },
    ],
    roles: { main: selection, small: selection, writing: selection, "system-one": selection },
  };
}
