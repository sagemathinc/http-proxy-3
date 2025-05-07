/*
  forward-and-target-proxy.js: Example of proxying over HTTP with 
  additional forward proxy to a different server.
  
  See also forward-proxy.test.ts.
  
  pnpm test forward-and-target-proxy.test.ts 
*/

import * as http from "http";
import * as httpProxy from "../../..";
import log from "../../log";
import getPort from "../../get-port";
import wait from "../../wait";

describe("Example of proxying over HTTP with additional forward proxy to a different server", () => {
  let ports;
  it("gets ports", async () => {
    ports = {
      target: await getPort(),
      forward: await getPort(),
      proxy: await getPort(),
    };
  });

  let servers: any = {};
  let counts = { target: 0, forward: 0 };

  it("Setup proxy server with target *AND* forwarding", () => {
    servers.proxy = httpProxy.createServer({
      target: {
        port: ports.target,
        host: "localhost",
      },
      forward: {
        port: ports.forward,
        host: "localhost",
      },
    });
    servers.proxy.listen(ports.proxy);
  });

  it("Setup target http server", () => {
    servers.target = http.createServer(function (req, res) {
      counts.target += 1;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write(
        "request successfully proxied to: " +
          req.url +
          "\n" +
          JSON.stringify(req.headers, undefined, 2),
      );
      res.end();
    });
    servers.target.listen(ports.target);
  });

  it("Target Http Forwarding Server", () => {
    servers.forward = http.createServer(function (req, res) {
      counts.forward += 1;
      log("Receiving forward for: " + req.url);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write(
        "request successfully forwarded to: " +
          req.url +
          "\n" +
          JSON.stringify(req.headers, undefined, 2),
      );
      res.end();
    });
    servers.forward.listen(ports.forward);
  });

  it("Makes a request to the proxy and sees that counts go up", async () => {
    const before = { ...counts };
    const b = await (await fetch(`http://localhost:${ports.proxy}`)).text();
    // This b is supposed to be empty, because the
    expect(b).toContain("request successfully proxied to");
    await wait({
      until: () =>
        counts.target > before.target && counts.forward > before.forward,
    });
    expect(counts.target).toBe(before.target + 1);
    expect(counts.forward).toBe(before.forward + 1);
  });

  it("Clean up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
