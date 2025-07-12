/*
pnpm test ./websocket-proxy.test.ts

We setup a socket.io server and test it directly and also via
a websocket proxy server.  We observe also that the proxy server
works when falling back to polling (instead of websocket).

We also load test it by making and closing 250 connections
both in serial and parallel, confirming this is fast and
that no sockets leak.
*/

import * as httpProxy from "../..";
import log from "../log";
import getPort from "../get-port";
import wait, { once } from "../wait";
import { createServer } from "http";
import { Server } from "socket.io";
import { io as socketioClient } from "socket.io-client";

describe("Example of proxying over HTTP and WebSockets", () => {
  let ports: Record<'socketio' | 'proxy', number>;
  it("assigns ports", async () => {
    ports = { socketio: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};
  let socketIOServer: string;
  it("Create the target websocket server", async () => {
    const httpServer = createServer();
    servers.httpServer = httpServer;
    const io = new Server(httpServer);
    io.on("connection", (client) => {
      log("Got websocket connection");

      client.on("message", (msg) => {
        log("Got message from client: ", msg);
        client.send("from server");
      });
    });
    httpServer.listen(ports.socketio);
    socketIOServer = `ws://localhost:${ports.socketio}`;
  });

  it("Create a websocket client and test the socketio server directly", async () => {
    const client = socketioClient(socketIOServer);

    client.send("I am the client");

    const msg = await once(client as any, "message");
    expect(msg).toEqual(["from server"]);
    client.close();
  });

  it("Create a proxy server pointed at the websocket server", async () => {
    servers.proxy = httpProxy
      .createServer({ target: `ws://localhost:${ports.socketio}`, ws: true })
      .listen(ports.proxy);
  });

  it("Create a websocket client and test the socketio server via the proxy server", async () => {
    const client = socketioClient(`ws://localhost:${ports.proxy}`, {
      transports: ["websocket"],
    });

    client.send("I am the client");

    const msg = await once(client as any, "message");
    expect(msg).toEqual(["from server"]);
    client.close();
  });

  const LATENCY = 1000;
  const COUNT = 250;
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
    // confirm that there are no socket leaks -- we have to wait since the sockets aren't
    // freed instantly -- last few bytes get sent.
    await wait({ until: () => httpProxy.numOpenSockets() == 0 });
    expect(httpProxy.numOpenSockets()).toBe(0);
  });

  it("cleans up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});

// using Socket.io client
async function loadTestWebsocketServerSerial({
  port,
  count,
  parallel,
}: {
  port: number;
  count: number;
  parallel?: boolean;
}) {
  async function connectToProxy() {
    const client = socketioClient(`ws://localhost:${port}`, {
      transports: ["websocket"],
    });
    client.send("I am the client");
    const msg = await once(client as any, "message");
    client.close();
    if (msg[0] != "from server") {
      throw Error("invalid response");
    }
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
