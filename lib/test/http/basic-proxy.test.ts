/*
Test basic example of proxying over HTTP

DEVELOPMENT:

pnpm test basic-proxy.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import log from "../log";
import getPort from "../get-port";
import fetch from "node-fetch";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

export async function server() {
  const httpPort = await getPort();
  const proxyPort = await getPort();
  // Target Http Server
  const target = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write(
      "request successfully proxied to: " +
      req.url +
      "\n" +
      JSON.stringify(req.headers, undefined, 2),
    );
    res.end();
  });
  target.listen(httpPort);

  // Basic Http Proxy Server
  const proxy = httpProxy
    .createServer({
      target: `http://localhost:${httpPort}`,
    })
    .listen(proxyPort);
  proxy.on("error", (e) => {
    log("error", e);
  });
  proxy.on("close", () => {
    log("proxy closed");
  });

  log(`http proxy server started on port ${proxyPort}`);
  log(`http server started on port ${httpPort}`);
  return { proxy, target, httpPort, proxyPort };
}

describe("tests proxying a basic http server", () => {
  it("does a consistency check", async () => {
    const { proxy, target, httpPort, proxyPort } = await server();
    const a = await (await fetch(`http://localhost:${httpPort}`)).text();
    expect(a).toContain("request successfully proxied");
    const b = await (await fetch(`http://localhost:${proxyPort}`)).text();
    expect(b).toContain("request successfully proxied");

    proxy.close();
    target.close();
  });
});

describe("Load test against the basic proxy", () => {
  let x: { proxy: httpProxy.ProxyServer; target: http.Server; httpPort: number; proxyPort: number };
  beforeAll(async () => {
    // creates servers
    x = await server();
  });

  const COUNT = 200;
  const MAX_TIME = 3000;
  it(`Does a serial load test of HTTP server with ${COUNT} requests`, async () => {
    const t = Date.now();
    for (let i = 0; i < COUNT; i++) {
      const a = await (await fetch(`http://localhost:${x.httpPort}`)).text();
      if (!a.includes("request successfully proxied")) {
        throw Error("incorrect response");
      }
    }
    const elapsed = Date.now() - t;
    expect(elapsed).toBeLessThan(MAX_TIME);
  });

  it(`Does a serial load test of PROXY server with ${COUNT} requests`, async () => {
    const t = Date.now();
    for (let i = 0; i < COUNT; i++) {
      const a = await (await fetch(`http://localhost:${x.proxyPort}`)).text();
      if (!a.includes("request successfully proxied")) {
        throw Error("incorrect response");
      }
    }
    const elapsed = Date.now() - t;
    expect(elapsed).toBeLessThan(MAX_TIME);
  });

  it(`Does a parallel load test of PROXY server with ${COUNT} requests`, async () => {
    const f = async () => {
      const a = await (await fetch(`http://localhost:${x.proxyPort}`)).text();
      if (!a.includes("request successfully proxied")) {
        throw Error("incorrect response");
      }
    };
    const t = Date.now();
    const v: any[] = [];
    for (let i = 0; i < COUNT; i++) {
      v.push(f());
    }
    await Promise.all(v);
    const elapsed = Date.now() - t;
    expect(elapsed).toBeLessThan(MAX_TIME);
  });

  afterAll(async () => {
    // Cleans up
    x.proxy.close();
    x.target.close();
  });
});
