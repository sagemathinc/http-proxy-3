/*
modify-response-middleware.test.ts -- Middleware which modifies response

pnpm test modify-response-middleware.test.ts
*/

import * as httpProxy from "../..";
import * as http from "node:http";
import getPort from "../get-port";
import connect, { type NextFunction } from "connect";
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
      res.write("i am hosted at http-party");
      res.end();
    });
    servers.http.listen(ports.http);
  });

  it("creates connect server that uses a proxy as middleware to actually satisfy the request, after applying compression", () => {
    const proxy = httpProxy.createProxyServer({
      target: `http://localhost:${ports.http}`,
    });
    const rewrite = (_req: http.IncomingMessage, res: http.ServerResponse, next: NextFunction) => {
      const _write = res.write;
      res.write = (data) => {
        const str = typeof data === "string" ? data : Buffer.from(data).toString();
        // @ts-expect-error write allows 2 args
        return _write.call(res, str.replace("http-party", "cocalc"))
      };
      next();
    };
    servers.app = connect().use(rewrite).use(proxy.web).listen(ports.proxy);
  });

  it("test the http server", async () => {
    const a = await (await fetch(`http://localhost:${ports.http}`)).text();
    expect(a).toContain("i am hosted at http-party");
  });

  it("test the proxy server", async () => {
    const a = await (await fetch(`http://localhost:${ports.proxy}`)).text();
    expect(a).toContain("i am hosted at cocalc");
  });

  it("Clean up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
