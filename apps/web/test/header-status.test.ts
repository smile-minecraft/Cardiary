import { describe, expect, it } from "vitest";

import { headerStatus } from "../src/screens/header-status";

describe("頁首的連線狀態", () => {
  it("沒有 Token 時顯示尚未配對，不顯示重新連線", () => {
    const status = headerStatus({ needsPairing: true, connectionStatus: "disconnected" }, "zh-TW");
    expect(status.state).toBe("unpaired");
    expect(status.label).toBe("尚未配對");
    expect(status.label).not.toContain("連線中斷");
    expect(status.dotClass).toBe("status-dot");
  });

  it("有 Token 但斷線時才顯示重新連線", () => {
    const status = headerStatus({ needsPairing: false, connectionStatus: "disconnected" }, "zh-TW");
    expect(status.state).toBe("reconnecting");
    expect(status.label).toBe("連線中斷，重新連線中…");
  });

  it("連線中與已連線各自顯示對應文字", () => {
    expect(headerStatus({ needsPairing: false, connectionStatus: "connecting" }, "zh-TW")).toEqual({
      state: "connecting",
      label: "連線中…",
      dotClass: "status-dot is-connecting",
    });
    expect(headerStatus({ needsPairing: false, connectionStatus: "connected" }, "zh-TW")).toEqual({
      state: "connected",
      label: "已連線",
      dotClass: "status-dot is-connected",
    });
  });

  it("英文介面也有未配對的字串", () => {
    const status = headerStatus({ needsPairing: true, connectionStatus: "disconnected" }, "en");
    expect(status.label).toBe("Not paired");
  });
});
