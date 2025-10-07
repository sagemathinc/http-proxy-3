/*
reverse-proxy.test.ts: Example of reverse proxying (with HTTPS support)

pnpm test ./reverse-proxy.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import * as net from "node:net";
import log from "../log";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import { describe, it, expect, afterAll, beforeAll } from 'vitest';

describe("Reverse proxying -- create a server that...", () => {
  let port: number;
  beforeAll(async () => {
    // allocates a port
    port = await getPort();
  });

  let server: http.Server;
  it("creates reverse proxy server", async () => {
    const proxy = httpProxy.createServer();
    server = http
      .createServer((req, res) => {
        log("Receiving reverse proxy request for:", req.url);
        const urlObj = new URL(req.url ?? "", "http://base.invalid");
        const target = urlObj.origin;
        proxy.web(req, res, { target, secure: false });
      })
      .listen(port);
    log(`Listening on http://localhost:${port}`);

    server.on("connect", (req, socket) => {
      log("Receiving reverse proxy request for:", req.url);

      const serverUrl = new URL(`https://${req.url}`);
      const srvSocket = net.connect(
        parseInt(serverUrl.port ? serverUrl.port : "443"),
        serverUrl.hostname!,
        () => {
          socket.write(
            "HTTP/1.1 200 Connection Established\r\n" +
              "Proxy-agent: Node-Proxy\r\n" +
              "\r\n",
          );
          srvSocket.pipe(socket);
          socket.pipe(srvSocket);
        },
      );
    });
  });

  it("Tests the reverse proxy out to access https://www.google.com using an http proxy running on localhost.", async () => {
    if (!process.env.TEST_EXTERNAL_REVERSE_PROXY) {
      // google tends to block CI
      return;
    }
    // The following code is like doing this on the
    // command line:
    //     curl -vv -x http://localhost:38207 https://www.google.com

    const proxy = `http://localhost:${port}`;
    const agent = new HttpsProxyAgent(proxy);
    const a = await (await fetch("https://www.google.com", { agent })).text();
    expect(a).toContain("Search the world");
  });

  it("Tests the reverse proxy out to access http://www.google.com and https://www.google.com using an http proxy running on localhost.", async () => {
    if (!process.env.TEST_EXTERNAL_REVERSE_PROXY) {
      // google tends to block CI
      return;
    }
    const proxy = `http://localhost:${port}`;
    const agent = new HttpsProxyAgent(proxy);
    const a = await (await fetch("http://www.google.com", { agent })).text();
    expect(a).toContain("Search the world");
  });

  afterAll(async () => {
    // Cleans up
    server.close();
  });
});
