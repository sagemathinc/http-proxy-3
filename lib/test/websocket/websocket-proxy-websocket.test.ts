/*
pnpm test ./websocket-proxy-websocket.test.ts

Proxying a websocket connection to a server, which itself proxies a websocket
connection to another server.

[Client] --> [Outer Proxy] --> [Inner Proxy] --> [Websocket Server]

We have this architecture when developing CoCalc inside a CoCalc project, e.g., to get a websocket
connection to NATS, the browser connect to the big main cocalc server which proxies the connection to the dev cocalc
server which proxies that connection to NATS.

We use socket-io in this example just to keep things interesting and more complicated.
*/

import * as httpProxy from "../..";
import getPort from "../get-port";
import { Server } from "socket.io";
import { io as socketioClient } from "socket.io-client";
import { once } from "../wait";

describe("Multilevel Proxying of a Websocket using Socket.io", () => {
  let ports: Record<'socketio' | 'inner' | 'outer', number>;
  it("assigns ports", async () => {
    ports = {
      socketio: await getPort(),
      inner: await getPort(),
      outer: await getPort(),
    };
  });

  const servers: any = {};
  it("Create the target websocket server", async () => {
    const io = new Server();
    io.on("connection", (client) => {
      client.on("message", () => {
        client.send("from server");
      });
    });
    servers.socketio = io.listen(ports.socketio);
  });

  it("Make a client request to socketio", async () => {
    const client = socketioClient(`ws://localhost:${ports.socketio}`);
    client.send("");
    const msg = await once(client as any, "message");
    expect(msg).toEqual(["from server"]);
    client.close();
  });

  it("Creates a proxy server which proxies the socket.io server", async () => {
    servers.innerProxy = httpProxy
      .createServer({ target: `ws://localhost:${ports.socketio}`, ws: true })
      .listen(ports.inner);
  });

  it("Make a client request to inner proxy server", async () => {
    const client = socketioClient(`ws://localhost:${ports.inner}`);
    client.send("");
    const msg = await once(client as any, "message");
    expect(msg).toEqual(["from server"]);
    client.close();
  });

  it("Creates an outer proxy server which proxies the inner proxy server", async () => {
    servers.outerProxy = httpProxy
      .createServer({ target: `ws://localhost:${ports.inner}`, ws: true })
      .listen(ports.outer);
  });

  it("Make a client request to outer proxy server", async () => {
    const client = socketioClient(`ws://localhost:${ports.outer}`);
    client.send("");
    const msg = await once(client as any, "message");
    expect(msg).toEqual(["from server"]);
    client.close();
  });

  it("cleans up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
