/*
Simple round robin load balancer for websockets

pnpm test ./simple-balancer-with-websockets.test.ts
*/

import fetch from "node-fetch";
import { once } from "node:events";
import * as http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as httpProxy from "../..";
import getPort from "../get-port";

describe("A simple round-robin load balancer that supports websockets", () => {
  let addresses: Array<{ host: string, port: number }>;
  beforeAll(async () => {
    // lists the servers to use in our rotation.
    addresses = [
      {
        host: "localhost",
        port: await getPort(),
      },
      {
        host: "localhost",
        port: await getPort(),
      },
    ];
  });

  const servers: Record<string, http.Server> = {};

  it("creates the servers", () => {
    const createServer = (i: number) => {
      const { host, port } = addresses[i];
      const server = http
        .createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.write(`${port}`);
          res.end();
        })
        .listen(port);
      servers[`${host}:${port}`] = server;

      // also make server support websockets:
      server.on("upgrade", (_req, socket) => {
        socket.write(
          "HTTP/1.1 101 Web Socket Protocol Handshake\r\n" +
            "Upgrade: WebSocket\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n",
        );
        socket.on("data", () => {
          socket.write(`${port}`);
          socket.end();
        });
      });
    };
    for (let i = 0; i < addresses.length; i++) {
      createServer(i);
    }
  });

  let proxyPort: number;
  it("creates the round robin proxy server", async () => {
    // create one proxy for each backend server
    const proxies = addresses.map((target) =>
      httpProxy.createProxyServer({ target }),
    );

    proxyPort = await getPort();
    let i = 0;
    function nextProxy() {
      i = (i + 1) % addresses.length;
      return proxies[i];
    }
    servers.proxy = http
      .createServer((req, res) => {
        nextProxy().web(req, res);
      })
      .listen(proxyPort);
    servers.proxy.on("upgrade", (req, socket, head) => {
      nextProxy().ws(req, socket, head);
    });
  });

  it("sends HTTP requests to the load balance and confirms that it behaves as claimed", async () => {
    const v: number[] = [];
    for (let i = 0; i < 3; i++) {
      v.push(
        parseInt(await (await fetch(`http://localhost:${proxyPort}`)).text()),
      );
    }
    expect(v).toEqual([
      addresses[1].port,
      addresses[0].port,
      addresses[1].port,
    ]);
  });

  it("creates WEBSOCKET clients to the load balance and confirms that it behaves as claimed, with the websockets working and returning the right things when messaged", async () => {
    const options = {
      port: proxyPort,
      host: "localhost",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    const v: number[] = [];
    for (let i = 0; i < 3; i++) {
      const req = http.request(options);
      req.end();
      const [_res, socket] = await once(req, "upgrade");
      socket.write("hello");
      const chunk = await once(socket, "data");
      v.push(parseInt(chunk.toString()));
      socket.end();
    }
    expect(v).toEqual([
      addresses[0].port,
      addresses[1].port,
      addresses[0].port,
    ]);
  });

  afterAll(async() => {
    // cleans up
    Object.values(servers).map((x: any) => x?.close());
  });
});
