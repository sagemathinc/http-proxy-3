/*
pnpm test proxy-http-to-https.test.ts

We proxy https://google.com via a local non-https http server.
*/

import * as https from "https";
import * as httpProxy from "../../..";
import getPort from "../../get-port";

describe(" Basic example of proxying over HTTP to a target HTTPS server", () => {
  let port, server;
  it("creates the proxy server with HTTPS target", async () => {
    port = await getPort();
    server = httpProxy
      .createProxyServer({
        target: "https://google.com",
        agent: https.globalAgent,
        headers: {
          host: "google.com",
        },
      })
      .listen(port);
  });

  it("queries the proxy server as a test", async () => {
    const r = await (await fetch(`http://localhost:${port}`)).text();
    expect(r).toContain("Search the world");
  });

  it("clean up", () => {
    server.close();
  });
});
