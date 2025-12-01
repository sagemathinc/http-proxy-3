/*

pnpm test ./http-proxy.test.ts

*/

import * as httpProxy from "../..";
import * as http from "node:http";
import getPort from "../get-port";
import * as net from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { Server } from "socket.io";
import { io as socketioClient } from "socket.io-client";
import wait from "../wait";
import { once } from "node:events";
import { describe, it, expect, beforeAll } from "vitest";

const ports: { [port: string]: number } = {};
let portIndex = -1;
const gen = {} as { port: number };
Object.defineProperty(gen, "port", {
  get: function get() {
    portIndex++;
    return ports[portIndex];
  },
});

beforeAll(async () => {
  //creates some ports
    for (let n = 0; n < 50; n++) {
      ports[n] = await getPort();
    }

  });

describe("#createProxyServer", () => {
  it("should NOT throw without options -- options are only required later when actually using the proxy", () => {
    httpProxy.createProxyServer();
  });

  it("should return an object otherwise", () => {
    const obj = httpProxy.createProxyServer({
      target: "http://www.google.com:80",
    });
    expect(obj).toBeInstanceOf(httpProxy.ProxyServer);
    expect(typeof httpProxy.ProxyServer).toBe("function");
    expect(typeof obj).toBe("object");
  });


describe("#createProxyServer with forward options and using web-incoming passes", () => {
  it("should pipe the request using web-incoming#stream method", () =>
    new Promise<void>((done) => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy
        .createProxyServer({
          forward: "http://127.0.0.1:" + ports.source,
          xfwd: true
        })
        .listen(ports.proxy);

      const source = http
        .createServer((req, res) => {
          res.end();
          expect(req.method).toEqual("GET");
          expect((req.headers["x-forwarded-host"] as string).split(":")[1]).toEqual(`${ports.proxy}`);
          source.close();
          proxy.close();
          done();
        })
        .listen(ports.source);

      http.request("http://127.0.0.1:" + ports.proxy, () => {}).end();
    }));
});

describe("#createProxyServer using the web-incoming passes", () => {
  // NOTE: the sse test that was here is now in http/server-sent-events.test.ts

  it("should make the request on pipe and finish it", () =>
    new Promise<void>((done) => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy
        .createProxyServer({
          target: "http://127.0.0.1:" + ports.source,
          xfwd: true,
        })
        .listen(ports.proxy);

      const source = http
        .createServer((req, res) => {
          expect(req.method).toEqual("POST");
          expect(req.headers["x-forwarded-for"]).toContain("127.0.0.1");
          expect((req.headers["x-forwarded-host"] as string).split(":")[1]).toEqual(`${ports.proxy}`);
          res.end();
          source.close();
          proxy.close();
          done();
        })
        .listen(ports.source);

      http
        .request(
          {
            hostname: "127.0.0.1",
            port: ports.proxy,
            method: "POST",
            headers: {
              "x-forwarded-for": "127.0.0.1",
            },
          },
          () => {},
        )
        .end();
    }));
});

describe("#createProxyServer using the web-incoming passes", () => {
  it.skipIf(() => process.env.FORCE_FETCH_PATH === "true")(
    "should make the request, handle response and finish it",
    () =>
      new Promise<void>((done) => {
        const ports = { source: gen.port, proxy: gen.port };
        const proxy = httpProxy
          .createProxyServer({
            target: "http://127.0.0.1:" + ports.source,
            preserveHeaderKeyCase: true,
          })
          .listen(ports.proxy);

        const source = http
          .createServer((req, res) => {
            expect(req.method).toEqual("GET");
            expect(req.headers.host?.split(":")[1]).toEqual(`${ports.proxy}`);
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Hello from " + ports.source);
          })
          .listen(ports.source);

        http
          .request(
            {
              hostname: "127.0.0.1",
              port: ports.proxy,
              method: "GET",
            },
            (res) => {
              expect(res.statusCode).toEqual(200);
              expect(res.headers["content-type"]).toEqual("text/plain");
              if (res.rawHeaders != undefined) {
                expect(res.rawHeaders.indexOf("Content-Type")).not.toEqual(-1);
                expect(res.rawHeaders.indexOf("text/plain")).not.toEqual(-1);
              }

              res.on("data", function (data) {
                expect(data.toString()).toEqual("Hello from " + ports.source);
              });

              res.on("end", () => {
                source.close();
                proxy.close();
                done();
              });
            },
          )
          .end();
      }),
  );
});

