import { createServer, type AddressInfo, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { TestClient, startTestHost, type TestHost } from "../helpers.js";

const hosts: TestHost[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.close();
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** 佔住兩個相鄰的埠，讓閘道至少要多跳兩號。 */
async function occupyConsecutivePorts(): Promise<number> {
  for (;;) {
    const first = await listen(0);
    const port = (first.address() as AddressInfo).port;
    if (port >= 65_535) {
      await new Promise<void>((resolve) => first.close(() => resolve()));
      continue;
    }
    try {
      const second = await listen(port + 1);
      servers.push(first, second);
      return port;
    } catch {
      await new Promise<void>((resolve) => first.close(() => resolve()));
    }
  }
}

describe("服務埠", () => {
  it("偏好埠與下一個埠被占用時往上找，回報的埠可以連線", async () => {
    const preferred = await occupyConsecutivePorts();
    const host = await startTestHost({ port: preferred });
    hosts.push(host);

    expect(host.host.port).toBeGreaterThanOrEqual(preferred + 2);
    expect(host.url).toContain(`:${host.host.port}/`);

    const client = await TestClient.connect(host.url);
    const helloId = await client.hello(host.token);
    expect((await client.waitForReply(helloId)).kind).toBe("response");
    await client.close();
  });
});
