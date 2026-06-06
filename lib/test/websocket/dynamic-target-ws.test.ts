/*
Test dynamic target function with WebSocket proxying

DEVELOPMENT:

 pnpm test dynamic-target-ws.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import { once } from "node:events";
import { describe, it, beforeAll, afterAll, expect } from "vitest";

describe("dynamic target function with WebSocket", () => {
  let ports: Record<"ws1" | "ws2" | "proxy", number>;
  beforeAll(async () => {
    ports = {
      ws1: await getPort(),
      ws2: await getPort(),
      proxy: await getPort(),
    };
  });

  let servers: Record<string, http.Server | httpProxy.ProxyServer> = {};

  it("create two target WS echo servers", async () => {
    const s1 = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ws1");
    });
    s1.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Web Socket Protocol Handshake\r\n" +
          "Upgrade: WebSocket\r\n" +
          "Connection: Upgrade\r\n" +
          "X-Target: ws1\r\n" +
          "\r\n",
      );
      socket.pipe(socket);
    });
    s1.listen(ports.ws1);
    servers.ws1 = s1;

    const s2 = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ws2");
    });
    s2.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Web Socket Protocol Handshake\r\n" +
          "Upgrade: WebSocket\r\n" +
          "Connection: Upgrade\r\n" +
          "X-Target: ws2\r\n" +
          "\r\n",
      );
      socket.pipe(socket);
    });
    s2.listen(ports.ws2);
    servers.ws2 = s2;
  });

  it("create proxy with dynamic WS target function", async () => {
    servers.proxy = httpProxy
      .createServer({
        ws: true,
        target: (req: http.IncomingMessage) => {
          if (req.url?.startsWith("/ws2")) {
            return `ws://localhost:${ports.ws2}`;
          }
          return `ws://localhost:${ports.ws1}`;
        },
      })
      .listen(ports.proxy);
  });

  it("upgrade through proxy to ws1", async () => {
    const options = {
      port: ports.proxy,
      host: "localhost",
      path: "/ws1",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    const req = http.request(options);
    req.end();
    const [res] = await once(req, "upgrade");
    expect(res.headers["x-target"]).toBe("ws1");
    res.socket.end();
  });

  it("upgrade through proxy to ws2", async () => {
    const options = {
      port: ports.proxy,
      host: "localhost",
      path: "/ws2",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    const req = http.request(options);
    req.end();
    const [res] = await once(req, "upgrade");
    expect(res.headers["x-target"]).toBe("ws2");
    res.socket.end();
  });

  afterAll(() => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
