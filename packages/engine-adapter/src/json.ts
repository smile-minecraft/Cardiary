/** JSON 可表示的值；工具輸入、工具輸出與協定酬載共用這個型別。 */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * 工具參數使用的 JSON Schema 子集。
 *
 * 只涵蓋模型填寫物件參數需要的關鍵字；需要完整 draft 版本時再擴充，
 * 不要直接引用特定 schema 套件的型別。
 */
export interface JsonSchema {
  readonly type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  readonly title?: string;
  readonly description?: string;
  readonly properties?: { readonly [key: string]: JsonSchema };
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly JsonValue[];
  readonly default?: JsonValue;
  readonly additionalProperties?: boolean | JsonSchema;
}
