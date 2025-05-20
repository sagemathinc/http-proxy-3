/*
  blacklist-headers.test.ts: Basic example of proxying server sent events over HTTP

pnpm test ./blacklist-headers.test.ts
*/

import * as httpProxy from "../..";
import * as http from "http";
import getPort from "../get-port";

describe("blacklisting the Trailer header", () => {
  let ports;
  it("gets ports", async () => {
    ports = { http: await getPort(), proxy: await getPort() };
  });

  if (!process.version.startsWith("v18.")) {
    // we can't test this on node 18, at least with this test,
    // since fetch hangs and node-fetch doesn't allow this bad behavior,
    // as far as I can tell.
    let servers: any = {};
    it("creates an http server", () => {
      servers.http = http.createServer(async (req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write(JSON.stringify(req.headers));
        res.end();
      });
      servers.http.listen(ports.http);
    });

    it("test sending a request with the Trailer header directly to the HTTP server", async () => {
      const a = await (
        await fetch(`http://localhost:${ports.http}`, {
          headers: {
            Trailer1: "xxx",
          },
        })
      ).text();
      expect(a).toContain("railer1");
    });

    it("test sending a request with the Trailer header directly to the HTTP server -- this works fine, evidently", async () => {
      const a = await (
        await fetch(`http://localhost:${ports.http}`, {
          headers: {
            Trailer: "xxx",
          },
        })
      ).text();
      expect(a).toContain("railer");
    });

    it("creates a proxy server", () => {
      servers.proxy = httpProxy
        .createProxyServer({
          target: `http://localhost:${ports.http}`,
        })
        .listen(ports.proxy);
    });

    it("test the http proxy server -- just testing the cookies are working", async () => {
      const a = await (
        await fetch(`http://localhost:${ports.proxy}`, {
          headers: {
            Trailer1: "xxx",
          },
        })
      ).text();
      expect(a).toContain("railer1");
    });

    it("test the http proxy server by sending it a Trailer header -- this hangs if the cookie doesn't get stripped, due to how this header is handled by the internal node http library!", async () => {
      const a = await (
        await fetch(`http://localhost:${ports.proxy}`, {
          headers: {
            Trailer: "xxx",
          },
        })
      ).text();
      // the header is removed
      expect(a).not.toContain("railer");
    });

    it("Clean up", () => {
      Object.values(servers).map((x: any) => x?.close());
    });
  }
});
