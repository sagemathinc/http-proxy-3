/*
  custom-proxy-error.test.ts: Example of using the custom `proxyError` event.

pnpm test ./custom-proxy-error.test.ts
*/

import * as httpProxy from "../..";
import * as http from "http";
import getPort from "../get-port";
import fetch from "node-fetch";

const CUSTOM_ERROR =
  "Something went wrong. And we are reporting a custom error message.";

describe("Test proxying over HTTP with latency", () => {
  let ports: Record<'bad' | 'proxy', number>;
  it("gets ports", async () => {
    ports = { bad: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};
  it("creates servers with bad target", () => {
    const proxy = httpProxy
      .createServer({
        target: `http://localhost:${ports.bad}`,
        timeout: 100,
      })
      .listen(ports.proxy);

    proxy.on("error", (_err, _req, res) => {
      (res as http.ServerResponse).writeHead(500, {
        "Content-Type": "text/plain",
      });
      res.end(CUSTOM_ERROR);
    });

    servers.proxy = proxy;
  });

  it("makes a request and observes the custom error we installed", async () => {
    const a = await (await fetch(`http://localhost:${ports.proxy}`)).text();
    expect(a).toEqual(CUSTOM_ERROR);
  });

  it("Clean up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
