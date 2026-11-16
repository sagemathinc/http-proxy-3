/*
  target-closes-mid-response.test.ts: when the target goes away in the middle of a
  response (crash, kill, reset), the proxy must end the response to the client too,
  as a direct connection would, instead of leaving the client waiting forever.
  See https://github.com/sagemathinc/http-proxy-3/issues/70

pnpm test ./target-closes-mid-response.test.ts
*/

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import * as httpProxy from "../..";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

// Requests path through the proxy and resolves once the client response closes,
// or with closed: false if it is still open after timeout ms.
function request(port: number, path: string, timeout = 2000) {
  return new Promise<{ closed: boolean; complete: boolean; body: string }>((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("error", () => {});
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ closed: false, complete: res.complete, body });
      }, timeout);
      res.on("close", () => {
        clearTimeout(timer);
        resolve({ closed: true, complete: res.complete, body });
      });
    });
    req.on("error", reject);
  });
}

const forceFetch = process.env.FORCE_FETCH_PATH === "true";

describe.each([
  // FORCE_FETCH_PATH turns the native case into a second fetch case
  { name: "native http", extraOptions: {}, skip: forceFetch, emitsError: false },
  { name: "fetch", extraOptions: { fetch: globalThis.fetch }, skip: false, emitsError: true },
])("proxying a response whose target closes mid-response ($name path)", ({ extraOptions, skip, emitsError }) => {
  if (skip) {
    it.skip("covered by the fetch path", () => {});
    return;
  }

  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) {
      close();
    }
  });

  async function setup() {
    const target = http.createServer((req, res) => {
      if (req.url === "/no-body") {
        // Headers, then the target dies before the first byte of the body
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.flushHeaders();
        setTimeout(() => res.socket?.destroy(), 50);
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write("data: 0\n\n");
      if (req.url === "/finite") {
        setTimeout(() => res.end("data: 1\n\n"), 50);
      } else {
        // The target process dies after the first event
        setTimeout(() => res.socket?.destroy(), 50);
      }
    });
    const targetPort = await listen(target);
    closers.push(() => target.close());

    const errors: Error[] = [];
    const proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${targetPort}`, ...extraOptions });
    proxy.on("error", (err, _req, res) => {
      errors.push(err);
      // An error handler which answers asynchronously, while the client has not received anything yet
      if (res instanceof http.ServerResponse && !res.headersSent) {
        setTimeout(() => res.writeHead(502).end("bad gateway"), 10);
      }
    });
    const proxyServer = http.createServer((req, res) => proxy.web(req, res));
    const proxyPort = await listen(proxyServer);
    closers.push(() => proxyServer.close());

    return { proxyPort, errors };
  }

  it("ends the client response when the target closes its socket", async () => {
    const { proxyPort } = await setup();

    const result = await request(proxyPort, "/events");

    expect(result.closed).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.body).toBe("data: 0\n\n");
  });

  it("reports the failure as before", async () => {
    const { proxyPort, errors } = await setup();

    await request(proxyPort, "/events");

    // The fetch path reports the broken body stream; the native path ends the client response without an event
    expect(errors.length > 0).toBe(emitsError);
  });

  it("still completes the client response when the target ends it normally", async () => {
    const { proxyPort, errors } = await setup();

    const result = await request(proxyPort, "/finite");

    expect(result).toEqual({ closed: true, complete: true, body: "data: 0\n\ndata: 1\n\n" });
    expect(errors).toEqual([]);
  });

  it.skipIf(!emitsError)("leaves the response to an error handler which answers before anything was sent", async () => {
    const { proxyPort } = await setup();

    const status = await new Promise<number | undefined>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: proxyPort, path: "/no-body" }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on("error", reject);
    });

    expect(status).toBe(502);
  });
});
