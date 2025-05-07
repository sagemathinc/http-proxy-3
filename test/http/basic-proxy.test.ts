/*
Test basic example of proxying over HTTP

DEVELOPMENT:

pnpm test basic-proxy.test.ts 
*/

import * as http from "http";
import * as httpProxy from "../..";
import log from "../log";
import getPort from "../get-port";

export async function server() {
  const httpPort = await getPort();
  const proxyPort = await getPort();
  // Target Http Server
  const target = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write(
      "request successfully proxied to: " +
        req.url +
        "\n" +
        JSON.stringify(req.headers, undefined, 2),
    );
    res.end();
  });
  target.listen(httpPort);

  // Basic Http Proxy Server
  const proxy = httpProxy
    .createServer({
      target: `http://localhost:${httpPort}`,
    })
    .listen(proxyPort);
  proxy.on("error", (e) => {
    log("error", e);
  });
  proxy.on("close", () => {
    log("proxy closed");
  });

  log(`http proxy server started on port ${proxyPort}`);
  log(`http server started on port ${httpPort}`);
  return { proxy, target, httpPort, proxyPort };
}

describe("tests proxying a basic http server", () => {
  it("does a consistency check", async () => {
    const { proxy, target, httpPort, proxyPort } = await server();
    const a = await (await fetch(`http://localhost:${httpPort}`)).text();
    expect(a).toContain("request successfully proxied");
    const b = await (await fetch(`http://localhost:${proxyPort}`)).text();
    expect(b).toContain("request successfully proxied");

    proxy.close();
    target.close();
  });
});