describe("#createProxyServer() method with error response", () => {
  it("should make the request and emit the error event", () =>
    new Promise<void>((done) => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
        target: "http://127.0.0.1:" + ports.source,
        timeout: 100,
      });

      proxy
        .on("error", (err) => {
          expect((err as NodeJS.ErrnoException).code).toEqual("ECONNREFUSED");
          proxy.close();
          done();
        })
        .listen(ports.proxy);

      const client = http.request(
        {
          hostname: "127.0.0.1",
          port: ports.proxy,
          method: "GET",
        },
        () => {},
      );
      client.on("error", () => {});
      client.end();
    }));
});

describe("#createProxyServer setting the correct timeout value", () => {
  it("should hang up the socket at the timeout", () =>
    new Promise<void>((done) => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy
        .createProxyServer({
          target: "http://127.0.0.1:" + ports.source,
          timeout: 3,
        })
        .listen(ports.proxy);

      proxy.on("error", (e) => {
        expect((e as NodeJS.ErrnoException).code).toEqual("ECONNRESET");
      });

      const source = http.createServer((_req, res) => {
        setTimeout(() => {
          res.end("At this point the socket should be closed");
        }, 5);
      });

      source.listen(ports.source);

      const testReq = http.request(
        {
          hostname: "127.0.0.1",
          port: ports.proxy,
          method: "GET",
        },
        () => {},
      );

      testReq.on("error", function (e) {
        // @ts-ignore
        expect(e.code).toEqual("ECONNRESET");
        proxy.close();
        source.close();
        done();
      });

      testReq.end();
    }));
});

describe("#createProxyServer with xfwd option", () => {
  it("should not throw on empty http host header", () =>
    new Promise<void>((done) => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy
        .createProxyServer({
          forward: "http://127.0.0.1:" + ports.source,
          xfwd: true,
        })
        .listen(ports.proxy);

      const source = http
        .createServer((req, res) => {
          expect(req.method).toEqual("GET");
          expect(req.headers.host?.split(":")[1]).toEqual(`${ports.source}`);
          res.end();
          source.close();
          proxy.close();
          done();
        })
        .listen(ports.source);

      const socket = net.connect({ port: ports.proxy }, () => {
        socket.write("GET / HTTP/1.0\r\n\r\n");
      });

      // handle errors
      socket.on("error", (err) => {
        console.log("socket error ", err);
        //expect.fail("Unexpected socket error");
      });

      socket.on("data", (_data) => {
        socket.end();
      });

      socket.on("end", () => {});
    }));
});

