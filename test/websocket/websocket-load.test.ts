/*

pnpm test websocket-load.test.ts

*/

import * as http from "http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import wait, { once } from "../wait";

describe("Load testing proxying a WebSocket", () => {
  let ports;
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

  it("Create a proxy server pointed at the websocket server", async () => {
    servers.proxy = httpProxy
      .createServer({ target: `ws://localhost:${ports.ws}`, ws: true })
      .listen(ports.proxy);
  });

  const LATENCY = 250;
  const COUNT = 250;

  it(`Serial test ${COUNT} times plain websocket server`, async () => {
    const t = Date.now();
    await loadTestWebsocketServerSerial({ port: ports.ws, count: COUNT });
    const elapsed = Date.now() - t;
    expect(elapsed).toBeLessThan(LATENCY + COUNT * 5);
  });

  it(`Parallel test ${COUNT} times plain websocket server`, async () => {
    const t = Date.now();
    await loadTestWebsocketServerSerial({
      port: ports.ws,
      count: COUNT,
      parallel: true,
    });
    const elapsed = Date.now() - t;
    expect(elapsed).toBeLessThan(LATENCY + COUNT * 5);
  });

  it(`Serial test ${COUNT} times proxy server`, async () => {
    const t = Date.now();
    await loadTestWebsocketServerSerial({ port: ports.proxy, count: COUNT });
    const elapsed = Date.now() - t;
    expect(elapsed).toBeLessThan(LATENCY + COUNT * 5);
    // confirm that there are no socket leaks -- we have to wait since the sockets aren't
    // freed instantly -- last few bytes get sent.
    await wait({ until: () => httpProxy.numOpenSockets() == 0 });
    expect(httpProxy.numOpenSockets()).toBe(0);
  });

  it(`Parallel test ${COUNT} times proxy server`, async () => {
    const t = Date.now();
    await loadTestWebsocketServerSerial({
      port: ports.proxy,
      count: COUNT,
      parallel: true,
    });
    const elapsed = Date.now() - t;
    expect(elapsed).toBeLessThan(LATENCY + COUNT * 5);
    // no socket leaks -- we have to wait since the sockets aren't
    // freed instantly -- last few bytes get sent.
    await wait({ until: () => httpProxy.numOpenSockets() == 0 });
    expect(httpProxy.numOpenSockets()).toBe(0);
  });

  it("cleans up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});

// using simple builtin to nodejs client
async function loadTestWebsocketServerSerial({
  port,
  count,
  parallel,
}: {
  port: number;
  count: number;
  parallel?: boolean;
}) {
  const options = {
    port,
    host: "localhost",
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
    },
  };

  async function connectToProxy() {
    const req = http.request(options);
    req.end();
    const [res] = await once(req, "upgrade");
    res.socket.end();
  }

  if (parallel) {
    const v: any[] = [];
    for (let i = 0; i < count; i++) {
      v.push(connectToProxy());
    }
    await Promise.all(v);
  } else {
    for (let i = 0; i < count; i++) {
      await connectToProxy();
    }
  }
}
