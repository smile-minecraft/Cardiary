import type { EngineLogger } from "@cardiary/engine-adapter";
import type { JsonValue } from "@cardiary/engine-adapter";

export interface LogFields {
  readonly [key: string]: JsonValue;
}

/** 服務日誌：一律寫 stderr，不碰 stdout（stdout 是協定與控制通道）。 */
export class StderrLogger implements EngineLogger {
  readonly #scope: string;

  constructor(scope = "host") {
    this.#scope = scope;
  }

  #write(level: string, message: string, fields?: LogFields): void {
    const entry: Record<string, unknown> = {
      at: new Date().toISOString(),
      level,
      scope: this.#scope,
      message,
    };
    if (fields) Object.assign(entry, fields);
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  }

  debug(message: string, fields?: LogFields): void {
    this.#write("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.#write("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.#write("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.#write("error", message, fields);
  }
}

/** 不輸出任何東西的日誌；測試與內嵌使用。 */
export class SilentLogger implements EngineLogger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
