/*
  error-handling.tst.ts: Example of handle errors for HTTP and WebSockets
*/

import * as httpProxy from "../..";
import * as http from "http";
import getPort from "../get-port";
import log from "../log";

const CUSTOM_ERROR = "There was an error proxying your request";

describe("Test proxying over HTTP with latency", () => {
  let ports;
  it("gets ports", async () => {
    ports = { bad: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};
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
        socket.destroy();
      });
    });
    servers.proxy.listen(ports.proxy);
  });

  it("makes a request and observes the custom error we installed", async () => {
    const a = await (await fetch(`http://localhost:${ports.proxy}`)).text();
    expect(a).toEqual(CUSTOM_ERROR);
  });

  it("makes a websocket attempt", async () => {
    const options = {
      port: ports.proxy,
      host: "localhost",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    const req = http.request(options);
    req.on("error", (err) => {
      log(`request error`, err.message);
    });
    //     await delay(1000);
    //     console.log("e = ", e);
    // await wait({ until: () => e });
    //console.log({ err });
    //expect(err.message).toContain("ECONNREFUSED");
  });

  it("Clean up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});
