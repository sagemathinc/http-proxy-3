import express from "express";
import getPort from "../get-port";
import ProxyServer, { createServer } from "../..";
import http from "node:http";

describe("test empty req.url", () => {
  let port: number, server: http.Server;

  it("create a simple http server", async () => {
    port = await getPort();
    const app = express();

    app.get("/test", (req, res, next) => {
      if (req.path !== "/test") return next();
      res.send("Test Page!: " + JSON.stringify(req.query));
    });

    server = app.listen(port);
  });

  let proxy: ProxyServer, httpServer: http.Server;
  let proxyPort: number;
  it("create a proxy server", async () => {
    proxy = createServer();
    proxy.on("error", (err, _req, res) => {
      console.error("Proxy error:", err);
      res.end("Something went wrong.");
    });
    httpServer = http.createServer((req, res) => {
      req.url = '' + new URL(`http://example.com${req.url}`).search;
      proxy.web(req, res, { target: `http://localhost:${port}/test` });
    });

    proxyPort = await getPort();
    httpServer.listen(proxyPort);
  });

  const getProxy = async (url: string) => {
    return await (await fetch(`http://localhost:${proxyPort}${url}`)).text();
  };

  it("get using the proxy", async () => {
    expect(await getProxy("")).toBe("Test Page!: {}");
    expect(await getProxy("?foo")).toBe("Test Page!: {\"foo\":\"\"}");
    expect(await getProxy("?foo=bar")).toBe("Test Page!: {\"foo\":\"bar\"}");
  });

  it("clean up", () => {
    server.close();
    httpServer.close();
  });
});
