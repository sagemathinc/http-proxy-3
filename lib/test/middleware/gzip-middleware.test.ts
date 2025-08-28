/*
gzip-middleware.test.ts: Using the connect-gzip middleware from connect with http-proxy-3

pnpm test ./gzip-middleware.test.ts
*/

import * as httpProxy from "../..";
import * as http from "node:http";
import getPort from "../get-port";
import connect from "connect";
import compression from "compression";
import fetch from "node-fetch";
import {describe, it, expect} from 'vitest';

describe("Using the connect-gzip middleware from connect with http-proxy-3", () => {
  let ports: Record<'http' | 'proxy', number>;
  it("gets ports", async () => {
    ports = { http: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};
  it("creates target http server", () => {
    servers.http = http.createServer(async (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write("hi from the server");
      res.end();
    });
    servers.http.listen(ports.http);
  });

  it("creates connect server that uses a proxy as middleware to actually satisfy the request, after applying compression", () => {
    const proxy = httpProxy.createProxyServer({
      target: `http://localhost:${ports.http}`,
    });
    servers.connect = connect()
      // @ts-expect-error type compatibility
      .use(compression({ threshold: 1 }))
      .use(proxy.web)
      .listen(ports.proxy);
  });

  it("test the proxy server", async () => {
    const a = await (await fetch(`http://localhost:${ports.proxy}`)).text();
    expect(a).toContain("hi from the server");
  });

  it("Clean up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
