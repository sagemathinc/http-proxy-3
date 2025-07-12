/*
pnpm test proxy-https-to-https.test.ts

*/

import * as https from "https";
import * as httpProxy from "../..";
import getPort from "../get-port";
import { join } from "path";
import { readFile } from "fs/promises";
import fetch from "node-fetch";

const fixturesDir = join(__dirname, "..", "fixtures");

describe("Basic example of proxying over HTTPS to a target HTTPS server", () => {
  let ports: Record<'https' | 'proxy', number>;
  it("Gets ports", async () => {
    ports = { https: await getPort(), proxy: await getPort() };
  });

  const servers: any = {};
  let ssl: { key: string; cert: string };

  it("Create the target HTTPS server", async () => {
    ssl = {
      key: await readFile(join(fixturesDir, "agent2-key.pem"), "utf8"),
      cert: await readFile(join(fixturesDir, "agent2-cert.pem"), "utf8"),
    };
    servers.https = https
      .createServer(ssl, (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("hello over https\n");
        res.end();
      })
      .listen(ports.https);
  });

  it("Create the HTTPS proxy server", async () => {
    servers.proxy = httpProxy
      .createServer({
        target: `https://localhost:${ports.https}`,
        ssl,
        // without secure false, clients will fail and this is broken:
        secure: false,
      })
      .listen(ports.proxy);
  });

  it("Use fetch to test direct non-proxied https server", async () => {
    const r = await (await fetch(`https://localhost:${ports.https}`)).text();
    expect(r).toContain("hello over https");
  });

  it("Use fetch to test the proxy server", async () => {
    const r = await (await fetch(`https://localhost:${ports.proxy}`)).text();
    expect(r).toContain("hello over https");
  });

  it("cleans up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