describe("#createProxyServer using the ws-incoming passes", () => {
  it("should proxy the websockets stream", () =>
    new Promise<void>((done) => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
          target: "ws://127.0.0.1:" + ports.source,
          ws: true,
        }),
        proxyServer = proxy.listen(ports.proxy),
        destiny = new WebSocketServer({ port: ports.source }, () => {
          const client = new WebSocket("ws://127.0.0.1:" + ports.proxy);

          client.on("open", () => {
            client.send("hello there");
          });

          client.on("message", (msg) => {
            expect(msg.toString()).toEqual("Hello over websockets");
            client.close();
            proxyServer.close();
            destiny.close();
            done();
          });
        });

      destiny.on("connection", (socket) => {
        socket.on("message", (msg) => {
          expect(msg.toString()).toEqual("hello there");
          socket.send("Hello over websockets");
        });
      });
    }));

  it("should emit error on proxy error", () =>
    new Promise<void>((done) => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
          // note: we don't ever listen on this port
          target: "ws://127.0.0.1:" + ports.source,
          ws: true,
        }),
        proxyServer = proxy.listen(ports.proxy),
        client = new WebSocket("ws://127.0.0.1:" + ports.proxy);

      client.on("open", () => {
        client.send("hello there");
      });

      let count = 0;
      function maybe_done() {
        count += 1;
        if (count === 2) done();
      }

      client.on("error", (err) => {
        expect((err as NodeJS.ErrnoException).code).toEqual("ECONNRESET");
        maybe_done();
      });

      proxy.on("error", (err) => {
        expect((err as NodeJS.ErrnoException).code).toEqual("ECONNREFUSED");
        proxyServer.close();
        maybe_done();
      });
    }));

  it("should close client socket if upstream is closed before upgrade", async () => {
    const ports = { source: gen.port, proxy: gen.port };
    const server = http.createServer();
    server
      .on("upgrade", (_req, socket, _head) => {
        socket.end();
      })
      .listen(ports.source);

    // First test without proxy
    let options = {
      port: ports.source,
      host: "localhost",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    let req = http.request(options);
    req.end();
    let err = await once(req, "error");
    expect(`${err}`).toContain("socket hang up");

    // Now test with the proxy

    const proxy = httpProxy
      .createProxyServer({
        target: "ws://127.0.0.1:" + ports.source,
        ws: true,
      })
      .listen(ports.proxy);
    proxy.on("error", (err) => {
      expect(`${err}`).toContain("socket hang up");
    });

    options = {
      port: ports.proxy,
      host: "localhost",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    };
    req = http.request(options);
    req.end();
    err = await once(req, "error");
    expect(`${err}`).toContain("socket hang up");

    server.close();
    proxy.close();
  });

  // there's also a socket io test in
  //    test/websocket/websocket-proxy.test.ts
  it("should proxy a socket.io stream", async () => {
    const ports = { source: gen.port, proxy: gen.port };
    const proxy = httpProxy
      .createProxyServer({
        target: "ws://127.0.0.1:" + ports.source,
        ws: true,
      })
      .listen(ports.proxy);

    const server = http.createServer().listen(ports.source);
    const io = new Server(server);

    io.on("connection", (client) => {
      client.on("message", (msg) => {
        expect(msg).toEqual("hello there");
        client.send("Hello over websockets");
      });
    });

    // no proxy
    const client0 = socketioClient("ws://127.0.0.1:" + ports.source);
    client0.send("hello there");
    const msg0 = await once(client0 as any, "message");
    expect(msg0).toEqual(["Hello over websockets"]);
    client0.close();

    // via proxy
    const client = socketioClient("ws://127.0.0.1:" + ports.proxy);
    client.send("hello there");
    const msg = await once(client as any, "message");
    expect(msg).toEqual(["Hello over websockets"]);
    client.close();

    // clean up
    proxy.close();
    server.close();
  });

  it("should emit open and close events when socket.io client connects and disconnects", async () => {
    const ports = { source: gen.port, proxy: gen.port };
    const proxy = httpProxy
      .createProxyServer({
        target: "ws://127.0.0.1:" + ports.source,
        ws: true,
      })
      .listen(ports.proxy);

    let opens = 0;
    proxy.on("open", () => {
      opens++;
    });

    let closes = 0;
    proxy.on("close", () => {
      closes++;
    });

    const server = http.createServer().listen(ports.source);
    const io = new Server(server);

    io.on("connection", (client) => {
      client.on("message", (msg) => {
        expect(msg).toEqual("hello there");
        client.send("Hello over websockets");
      });
    });

    const N = 25;
    for (let i = 0; i < N; i++) {
      const client = socketioClient("ws://127.0.0.1:" + ports.proxy);
      client.send("hello there");
      const msg = await once(client as any, "message");
      expect(msg).toEqual(["Hello over websockets"]);
      client.close();
    }
    expect(opens).toBe(N);
    await wait({ until: () => closes >= N });
    expect(closes).toBe(N);

    proxy.close();
    server.close();
  });

  it("should pass all set-cookie headers to client", async () => {
    const ports = { source: gen.port, proxy: gen.port };
    const proxy = httpProxy
      .createProxyServer({
        target: "ws://127.0.0.1:" + ports.source,
        ws: true,
      })
      .listen(ports.proxy);

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("okay");
    });
    server.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Web Socket Protocol Handshake\r\n" +
          "Upgrade: WebSocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Set-Cookie: test1=test1\r\n" +
          "Set-Cookie: test2=test2\r\n" +
          "\r\n",
      );
      socket.pipe(socket); // echo back
    });
    server.listen(ports.source);

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
    const [res] = await once(req, "upgrade");
    expect(res.headers["set-cookie"]).toEqual(["test1=test1", "test2=test2"]);
    res.socket.end();
    server.close();
    proxy.close();
  });

  it("should detect a proxyReq event and modify headers", async () => {
    const ports = { source: gen.port, proxy: gen.port };
    const proxy = httpProxy
      .createProxyServer({
        target: "ws://127.0.0.1:" + ports.source,
        ws: true,
      })
      .listen(ports.proxy);

    proxy.on("proxyReqWs", (proxyReq, _req, _socket, _options, _head) => {
      proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
    });

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("okay");
    });
    let gotSpecialHeader = false;
    server.on("upgrade", (req, socket) => {
      if (req.headers["x-special-proxy-header"] == "foobar") {
        gotSpecialHeader = true;
      }
      socket.write(
        "HTTP/1.1 101 Web Socket Protocol Handshake\r\n" +
          "Upgrade: WebSocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
      socket.pipe(socket); // echo back
    });
    server.listen(ports.source);

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
    const [res] = await once(req, "upgrade");
    expect(gotSpecialHeader).toBe(true);

    res.socket.end();
    server.close();
    proxy.close();
  });

  it("should forward frames with single frame payload", () =>
    new Promise<void>((done) => {
      const payload = Buffer.from(Array(65529).join("0"));

      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
          target: "ws://127.0.0.1:" + ports.source,
          ws: true,
        }),
        proxyServer = proxy.listen(ports.proxy),
        destiny = new WebSocketServer({ port: ports.source }, () => {
          const client = new WebSocket("ws://127.0.0.1:" + ports.proxy);

          client.on("open", () => {
            client.send(payload);
          });

          client.on("message", (msg) => {
            expect(msg.toString()).toEqual("Hello over websockets");
            client.close();
            proxyServer.close();
            destiny.close();
            done();
          });
        });

      destiny.on("connection", (socket) => {
        socket.on("message", (msg) => {
          expect(msg).toEqual(payload);
          socket.send("Hello over websockets");
        });
      });
    }));

  it("should forward continuation frames with big payload (including on node 4.x)", () =>
    new Promise<void>((done) => {
      const payload = Buffer.from(Array(65530).join("0"));

      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
          target: "ws://127.0.0.1:" + ports.source,
          ws: true,
        }),
        proxyServer = proxy.listen(ports.proxy),
        destiny = new WebSocketServer({ port: ports.source }, () => {
          const client = new WebSocket("ws://127.0.0.1:" + ports.proxy);

          client.on("open", () => {
            client.send(payload);
          });

          client.on("message", (msg) => {
            expect(msg.toString()).toEqual("Hello over websockets");
            client.close();
            proxyServer.close();
            destiny.close();
            done();
          });
        });

      destiny.on("connection", (socket) => {
        socket.on("message", (msg) => {
          expect(msg).toEqual(payload);
          socket.send("Hello over websockets");
        });
      });
    }));
});
})