
import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent, fetch } from "undici";

const TestAgent = new Agent({ allowH2: true, connect: { rejectUnauthorized: false } });

const fixturesDir = join(__dirname, "..", "fixtures");

describe("X-Forwarded-Host with HTTP/2", () => {
  let ports: Record<"http" | "proxy", number>;
  beforeAll(async () => {
    ports = { http: await getPort(), proxy: await getPort() };
  });

  const servers: any = {};

  it("Create the target HTTP server", async () => {
    servers.http = http
      .createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write(JSON.stringify(req.headers));
        res.end();
      })
      .listen(ports.http);
  });

  it("Create the HTTPS proxy server with xfwd", async () => {
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
        xfwd: true,
      })
      .listen(ports.proxy);
  });

  it("should pass x-forwarded-host when using HTTP/2", async () => {
    const res = await fetch(`https://localhost:${ports.proxy}`, { dispatcher: TestAgent });
    const headers = await res.json() as any;
    
    // In HTTP/2, :authority is used instead of Host.
    // The proxy should map :authority to x-forwarded-host if Host is missing.
    expect(headers["x-forwarded-host"]).toBe(`localhost:${ports.proxy}`);
  });

  afterAll(async () => {
    // cleans up
    Object.values(servers).map((x: any) => x?.close());
  });
});
