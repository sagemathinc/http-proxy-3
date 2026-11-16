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
  return new Promise<{ status?: number; closed: boolean; complete: boolean; body: string }>((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("error", () => {});
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ status: res.statusCode, closed: false, complete: res.complete, body });
      }, timeout);
      res.on("close", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode, closed: true, complete: res.complete, body });
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
      if (req.url === "/finite") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: 0\n\n");
        setTimeout(() => res.end("data: 1\n\n"), 50);
        return;
      }
      // A Content-Length longer than the body makes the truncation unambiguous: some fetch
      // implementations treat a chunked body closed at a chunk boundary as complete
      res.writeHead(200, { "content-type": "text/event-stream", "content-length": "1000" });
      if (req.url === "/events") {
        // The target process dies after the first event
        res.write("data: 0\n\n");
        setTimeout(() => res.socket?.destroy(), 50);
      } else {
        // The target resets the connection after the headers, before the first byte of the body
        res.flushHeaders();
        setTimeout(() => res.socket?.resetAndDestroy(), 50);
      }
    });
    const targetPort = await listen(target);
    closers.push(() => target.close());

    const errors: Error[] = [];
    const proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${targetPort}`, ...extraOptions });
    proxy.on("error", (err, req, res) => {
      errors.push(err);
      if (!(res instanceof http.ServerResponse) || res.headersSent) {
        return;
      }
      // Error handlers which answer the client asynchronously, or start the answer right away
      if (req.url === "/no-body-async") {
        setTimeout(() => res.writeHead(502).end("bad gateway"), 10);
      } else if (req.url === "/no-body-sync") {
        res.writeHead(502);
        setTimeout(() => res.end("bad gateway"), 10);
      }
    });
    const proxyServer = http.createServer((req, res) => proxy.web(req, res));
    const proxyPort = await listen(proxyServer);
    closers.push(() => proxyServer.close());

    return { proxyPort, errors };
  }

  it("ends the client response when the target closes its socket", async () => {
    const { proxyPort, errors } = await setup();

    const result = await request(proxyPort, "/events");

    expect(result).toMatchObject({ closed: true, complete: false, body: "data: 0\n\n" });
    // The fetch path reports the broken body stream; the native path ends the client response without an event
    expect(errors.length > 0).toBe(emitsError);
  });

  it("still completes the client response when the target ends it normally", async () => {
    const { proxyPort, errors } = await setup();

    const result = await request(proxyPort, "/finite");

    expect(result).toEqual({ status: 200, closed: true, complete: true, body: "data: 0\n\ndata: 1\n\n" });
    expect(errors).toEqual([]);
  });

  it.each(["/no-body-async", "/no-body-sync"])(
    "leaves the response to an error handler when the target fails before anything was sent (%s)",
    async (path) => {
      const { proxyPort, errors } = await setup();

      const result = await request(proxyPort, path);

      expect(errors).toHaveLength(1);
      // (complete stays false: the target's Content-Length was already copied to the response, as on main)
      expect(result).toMatchObject({ status: 502, closed: true, body: "bad gateway" });
    },
  );
});
