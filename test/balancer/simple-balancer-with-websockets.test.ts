/*
Simple round robin load balancer for websockets

pnpm test ./simple-balancer-with-websockets.test.ts
*/

import * as http from "http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import { once } from "../wait";

describe("A simple round-robin load balancer that supports websockets", () => {
  let addresses;
  it("lists the servers to use in our rotation.", async () => {
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

  const servers: any = {};

  it("creates the servers", () => {
    const createServer = (i) => {
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

  let proxyPort;
  it("creates the round robin proxy server", async () => {
    // create one proxy for each backend server
    const proxies = addresses.map((target) =>
      httpProxy.createProxyServer({ target }),
    );

    proxyPort = await getPort();
    servers.proxy = httpProxy.createProxyServer();
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

  it("cleans up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
