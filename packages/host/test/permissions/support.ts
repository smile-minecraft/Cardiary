import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Storage } from "@cardiary/storage";

import { systemClock } from "../../src/ids.js";
import type { HostEngine } from "../../src/engine/types.js";
import type { TestFolder } from "../helpers.js";

export interface PermissionFixture {
  readonly root: string;
  readonly folder: string;
  readonly project: string;
  readonly outside: string;
  readonly storage: Storage;
  cleanup(): void;
}

/**
 * 一個真的 `state/cardiary.sqlite` 加上專案與外部目錄。
 *
 * 白名單的 SQL、`UNIQUE (tool_name, scope_key)` 與刪除流程都需要真的資料庫；
 * 用記憶體替身就測不到「刪對話、30 天保留後白名單仍在」。
 */
export function openPermissionFixture(): PermissionFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-host-perm-")));
  const folder = join(root, "Cardiary");
  const project = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(folder);
  mkdirSync(project);
  mkdirSync(outside);
  const storage = Storage.open({
    path: folder,
    initialize: true,
    appVersion: "test",
  });
  return {
    root,
    folder,
    project,
    outside,
    storage,
    cleanup: () => {
      storage.shutdown();
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

/** 主機測試用的資料夾身分；`startHost` 需要的形狀。 */
export function testFolder(fixture: PermissionFixture): TestFolder {
  return { path: fixture.folder, folderId: fixture.storage.folderId ?? "test-folder" };
}

/** 測試用的固定時鐘。 */
export { systemClock };

export type { HostEngine };
