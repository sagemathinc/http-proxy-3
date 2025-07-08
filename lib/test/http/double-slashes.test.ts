import express from "express";
import getPort from "../get-port";
import { createServer } from "../..";
import http from "http";

// See https://github.com/sagemathinc/http-proxy-3/issues/6

describe("test multiple forward slashes in a URL", () => {
  let port, server;

  it("create a simple http server", async () => {
    port = await getPort();
    const app = express();

    app.get("/", (_req, res) => {
      res.send("Hello World!");
    });

    app.get("/test", (_req, res) => {
      res.send("Test Page!");
    });

    app.get("/test/foo", (_req, res) => {
      res.send("Test Foo Page!");
    });

    app.get("//test", (_req, res) => {
      res.send("double slash test Page!");
    });

    app.get("///test/crazy//slasher", (_req, res) => {
      res.send("crazy slasher");
    });

    server = app.listen(port);
  });

  const get = async (url) => {
    return await (await fetch(`http://localhost:${port}${url}`)).text();
  };

  it("establish what the correct behavior is", async () => {
    expect(await get("")).toBe("Hello World!");
    expect(await get("/test")).toBe("Test Page!");
    expect(await get("//test")).toBe("double slash test Page!");
    expect(await get("/test/foo")).toContain("Test Foo Page!");
    expect(await get("/test//foo")).toContain("Cannot GET /test//foo");
    expect(await get("///test/crazy//slasher")).toBe("crazy slasher");
  });

  let proxy, httpServer;
  let proxyPort;
  it("create a proxy server", async () => {
    proxy = createServer();
    proxy.on("error", (err, _req, res) => {
      console.error("Proxy error:", err);
      res.end("Something went wrong.");
    });
    httpServer = http.createServer((req, res) => {
      const target = `http://localhost:${port}`;
      proxy.web(req, res, { target });
    });

    proxyPort = await getPort();
    httpServer.listen(proxyPort);
  });

  const getProxy = async (url) => {
    return await (await fetch(`http://localhost:${proxyPort}${url}`)).text();
  };

  it("get using the proxy instead -- the behavior is identical to directly using the server", async () => {
    expect(await getProxy("")).toBe("Hello World!");
    expect(await getProxy("/test")).toBe("Test Page!");
    expect(await getProxy("//test")).toBe("double slash test Page!");
    expect(await getProxy("/test/foo")).toContain("Test Foo Page!");
    expect(await getProxy("/test//foo")).toContain("Cannot GET /test//foo");
    expect(await getProxy("///test/crazy//slasher")).toBe("crazy slasher");
  });

  it("clean up", () => {
    server.close();
    httpServer.close();
  });
});
