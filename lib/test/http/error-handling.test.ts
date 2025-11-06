/*
  error-handling.tst.ts: Example of handle errors for HTTP and WebSockets
*/

import * as httpProxy from "../..";
import * as http from "node:http";
import getPort from "../get-port";
import log from "../log";
import fetch from "node-fetch";
import { describe, it, expect } from 'vitest';

const CUSTOM_ERROR = "There was an error proxying your request";

describe("Test proxying over HTTP with latency", () => {
  let ports: Record<'bad' | 'proxy', number>;
  it("gets ports", async () => {
    ports = { bad: await getPort(), proxy: await getPort() };
  });

  let servers: Record<string, http.Server> = {};
  let customWSErrorCalled = false;
  let customHttpErrorCalled = false;
  it("creates servers with bad target", () => {
    const proxy = httpProxy.createServer({
      target: `http://localhost:${ports.bad}`,
      timeout: 100,
    });

    servers.proxy = http.createServer((req, res) => {
      // Pass a callback to the web proxy method
      // and catch the error there.
      proxy.web(req, res, (err) => {
        // Now you can get the err
        // and handle it by yourself
        // if (err) {throw err;}
        log(`${err}`);
        customHttpErrorCalled = true;
        res.writeHead(502);
        res.end(CUSTOM_ERROR);
      });
    });
    // In a websocket upgrade
    servers.proxy.on("upgrade", (req, socket, head) => {
      proxy.ws(req, socket, head, (err) => {
        // Now you can get the err
        // and handle it by yourself
        // if (err) {throw err;}
        log(`Proxy websocket upgrade error: ${err}`);
        customWSErrorCalled = true;
        socket.destroy();
      });
    });
    servers.proxy.listen(ports.proxy);
  });

  it("makes http request and observes the custom error we installed", async () => {
    const a = await (await fetch(`http://localhost:${ports.proxy}`)).text();
    expect(a).toEqual(CUSTOM_ERROR);
    expect(customHttpErrorCalled).toBe(true);
  });

  it("makes websocket request and observer error", async () => {
    const options = {
      port: ports.proxy,
      host: "localhost",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    const err = await new Promise<Error>((resolve) => {
      const req = http.request(options);
      req.end();
      req.on("error", (err) => {
        log(`request error -- ${err}`);
        resolve(err);
      });
    });
    expect(err.message).toContain("socket hang up");
    expect(customWSErrorCalled).toBe(true);
  });

  it("Clean up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
