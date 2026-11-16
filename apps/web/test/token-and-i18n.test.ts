import { describe, expect, it } from "vitest";

import { detectLanguage, dictionaries, translate } from "../src/i18n";
import { DeviceTokenStore, type KeyValueStorage } from "../src/net/device-token";

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("DeviceTokenStore", () => {
  it("預設把 Token 放 sessionStorage，另一邊保持空白", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    const store = new DeviceTokenStore(session, local);
    store.save("token-1", false);
    expect(session.getItem("cardiary.deviceToken")).toBe("token-1");
    expect(local.getItem("cardiary.deviceToken")).toBeNull();
    expect(store.load()).toBe("token-1");
  });

  it("勾選記住這個裝置才放 localStorage，並清掉 sessionStorage", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    const store = new DeviceTokenStore(session, local);
    store.save("token-1", false);
    store.save("token-1", true);
    expect(session.getItem("cardiary.deviceToken")).toBeNull();
    expect(local.getItem("cardiary.deviceToken")).toBe("token-1");
  });

  it("登出清掉兩邊的 Token", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    const store = new DeviceTokenStore(session, local);
    store.save("token-1", true);
    store.clear();
    expect(store.load()).toBeNull();
  });

  it("instanceId 只在第一次產生", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    const store = new DeviceTokenStore(session, local);
    expect(store.instanceId(() => "fixed-id")).toBe("fixed-id");
    expect(store.instanceId(() => "another-id")).toBe("fixed-id");
  });
});

describe("雙語", () => {
  it("瀏覽器 zh 開頭用繁中，其他用英文", () => {
    expect(detectLanguage("zh-TW", null)).toBe("zh-TW");
    expect(detectLanguage("zh-CN", null)).toBe("zh-TW");
    expect(detectLanguage("en-US", null)).toBe("en");
    expect(detectLanguage(undefined, null)).toBe("en");
  });

  it("手動選擇的語言優先於瀏覽器語言", () => {
    expect(detectLanguage("en-US", "zh-TW")).toBe("zh-TW");
    expect(detectLanguage("zh-TW", "en")).toBe("en");
  });

  it("每則字串都有繁中與英文版，且可以代換變數", () => {
    const zhKeys = Object.keys(dictionaries["zh-TW"]).sort();
    const enKeys = Object.keys(dictionaries.en).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(translate("zh-TW", "pairing.codeLabel")).toBe("核對短碼");
    expect(translate("en", "pairing.codeLabel")).toBe("Verification code");
    expect(translate("zh-TW", "notifications.unread", { count: 3 })).toBe("未讀 3 則");
    expect(translate("en", "notifications.unread", { count: 3 })).toBe("3 unread");
  });
});
