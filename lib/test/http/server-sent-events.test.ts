/*
  server-sent-events.test.ts: Basic example of proxying server sent events over HTTP

pnpm test ./server-sent-events.test.ts
*/

import * as httpProxy from "../..";
import * as http from "http";
import getPort from "../get-port";
import { createSession } from "better-sse";
import { EventSource } from "eventsource";
import { callback } from "awaiting";
import fetch from "node-fetch";

describe("proxying server sent events over HTTP", () => {
  let ports: Record<'http' | 'proxy', number>;
  it("gets ports", async () => {
    ports = { http: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};
  it("creates the http server", () => {
    let n = 1;
    servers.http = http.createServer(async (req, res) => {
      if (req.url == "/sse") {
        const session = await createSession(req, res);
        session.push(`Hello world! - ${n}`);
        n += 1;
        // important -- CLOSE THE SESSION now that we're done,
        // or it'll hang as open forever.
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write(
        "request successfully proxied to: " +
          req.url +
          "\n" +
          JSON.stringify(req.headers, undefined, 2),
      );
      res.end();
    });
    servers.http.listen(ports.http);
  });

  it("creates the proxy server", () => {
    servers.proxy = httpProxy
      .createProxyServer({
        target: `http://localhost:${ports.http}`,
      })
      .listen(ports.proxy);
  });

  it("test the http proxy server", async () => {
    const a = await (await fetch(`http://localhost:${ports.proxy}`)).text();
    expect(a).toContain("request successfully proxied");
  });

  if (!process.version.startsWith("v18.")) {
    // These two tests leave open handles on node v18, so we disable them ONLY
    // with node v18.
    it("test receiving an SSE WITHOUT using the proxy", async () => {
      const f = (cb: any) => {
        const sse = new EventSource(`http://localhost:${ports.http}/sse`);
        sse.addEventListener("message", ({ data }) => {
          sse.close();
          cb(undefined, JSON.parse(data));
        });
      };
      const resp = await callback(f);
      expect(resp).toEqual("Hello world! - 1");
    });

    it("test receiving an SSE USING the proxy", async () => {
      const f = (cb: any) => {
        const sse = new EventSource(`http://localhost:${ports.proxy}/sse`);
        sse.addEventListener("message", ({ data }) => {
          sse.close();
          cb(undefined, JSON.parse(data));
        });
      };
      const resp = await callback(f);
      expect(resp).toEqual("Hello world! - 2");
    });
  }

  it("Clean up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
