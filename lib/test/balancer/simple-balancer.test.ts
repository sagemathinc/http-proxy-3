/*
simple-balancer.test.ts: Example of a simple round robin HTTP load balancer

pnpm test simple-balancer.test.ts
*/

import * as http from "http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import fetch from "node-fetch";

describe("A simple round-robin load balancing strategy.", () => {
  let addresses: Array<{ host: string, port: number }>;
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
    };
    for (let i = 0; i < addresses.length; i++) {
      createServer(i);
    }
  });

  let proxyPort: number;
  it("creates the round robin proxy server", async () => {
    proxyPort = await getPort();
    const proxy = httpProxy.createServer({});
    let i = 0;
    servers.proxy = http
      .createServer((req, res) => {
        const { host, port } = addresses[i];
        const target = { target: `http://${host}:${port}` };
        proxy.web(req, res, target);
        i = (i + 1) % addresses.length;
      })
      .listen(proxyPort);
  });

  it("sends requests to the load balance and confirms that it behaves as claimed", async () => {
    const v: number[] = [];
    for (let i = 0; i < 3; i++) {
      v.push(
        parseInt(await (await fetch(`http://localhost:${proxyPort}`)).text()),
      );
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
