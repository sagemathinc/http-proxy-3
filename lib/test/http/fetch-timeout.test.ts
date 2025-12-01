
import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fetch } from "undici";

describe("Fetch Proxy Timeout", () => {
  let ports: Record<"http" | "proxy", number>;
  beforeAll(async () => {
    ports = { http: await getPort(), proxy: await getPort() };
  });

  const servers: Record<string, any> = {};

  it("Create the target HTTP server that hangs", async () => {
    servers.http = http
      .createServer((_req, _res) => {
        // Do nothing, let it hang
      })
      .listen(ports.http);
  });

  it("Create the proxy server with fetch and timeout", async () => {
    servers.proxy = httpProxy
      .createServer({
        target: `http://localhost:${ports.http}`,
        fetch: fetch as any, // Enable fetch path
        proxyTimeout: 500, // 500ms timeout
      })
      .listen(ports.proxy);
  });

  it("should timeout the request and emit error", async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Test timed out"));
      }, 2000);

      servers.proxy.once('error', (err: Error, _req: any, res: any) => {
        clearTimeout(timeout);
        try {
          expect(err).toBeTruthy();
          expect(err.message).toMatchInlineSnapshot(`"The operation was aborted due to timeout"`);
          res.statusCode = 504;
          res.end("Gateway Timeout");
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      fetch(`http://localhost:${ports.proxy}`).catch(() => {
         // Ignore client side fetch error, we care about server side error emission
      });
    });
  });

  afterAll(async () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
