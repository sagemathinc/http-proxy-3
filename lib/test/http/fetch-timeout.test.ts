
import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nodeFetch from "node-fetch";
import { fetch as undiciFetch } from "undici";

describe("Fetch Proxy Timeout", () => {
  let ports: Record<"http" | "proxy", number>;
  const servers: Record<string, any> = {};

  beforeAll(async () => {
    ports = { http: await getPort(), proxy: await getPort() };

    servers.http = http
      .createServer((_req, _res) => {
        // Do nothing, let it hang
      });
    await new Promise<void>((resolve) => servers.http.listen(ports.http, resolve));

    servers.proxy = httpProxy
      .createServer({
        target: `http://localhost:${ports.http}`,
        fetch: undiciFetch as any, // Enable fetch path
        proxyTimeout: 500, // 500ms timeout
      })
      .listen(ports.proxy);
    await new Promise<void>((resolve) => {
      const server = (servers.proxy as any)._server as http.Server;
      server.listening ? resolve() : server.once("listening", resolve);
    });
  });

  it("should timeout the request and emit error", async () => {
    const errorPromise = new Promise<Error>((resolve) => {
      servers.proxy.once("error", (err: Error, _req: any, res: any) => {
        res.statusCode = 504;
        res.end("Gateway Timeout");
        resolve(err);
      });
    });

    const res = await nodeFetch(`http://localhost:${ports.proxy}`, {
      signal: AbortSignal.timeout(2000) as any,
    });
    expect(res.status).toBe(504);
    expect(await res.text()).toBe("Gateway Timeout");

    const err = await errorPromise;
    expect(err).toBeTruthy();
    expect(err.message).toMatchInlineSnapshot(`"The operation was aborted due to timeout"`);
  });

  afterAll(async () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
