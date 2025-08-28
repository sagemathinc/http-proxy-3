/*
Example of proxying over HTTP using a forward proxy

A forward proxy just forwards requests but does NOT actually wait for a
response and return it to the browser.

DEVELOPMENT:

pnpm test forward-proxy.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import log from "../log";
import getPort from "../get-port";
import wait from "../wait";
import fetch from "node-fetch";
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe("Example of proxying over HTTP with additional forward proxy", () => {
  let forwardingServer: http.Server,
    httpPort: number,
    numRequests = 0;
  beforeAll(async () => {
    // Setup Target Http Forwarding Server
    httpPort = await getPort();
    forwardingServer = http.createServer((req, res) => {
      log("Receiving forward for: " + req.url);
      numRequests += 1;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write(
        "request successfully forwarded to: " +
        req.url +
        "\n" +
        JSON.stringify(req.headers, undefined, 2),
      );
      res.end();
    });
    forwardingServer.listen(httpPort);
    log(`http server started on port ${httpPort}`);
  });

  let proxyServer: httpProxy.ProxyServer, proxyPort: number;
  it("Setup proxy server with forwarding", async () => {
    proxyPort = await getPort();
    proxyServer = httpProxy.createServer({
      forward: {
        port: httpPort,
        host: "localhost",
      },
    });
    proxyServer.listen(proxyPort);
    log(`http proxy server started on port ${proxyPort}`);
  });

  it("does a consistency check", async () => {
    const a = await (await fetch(`http://localhost:${httpPort}`)).text();
    expect(a).toContain("request successfully forwarded to");
    const before = numRequests;
    const b = await (await fetch(`http://localhost:${proxyPort}`)).text();
    // This b is supposed to be empty
    expect(b).toContain("");
    // Handling of the forward on the remote server is totally decoupled, so we
    // just have to wait:
    await wait({ until: () => numRequests > before });
    // indeed, the remote server did get a request
    expect(numRequests).toBe(before + 1);
  });

  let proxy2Server: httpProxy.ProxyServer, proxy2Port: number;
  it("Setup proxy server with forwarding **and** target", async () => {
    proxy2Port = await getPort();
    proxy2Server = httpProxy.createServer({
      target: {
        // this could be a completely different server
        port: httpPort,
        host: "localhost",
      },
      forward: {
        port: httpPort,
        host: "localhost",
      },
    });
    proxy2Server.listen(proxy2Port);
    log(`http proxy2 server started on port ${proxy2Port}`);

    const before = numRequests;
    const b = await (await fetch(`http://localhost:${proxy2Port}`)).text();
    expect(b).toContain("request successfully forwarded to");
    await wait({ until: () => numRequests >= before + 2 });
    // indeed, the remote server did get a request TWICE, once from the
    // forward and once from being the target.
    expect(numRequests).toBe(before + 2);
  });

  afterAll(async () => {
    // Cleans up
    forwardingServer.close();
    proxyServer.close();
    proxy2Server.close();
  });
});
