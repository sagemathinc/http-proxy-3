/*
latent-websocket-proxy.test.ts: Proxying websockets over HTTP with a standalone HTTP server.

pnpm test latent-websocket-proxy.test.ts
*/

import * as httpProxy from "../..";
import getPort from "../get-port";
import { once } from "node:events";
import http, { createServer } from "node:http";
import { Server } from "socket.io";
import { io as socketioClient } from "socket.io-client";
import { describe, it, expect, afterAll, beforeAll } from 'vitest';

describe("Proxying websockets over HTTP with a standalone HTTP server.", () => {
  let ports: Record<'ws' | 'proxy', number>;
  beforeAll( async () => {
    // assigns ports
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

  const LATENCY = 200;

  it("Listen to the `upgrade` event and proxy the WebSocket requests as well.", async () => {
    servers.proxyServer!.on("upgrade", (req, socket, head) => {
      if (hangForever) return;
      setTimeout(() => {
        proxy.ws(req, socket, head);
      }, LATENCY);
    });
    servers.proxyServer!.listen(ports.proxy);
  });

  it("Create client and test the proxy server directly", async () => {
    const t = Date.now();
    const client = socketioClient(`ws://localhost:${ports.proxy}`, {
      // We *must* use the websocket transport of socketio will fall back
      // to a different protocol and work very quickly anyways! See below.
      transports: ["websocket"],
    });
    client.send("I am the client");
    const msg = await once(client as any, "message");
    expect(msg).toEqual(["from server"]);
    expect(Math.abs(Date.now() - t)).toBeGreaterThan(LATENCY);
    client.close();
  });

  let hangForever = false;
  it("Illustrate that the socketio client is very clever if we don't specify the protocol", async () => {
    hangForever = true;
    const t = Date.now();
    const client = socketioClient(`ws://localhost:${ports.proxy}`);
    client.send("I am the client");
    const msg = await once(client as any, "message");
    expect(msg).toEqual(["from server"]);
    expect(Math.abs(Date.now() - t)).toBeLessThan(500);
    client.close();
  });

  afterAll(async () => {
    // cleans up
    Object.values(servers).map((x: any) => x?.close());
  });
});
