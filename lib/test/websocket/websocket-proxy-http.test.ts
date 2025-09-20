/*
pnpm test websocket-proxy-http.test.ts

Test clients connecting a websocket to a non-websocket backend.
The connection should fail promptly and preserve the original error code.

See https://nodejs.org/api/http.html#event-response

DEVELOPMENT:

 pnpm test websocket-proxy-http.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import log from "../log";
import getPort from "../get-port";
import { once } from "node:events";
import {describe, it, expect, beforeAll, afterAll} from "vitest";

describe("Example of client requesting websocket when backend is plain http", () => {
  let ports: Record<'httpOnly' | 'proxy', number>;
  beforeAll(async () => {
    // assigns ports
    ports = { httpOnly: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};

  it("Create an http server that doesn't support websockets", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(418, { "Content-Type": "text/plain" });
      res.end("not a websocket!");
    });

    servers.httpOnly = server;
    server.listen(ports.httpOnly);
  });

  it("Try a websocket client connecting to a regular HTTP backend", async () => {
    const options = {
      port: ports.httpOnly,
      host: "localhost",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    const req = http.request(options);
    req.end();
    const [res] = await once(req, "response");
    expect(res.statusCode).toEqual(418);
    await once(res, "readable");
    const body = res.read().toString();
    expect(body.trim()).toEqual("not a websocket!");
    log("we got an http response.");
  });

  it("Create a proxy server pointed at the non-websocket server, expecting websockets", async () => {
    servers.proxy = httpProxy
      .createServer({ target: `ws://localhost:${ports.httpOnly}`, ws: true })
      .listen(ports.proxy);
  });

  it("Create a websocket client and test the proxy server", async () => {
    const options = {
      port: ports.proxy,
      host: "localhost",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    const req = http.request(options);
    req.end();
    const [res] = await once(req, "response");
    expect(res.statusCode).toEqual(418);
    await once(res, "readable");
    const body = res.read().toString();
    expect(body.trim()).toEqual("not a websocket!");
  });

  afterAll(async () => {
    // cleans up
    Object.values(servers).map((x: any) => x?.close());
  });
});
