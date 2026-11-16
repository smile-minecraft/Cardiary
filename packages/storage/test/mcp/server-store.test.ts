import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FolderLayout } from "../../src/paths.js";
import { McpServerStore } from "../../src/mcp/server-store.js";
import { createTempRoot, type TempRoot } from "../helpers/temp.js";

let temp: TempRoot | undefined;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

function makeStore(): { store: McpServerStore; root: string } {
  temp = createTempRoot("cardiary-mcp-store");
  mkdirSync(join(temp.folder, "state"), { recursive: true });
  return { store: new McpServerStore(new FolderLayout(temp.folder)), root: temp.folder };
}

describe("McpServerStore", () => {
  it("用原子寫入建立正本，不留暫存檔", async () => {
    const { store, root } = makeStore();
    const record = await store.add({
      name: "Local",
      transport: "stdio",
      command: "node",
      allowedHosts: [],
    });
    expect(record.serverId).toBe("local");
    const text = readFileSync(store.filePath, "utf8");
    expect(JSON.parse(text).servers).toHaveLength(1);
    expect(readdirSync(join(root, "state")).some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("serverId 衝突時加序號", async () => {
    const { store } = makeStore();
    const input = {
      name: "Same Server",
      transport: "stdio" as const,
      command: "node",
      allowedHosts: [],
    };
    const first = await store.add(input);
    const second = await store.add(input);
    expect(first.serverId).toBe("same-server");
    expect(second.serverId).toBe("same-server-2");
    expect(await store.list()).toHaveLength(2);
  });

  it("停用與移除都更新正本", async () => {
    const { store } = makeStore();
    const record = await store.add({
      name: "遠端",
      transport: "http",
      url: "https://api.example.com/mcp",
      allowedHosts: ["api.example.com"],
    });
    await store.setEnabled(record.serverId, false);
    expect((await store.get(record.serverId))?.enabled).toBe(false);
    expect(await store.remove(record.serverId)).toBe(true);
    expect(await store.get(record.serverId)).toBeNull();
  });
});
