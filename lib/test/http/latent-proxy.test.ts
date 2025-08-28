/*
pnpm test latent-proxy.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import {describe, it, expect} from 'vitest';

describe("Test proxying over HTTP with latency", () => {
  let ports: Record<'http' | 'proxy', number>;
  it("gets ports", async () => {
    ports = { http: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};
  const LATENCY = 250;
  it("creates servers", () => {
    // generic proxy server for explicitly doing proxies.
    // This is NOT listening.
    const proxy = httpProxy.createProxyServer();

    // make a NORMAL http server that handles its requests
    // by making use of proxy
    servers.proxy = http
      .createServer((req, res) => {
        setTimeout(() => {
          proxy.web(req, res, {
            target: `http://localhost:${ports.http}`,
          });
        }, LATENCY);
      })
      .listen(ports.proxy);

    // Target Http Server
    servers.http = http
      .createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write(
          "request successfully proxied to: " +
            req.url +
            "\n" +
            JSON.stringify(req.headers, undefined, 2),
        );
        res.end();
      })
      .listen(ports.http);
  });

  it("makes a request and observes it works, but with latency", async () => {
    const t = Date.now();
    const r = await (await fetch(`http://localhost:${ports.proxy}`)).text();
    expect(r).toContain("request successfully proxied to");
    expect(Date.now() - t).toBeGreaterThan(LATENCY);
  });

  it("Clean up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
