/*
standalone-websocket-proxy.test.ts: Proxying websockets over HTTP with a standalone HTTP server.

pnpm test ./standalone-websocket-proxy.test.ts
*/

import * as httpProxy from "../..";
import getPort from "../get-port";
import { once } from "../wait";
import http, { createServer } from "http";
import { Server } from "socket.io";
import { io as socketioClient } from "socket.io-client";

describe("Proxying websockets over HTTP with a standalone HTTP server.", () => {
  let ports: Record<'ws' | 'proxy', number>;
  it("assigns ports", async () => {
    ports = { ws: await getPort(), proxy: await getPort() };
  });

  let servers: { ws: Server, proxyServer: http.Server } = {} as any;

  it("Create the target websocket server", async () => {
    const io = new Server();
    servers.ws = io;
    io.on("connection", (client) => {
      client.on("message", () => {
        client.send("from server");
      });
    });
    io.listen(ports.ws);
  });

  let proxy: httpProxy.ProxyServer;
  it("Setup our proxy server to proxy standard HTTP requests", async () => {
    proxy = httpProxy.createProxyServer({
      target: {
        host: "localhost",
        port: ports.ws,
      },
    });

    servers.proxyServer = createServer((req, res) => {
      proxy.web(req, res);
    });
  });

  it("Listen to the `upgrade` event and proxy the WebSocket requests as well.", async () => {
    servers.proxyServer.on("upgrade", (req, socket, head) => {
      proxy.ws(req, socket, head);
    });
    servers.proxyServer.listen(ports.proxy);
  });

  it("Create client and test the proxy server directly", async () => {
    const client = socketioClient(`ws://localhost:${ports.proxy}`);
    const t = Date.now();
    client.send("I am the client");
    const msg = await once(client as any, "message");
    expect(Math.abs(Date.now() - t)).toBeLessThan(500);
    expect(msg).toEqual(["from server"]);
    client.close();
  });

  it("cleans up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
