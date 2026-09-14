import * as httpProxy from "../..";
import http from "node:http";
import getPort from "../get-port";
import { describe, it, expect } from "vitest";

async function proxyWithCookies(cookies: string[]) {
  const port = await getPort();
  const proxy = httpProxy.createProxyServer({
    target: "http://example.test",
    fetch: (async () => {
      const headers = new Headers();
      for (const cookie of cookies) {
        headers.append("Set-Cookie", cookie);
      }
      return new Response("ok\n", { status: 200, headers });
    }) as any,
  } as any);
  const server = http.createServer((req, res) => proxy.web(req, res));
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return { port, server };
}

describe("set-cookie handling for a native Headers fetch response", () => {
  it("preserves two Set-Cookie headers", async () => {
    const { port, server } = await proxyWithCookies(["foo=foobar; Path=/", "bar=barbar; Path=/"]);
    const res = await fetch(`http://localhost:${port}/`);
    const setCookies = res.headers.getSetCookie();
    server.close();

    expect(setCookies).toHaveLength(2);
    expect(setCookies).toContain("foo=foobar; Path=/");
    expect(setCookies).toContain("bar=barbar; Path=/");
  });

  it("preserves three Set-Cookie headers", async () => {
    const cookies = ["a=1; Path=/", "b=2; Path=/", "c=3; Path=/"];
    const { port, server } = await proxyWithCookies(cookies);
    const res = await fetch(`http://localhost:${port}/`);
    const setCookies = res.headers.getSetCookie();
    server.close();

    expect(setCookies).toHaveLength(3);
    for (const cookie of cookies) {
      expect(setCookies).toContain(cookie);
    }
  });

  it("preserves a single Set-Cookie header without regressing to an empty value", async () => {
    const { port, server } = await proxyWithCookies(["only=one; Path=/"]);
    const res = await fetch(`http://localhost:${port}/`);
    const setCookies = res.headers.getSetCookie();
    server.close();

    expect(setCookies).toEqual(["only=one; Path=/"]);
  });

  it("does not add a Set-Cookie header when there are none", async () => {
    const { port, server } = await proxyWithCookies([]);
    const res = await fetch(`http://localhost:${port}/`);
    const setCookies = res.headers.getSetCookie();
    server.close();

    expect(setCookies).toEqual([]);
  });
});
