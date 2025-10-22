/*
pnpm test proxy-https-to-https.test.ts

*/

import * as http2 from "node:http2";
import * as httpProxy from "../..";
import getPort from "../get-port";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({
  allowH2: true
}));

const fixturesDir = join(__dirname, "..", "fixtures");

describe("Basic example of proxying over HTTP2 to a target HTTP2 server", () => {
  let ports: Record<'http2' | 'proxy', number>;
  beforeAll(async () => {
    // Gets ports
    ports = { http2: await getPort(), proxy: await getPort() };
  });

  const servers: any = {};
  let ssl: { key: string; cert: string };

  it("Create the target HTTP2 server", async () => {
    ssl = {
      key: await readFile(join(fixturesDir, "agent2-key.pem"), "utf8"),
      cert: await readFile(join(fixturesDir, "agent2-cert.pem"), "utf8"),
    };
    servers.https = http2
      .createSecureServer(ssl, (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("hello over http2\n");
        res.end();
      })
      .listen(ports.http2);
  });

  it("Create the HTTPS proxy server", async () => {
    servers.proxy = httpProxy
      .createServer({
        target: `https://localhost:${ports.http2}`,
        ssl,
        agentOptions: { allowH2: true },
        // without secure false, clients will fail and this is broken:
        secure: false,
      })
      .listen(ports.proxy);
  });

  it("Use fetch to test direct non-proxied http2 server", async () => {
    const r = await (await fetch(`https://localhost:${ports.http2}`)).text();
    expect(r).toContain("hello over http2");
  });

  it("Use fetch to test the proxy server", async () => {
    const r = await (await fetch(`https://localhost:${ports.proxy}`)).text();
    expect(r).toContain("hello over http2");
  });

  afterAll(async () => {
    // cleanup
    Object.values(servers).map((x: any) => x?.close());
  });
});
