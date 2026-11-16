import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../../storage/src/settings.js";
import { openStateDatabase } from "../../storage/src/state-schema.js";
import { SettingsService } from "../../host/src/settings/service.js";
import { TransactionalSettingsStore } from "../../host/src/settings/store.js";
import { createTempRoot } from "../../storage/test/helpers/temp.js";

describe("模組設定變更通知", () => {
  it("兩個服務使用同一個資料庫時，寫入會通知另一個服務", () => {
    const temp = createTempRoot("settings-bridge");
    mkdirSync(join(temp.folder, "state"), { recursive: true });
    const { db } = openStateDatabase({
      filePath: join(temp.folder, "state", "cardiary.sqlite"),
      appVersion: "0.1.0",
    });
    try {
      const storage = new SettingsStore(db);
      const reader = new SettingsService(new TransactionalSettingsStore(db, storage));
      const writer = new SettingsService(new TransactionalSettingsStore(db, storage));
      const received: unknown[] = [];
      const unsubscribe = reader.onChange((change) => received.push(change));
      expect(reader.get("retrieval.allowModelDownload")).toBe(false);
      writer.set({ key: "retrieval.allowModelDownload", value: true, actor: "user:client" });
      expect(reader.get("retrieval.allowModelDownload")).toBe(true);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        previous: false,
        item: { key: "retrieval.allowModelDownload", value: true },
        changedBy: "user:client",
      });
      unsubscribe();
    } finally {
      db.close();
      temp.cleanup();
    }
  });
});
