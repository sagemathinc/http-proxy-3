/*
Test dynamic target using a function that returns ProxyTarget

DEVELOPMENT:

pnpm test dynamic-target.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import fetch from "node-fetch";
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { once } from "node:events";

async function setup() {
  const port1 = await getPort();
  const port2 = await getPort();
  const proxyPort = await getPort();

  const target1 = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("target1 responded");
    res.end();
  });
  target1.listen(port1);

  const target2 = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("target2 responded");
    res.end();
  });
  target2.listen(port2);

  const proxy = httpProxy
    .createServer({
      target: (req: http.IncomingMessage) => {
        if (req.url?.startsWith("/app2")) {
          return `http://localhost:${port2}`;
        }
        return `http://localhost:${port1}`;
      },
    })
    .listen(proxyPort);
  proxy.on("error", (_e) => {});

  return { proxy, target1, target2, port1, port2, proxyPort };
}

describe("dynamic target function", () => {
  let servers: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    servers = await setup();
  });

  afterAll(() => {
    servers.proxy.close();
    servers.target1.close();
    servers.target2.close();
  });

  it("routes to target1 for /app1 path", async () => {
    const res = await fetch(`http://localhost:${servers.proxyPort}/app1`);
    const body = await res.text();
    expect(body).toBe("target1 responded");
  });

  it("routes to target2 for /app2 path", async () => {
    const res = await fetch(`http://localhost:${servers.proxyPort}/app2`);
    const body = await res.text();
    expect(body).toBe("target2 responded");
  });

  it("routes to target1 for root path", async () => {
    const res = await fetch(`http://localhost:${servers.proxyPort}/`);
    const body = await res.text();
    expect(body).toBe("target1 responded");
  });
});

describe("dynamic target with per-request override", () => {
  it("per-request static target overrides function target", async () => {
    const port1 = await getPort();
    const port2 = await getPort();
    const proxyPort = await getPort();

    const target1 = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("target1");
      res.end();
    });
    target1.listen(port1);

    const target2 = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("target2");
      res.end();
    });
    target2.listen(port2);

    const proxy = httpProxy.createServer({
      target: () => `http://localhost:${port1}`,
    });

    // Create a server that uses proxy.web with per-request options
    const server = http.createServer((req, res) => {
      proxy.web(req, res, { target: `http://localhost:${port2}` });
    });
    server.listen(proxyPort);

    const res = await fetch(`http://localhost:${proxyPort}/`);
    const body = await res.text();
    expect(body).toBe("target2");

    proxy.close();
    server.close();
    target1.close();
    target2.close();
  });

  it("function target returning {port, host} object", async () => {
    const port = await getPort();
    const proxyPort = await getPort();

    const target = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("object target");
      res.end();
    });
    target.listen(port);

    const proxy = httpProxy
      .createServer({
        target: () => ({ port, host: "localhost" } as httpProxy.ProxyTarget),
      })
      .listen(proxyPort);
    proxy.on("error", (_e) => {});

    const res = await fetch(`http://localhost:${proxyPort}/`);
    const body = await res.text();
    expect(body).toBe("object target");

    proxy.close();
    target.close();
  });
});

describe("dynamic target error handling", () => {
  it("emits error when target function throws", async () => {
    const proxyPort = await getPort();

    const errorMessage = "target resolution failed";
    const proxy = httpProxy.createServer({
      target: () => {
        throw new Error(errorMessage);
      },
    });

    const errorPromise = new Promise<Error>((resolve) => {
      proxy.on("error", (err: Error) => resolve(err));
    });

    const server = http.createServer((req, res) => {
      proxy.web(req, res);
    });
    server.listen(proxyPort);
    // Server won't send back a response (emit error + return), but we don't
    // need the fetch to complete — only the error to fire.
    await once(server, "listening");
    fetch(`http://localhost:${proxyPort}/`).catch(() => {});

    const err = await errorPromise;
    expect(err.message).toBe(errorMessage);

    server.close();
    proxy.close();
  });
});
