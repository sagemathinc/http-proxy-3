/*
pnpm test simple-websocket-proxy.test.ts

A websocket proxy test that just uses basic nodejs without socketio to keep
things low level.

See https://nodejs.org/api/http.html#event-upgrade

DEVELOPMENT:

 pnpm test simple-websocket-proxy.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import log from "../log";
import getPort from "../get-port";
import { once } from "node:events";

describe("Example of simple proxying of a WebSocket", () => {
  let ports: Record<'ws' | 'proxy', number>;
  it("assigns ports", async () => {
    ports = { ws: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};

  it("Create the target websocket server", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("okay");
    });
    servers.ws = server;
    server.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Web Socket Protocol Handshake\r\n" +
          "Upgrade: WebSocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
      socket.pipe(socket); // echo back
    });
    server.listen(ports.ws);
  });

  it("Create a websocket client and test the ws server directly", async () => {
    const options = {
      port: ports.ws,
      host: "localhost",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    const req = http.request(options);
    req.end();
    const [res] = await once(req, "upgrade");
    res.socket.end();
    log("we successfully upgraded and created a websocket.");
  });

  it("Create a proxy server pointed at the websocket server", async () => {
    servers.proxy = httpProxy
      .createServer({ target: `ws://localhost:${ports.ws}`, ws: true })
      .listen(ports.proxy);
  });

  it("Create a websocket client and test the proxy server", async () => {
    const options = {
      port: ports.proxy,
      host: "localhost",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    const req = http.request(options);
    req.end();
    const [res] = await once(req, "upgrade");
    res.socket.end();
    log(
      "we successfully upgraded and created a websocket pointed at the PROXY!",
    );
  });

  it("cleans up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
