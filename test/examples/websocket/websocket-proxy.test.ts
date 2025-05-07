/*
pnpm test websocket-proxy.test.ts
*/

import * as httpProxy from "../../..";
import getPort from "../../get-port";
import log from "../../log";
import { Server } from "socket.io";
import { io as socketioClient } from "socket.io-client";
import { once } from "../../wait";

describe("Example of proxying over HTTP and WebSockets", () => {
  let ports;
  it("assigns ports", async () => {
    ports = { socketio: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};
  let socketIOServer: string;
  it("Create the target websocket server", async () => {
    const io = new Server();
    servers.io = io;
    io.on("connection", (client) => {
      log("Got websocket connection");

      client.on("message", (msg) => {
        log("Got message from client: ", msg);
        client.send("from server");
      });
    });
    io.listen(ports.socketio);
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
    console.log(ports);
    const client = socketioClient(`ws://localhost:${ports.proxy}`);

    client.send("I am the client");

    const msg = await once(client as any, "message");
    expect(msg).toEqual(["from server"]);
    client.close();
  });

  //   it("cleans up", () => {
  //     Object.values(servers).map((x: any) => x?.close());
  //   });
});
