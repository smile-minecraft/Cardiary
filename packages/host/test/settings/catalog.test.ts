import { describe, expect, it } from "vitest";

import { manifest as cards } from "../../src/modules/cards/manifest.js";
import { manifest as context } from "../../src/modules/context/manifest.js";
import { manifest as dealing } from "../../src/modules/dealing/manifest.js";
import { manifest as importModule } from "../../src/modules/import/manifest.js";
import { manifest as lifecycle } from "../../src/modules/lifecycle/manifest.js";
import { manifest as localTools } from "../../src/modules/local-tools/manifest.js";
import { manifest as media } from "../../src/modules/media/manifest.js";
import { manifest as memory } from "../../src/modules/memory/manifest.js";
import { manifest as scheduler } from "../../src/modules/scheduler/manifest.js";
import { manifest as settings } from "../../src/modules/settings/manifest.js";
import { manifest as storage } from "../../src/modules/storage/manifest.js";
import {
  HUMAN_ONLY_SETTING_KEYS,
  SETTING_DEFINITIONS,
  settingDefinition,
  settingLevel,
} from "../../src/settings/catalog.js";

const MANIFESTS = [
  cards,
  context,
  dealing,
  importModule,
  lifecycle,
  localTools,
  media,
  memory,
  scheduler,
  settings,
  storage,
];

describe("設定目錄", () => {
  it("每個第一方模組的每個設定項都有明確等級，且目錄登記同一個等級", () => {
    const declared = MANIFESTS.flatMap((manifest) =>
      manifest.settings.map((setting) => ({ moduleId: manifest.id, setting })),
    );
    expect(declared.length).toBeGreaterThan(0);
    for (const { moduleId, setting } of declared) {
      expect(setting.level, `${moduleId}/${setting.key}`).toBeDefined();
      const definition = settingDefinition(setting.key);
      expect(definition, `${moduleId}/${setting.key} 不在設定目錄`).toBeDefined();
      expect(definition?.level, `${moduleId}/${setting.key}`).toBe(setting.level);
      expect(settingLevel(setting.key, "human-only"), `${moduleId}/${setting.key}`).toBe(
        setting.level,
      );
    }
  });

  it("目錄沒有重複鍵，所有項目都有合法等級", () => {
    const keys = SETTING_DEFINITIONS.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const definition of SETTING_DEFINITIONS) {
      expect(["free", "approval", "human-only"]).toContain(definition.level);
    }
  });

  it("只限人類的鍵全部標成 human-only", () => {
    for (const key of HUMAN_ONLY_SETTING_KEYS) {
      expect(settingDefinition(key)?.level, key).toBe("human-only");
    }
  });

  it("沒有登記的鍵只能用呼叫端提供的保守預設", () => {
    expect(settingDefinition("unknown.setting")).toBeUndefined();
    expect(settingLevel("unknown.setting", "human-only")).toBe("human-only");
  });
});
