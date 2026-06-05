/*
Test proxying to an IPv6 target.

Regression test for https://github.com/sagemathinc/http-proxy-3/issues/52:
WHATWG URL.host for IPv6 targets includes brackets and the port
(e.g. "[::1]:8080"), which caused Node.js to pass "[::1]" (brackets included)
to getaddrinfo, failing with ENOTFOUND.

DEVELOPMENT:

pnpm test ipv6-proxy.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import fetch from "node-fetch";
import { describe, it, expect } from "vitest";

// Listen on IPv6 loopback and return the assigned port.
async function listenIPv6(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "::1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve(address.port);
      } else {
        reject(new Error("Failed to get IPv6 port"));
      }
    });
    server.on("error", reject);
  });
}

describe("proxying to an IPv6 target", () => {
  it("forwards requests to an IPv6 backend without ENOTFOUND", async () => {
    const proxyPort = await getPort();

    const target = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok from ipv6 backend");
    });
    const targetPort = await listenIPv6(target);

    const proxy = httpProxy
      .createServer({ target: `http://[::1]:${targetPort}` })
      .listen(proxyPort);

    const body = await (await fetch(`http://localhost:${proxyPort}`)).text();
    expect(body).toBe("ok from ipv6 backend");

    proxy.close();
    target.close();
  });

  it("sets the correct Host header with changeOrigin and a non-standard port", async () => {
    const proxyPort = await getPort();

    let receivedHost: string | undefined;
    const target = http.createServer((req, res) => {
      receivedHost = req.headers.host;
      res.writeHead(200);
      res.end();
    });
    const targetPort = await listenIPv6(target);

    const proxy = httpProxy
      .createServer({
        target: `http://[::1]:${targetPort}`,
        changeOrigin: true,
      })
      .listen(proxyPort);

    await fetch(`http://localhost:${proxyPort}`);

    // Host header must be "[::1]:port" for non-standard ports (RFC 2732).
    expect(receivedHost).toBe(`[::1]:${targetPort}`);

    proxy.close();
    target.close();
  });
});
