/*
Example of proxying over HTTP using a forward proxy

A forward proxy just does the minimum to forward requests, not allowing
for customization, events, timeouts, etc.


DEVELOPMENT:

pnpm test forward-proxy.test.ts 
*/

import * as http from "http";
import * as httpProxy from "../../..";
import log from "../../log";
import getPort from "../../get-port";

describe("Example of proxying over HTTP with additional forward proxy", () => {
  let forwardingServer, httpPort;
  it("Setup Target Http Forwarding Server", async () => {
    httpPort = await getPort();
    forwardingServer = http.createServer((req, res) => {
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
    forwardingServer.listen(httpPort);
    log(`http server started on port ${httpPort}`);
  });

  let proxyServer, proxyPort;
  it("Setup proxy server with forwarding", async () => {
    proxyPort = await getPort();
    proxyServer = httpProxy.createServer({
      forward: {
        port: httpPort,
        host: "localhost",
      },
    });
    proxyServer.listen(proxyPort);
    log(`http proxy server started on port ${proxyPort}`);
  });

  it("Cleans up", () => {
    forwardingServer.close();
    proxyServer.close();
  });
});
