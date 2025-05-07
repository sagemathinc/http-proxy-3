/*
pnpm test proxy-https-to-http.test.ts
*/

import * as http from "http";
import * as httpProxy from "../../..";
import getPort from "../../get-port";
import { join } from "path";
import { readFile } from "fs/promises";

const fixturesDir = join(__dirname, "..", "..", "fixtures");

describe("Basic example of proxying over HTTPS to a target HTTP server", () => {
  let ports;
  it("Gets ports", async () => {
    ports = { http: await getPort(), proxy: await getPort() };
  });

  const servers: any = {};

  it("Create the target HTTP server", async () => {
    servers.http = http
      .createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("hello http over https\n");
        res.end();
      })
      .listen(ports.http);
  });

  it("Create the HTTPS proxy server", async () => {
    servers.proxy = httpProxy
      .createServer({
        target: {
          host: "localhost",
          port: ports.http,
        },
        ssl: {
          key: await readFile(join(fixturesDir, "agent2-key.pem"), "utf8"),
          cert: await readFile(join(fixturesDir, "agent2-cert.pem"), "utf8"),
        },
      })
      .listen(ports.proxy);
  });

  it("Use fetch to test non-https server", async () => {
    const r = await (await fetch(`http://localhost:${ports.http}`)).text();
    expect(r).toContain("hello http over https");
  });

  it("Use fetch to test the ACTUAL https server", async () => {
    const r = await (await fetch(`https://localhost:${ports.proxy}`)).text();
    expect(r).toContain("hello http over https");
  });

  it("cleans up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
