/*
Regression test: a `fetch` proxy target that returns a Response with
multiple Set-Cookie headers must forward all of them, not just the
last one.

DEVELOPMENT:

pnpm test fetch-multiple-set-cookie.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { Headers as NodeFetchHeaders, Response as NodeFetchResponse } from "node-fetch";

async function readSetCookieValues(port: number): Promise<string[]> {
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    http.get(`http://localhost:${port}`, resolve).on("error", reject);
  });
  // Node exposes repeated headers via rawHeaders (res.headers would
  // collapse them into a single comma-joined or last-wins string).
  const values: string[] = [];
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    if (res.rawHeaders[i].toLowerCase() === "set-cookie") {
      values.push(res.rawHeaders[i + 1]);
    }
  }
  return values;
}

describe("fetch proxy target with multiple Set-Cookie headers", () => {
  let proxy: httpProxy.ProxyServer;
  let proxyPort: number;

  beforeAll(async () => {
    proxyPort = await getPort();
    proxy = httpProxy
      .createServer({
        target: "http://example.invalid",
        fetch: (async () => {
          const headers = new Headers();
          headers.append("Set-Cookie", "foo=foobar; Path=/");
          headers.append("Set-Cookie", "bar=barbar; Path=/");
          return new Response("ok", { status: 200, headers });
        }) as any,
      })
      .listen(proxyPort);
  });

  afterAll(() => {
    proxy.close();
  });

  it("forwards both Set-Cookie headers to the client", async () => {
    const setCookieValues = await readSetCookieValues(proxyPort);
    expect(setCookieValues).toEqual([
      "foo=foobar; Path=/",
      "bar=barbar; Path=/",
    ]);
  });

  it("still forwards a single-value header as a plain string", async () => {
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      http.get(`http://localhost:${proxyPort}`, resolve).on("error", reject);
    });
    expect(res.headers["content-type"]).not.toBeInstanceOf(Array);
  });
});

describe("fetch proxy target using node-fetch v2's Headers (no getSetCookie)", () => {
  let proxy: httpProxy.ProxyServer;
  let proxyPort: number;

  beforeAll(async () => {
    proxyPort = await getPort();
    proxy = httpProxy
      .createServer({
        target: "http://example.invalid",
        fetch: (async () => {
          const headers = new NodeFetchHeaders();
          headers.append("Set-Cookie", "foo=foobar; Path=/");
          headers.append("Set-Cookie", "bar=barbar; Path=/");
          // node-fetch's Headers predates the getSetCookie() spec addition -
          // this is exactly the case the fallback in getAllSetCookieValues
          // (web-incoming.ts) exists for.
          expect(typeof (headers as any).getSetCookie).not.toBe("function");
          return new NodeFetchResponse("ok", { status: 200, headers });
        }) as any,
      })
      .listen(proxyPort);
  });

  afterAll(() => {
    proxy.close();
  });

  it("still forwards both Set-Cookie headers via the .raw() fallback", async () => {
    const setCookieValues = await readSetCookieValues(proxyPort);
    expect(setCookieValues).toEqual([
      "foo=foobar; Path=/",
      "bar=barbar; Path=/",
    ]);
  });
});
