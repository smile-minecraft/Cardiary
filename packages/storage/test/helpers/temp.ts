import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Storage, type OpenStorageOptions } from "../../src/index.js";

export interface TempRoot {
  readonly root: string;
  readonly folder: string;
  readonly home: string;
  readonly sysTmp: string;
  readonly out: string;
  cleanup(): void;
}

/** 每個測試自己的暫存根；`Cardiary/` 之外還有 home、sys-tmp、out。 */
export function createTempRoot(label = "cardiary"): TempRoot {
  const root = mkdtempSync(path.join(tmpdir(), `${label}-`));
  const folder = path.join(root, "Cardiary");
  const home = path.join(root, "home");
  const sysTmp = path.join(root, "sys-tmp");
  const out = path.join(root, "out");
  mkdirSync(folder);
  mkdirSync(home);
  mkdirSync(sysTmp);
  mkdirSync(out);
  return {
    root,
    folder,
    home,
    sysTmp,
    out,
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}

/** 開一個已初始化的 Storage；測試結束由呼叫端 close。 */
export function openTestStorage(
  temp: TempRoot,
  overrides: Partial<OpenStorageOptions> = {},
): Storage {
  return Storage.open({
    path: temp.folder,
    initialize: true,
    appVersion: "test",
    ...overrides,
  });
}
