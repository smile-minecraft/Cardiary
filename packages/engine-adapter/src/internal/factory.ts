import type { EngineAdapter, EngineAdapterOptions } from "../engine.js";
import { PiEngineAdapter } from "./adapter.js";

/** 建立 Pi Durable 的轉接層；主機服務只呼叫這一個函式。 */
export function createEngineAdapter(options: EngineAdapterOptions): EngineAdapter {
  return new PiEngineAdapter(options);
}
