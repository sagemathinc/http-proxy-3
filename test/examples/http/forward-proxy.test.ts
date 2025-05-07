/*
Example of proxying over HTTP using a forward proxy

A forward proxy just forwards requests but does NOT actually wait for a
response and return it to the browser.

DEVELOPMENT:

pnpm test forward-proxy.test.ts 
*/

import * as http from "http";
import * as httpProxy from "../../..";
import log from "../../log";
import getPort from "../../get-port";
import { delay } from "awaiting";

describe("Example of proxying over HTTP with additional forward proxy", () => {
  let forwardingServer,
    httpPort,
    numRequests = 0;
  it("Setup Target Http Forwarding Server", async () => {
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

  let proxyServer, proxyPort;
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
    // This b is supposed to be empty, because the
    expect(b).toContain("");
    // Handling of the forward on the remote server is totally decoupled, so we
    // just have to wait:
    while (numRequests <= before) {
      await delay(5);
    }
    // indeed, the remote server did get a request
    expect(numRequests).toBe(before + 1);
  });

  let proxy2Server, proxy2Port;
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
    // This b is supposed to be empty, because the
    expect(b).toContain("request successfully forwarded to");
    while (numRequests <= before + 1) {
      await delay(5);
    }
    // indeed, the remote server did get a request TWICE, once from the
    // forward and once from being the target.
    expect(numRequests).toBe(before + 2);
  });

  it("Cleans up", () => {
    forwardingServer.close();
    proxyServer.close();
    proxy2Server.close();
  });
});
