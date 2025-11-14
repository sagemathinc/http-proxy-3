/*
body-decoder-middleware.test.ts: Basic example of connect.bodyParser() middleware in http-proxy-3

pnpm test body-decoder-middleware.test.ts
*/

import * as httpProxy from "../..";
import * as http from "node:http";
import getPort from "../get-port";
import connect from "connect";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { describe, it, expect } from "vitest";

describe.skipIf(() => process.env.FORCE_FETCH_PATH === "true")(
  "connect.bodyParser() middleware in http-proxy-3",
  () => {
    let ports: Record<"http" | "proxy", number>;
    it("gets ports", async () => {
      ports = { http: await getPort(), proxy: await getPort() };
    });

    let servers: any = {};
    it("creates target http server that returns the contents of the body", () => {
      const app1 = connect()
        .use(bodyParser.json())
        .use((rawReq, res) => {
          const req = rawReq as http.IncomingMessage & { body?: any };
          res.end(`received ${JSON.stringify(req.body)}`);
        });

      servers.http = http.createServer(app1).listen(ports.http);
    });

    it("creates proxy server that de, then re- serializes", () => {
      const proxy = httpProxy.createProxyServer({
        target: `http://localhost:${ports.http}`,
      });

      // re-serialize parsed body before proxying.
      proxy.on("proxyReq", (proxyReq, rawReq, _res, _options) => {
        const req = rawReq as http.IncomingMessage & { body?: any };
        if (!req.body || !Object.keys(req.body).length) {
          return;
        }

        const contentType = proxyReq.getHeader("Content-Type");
        let bodyData;

        if (contentType === "application/json") {
          bodyData = JSON.stringify(req.body);
        }

        if (contentType === "application/x-www-form-urlencoded") {
          bodyData = new URLSearchParams(req.body).toString();
        }

        if (bodyData) {
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      });

      const app = connect()
        .use(bodyParser.json())
        .use(bodyParser.urlencoded())
        .use((req, res) => {
          // At this point the body has been de-serialized. If we
          // just pass this straight to the http webserver, it's all broken,
          // so we have to re-serialize it again, which is what the proxy.on('proxyReq')
          // thing above does.
          proxy.web(req, res, {
            target: `http://127.0.0.1:${ports.http}`,
          });
        });

      servers.proxy = http.createServer(app).listen(ports.proxy);
    });

    it("test the http server", async () => {
      const a = await (
        await fetch(`http://localhost:${ports.http}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ foo: "bar" }),
        })
      ).text();
      expect(a).toContain('received {"foo":"bar"}');
    });

    it("test the proxy server", async () => {
      const a = await (
        await fetch(`http://localhost:${ports.proxy}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ foo: "bar" }),
        })
      ).text();
      expect(a).toContain('received {"foo":"bar"}');
    });

    it("Clean up", () => {
      Object.values(servers).map((x: any) => x?.close());
    });
  },
);
