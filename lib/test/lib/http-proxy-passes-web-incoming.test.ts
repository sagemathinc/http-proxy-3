/*
pnpm test ./http-proxy-passes-web-incoming.test.ts
*/

import {
  deleteLength,
  timeout,
  XHeaders,
} from "../../http-proxy/passes/web-incoming";
import * as httpProxy from "../..";
import * as http from "node:http";
import concat from "concat-stream";
import * as async from "async";
import getPort from "../get-port";
import { describe, it, expect, beforeAll } from "vitest";

describe("#deleteLength", () => {
  it("should change `content-length` for DELETE requests", () => {
    const stubRequest = {
      method: "DELETE",
      headers: {},
    } as any;
    deleteLength(stubRequest);
    expect(stubRequest.headers["content-length"]).toEqual("0");
  });

  it("should change `content-length` for OPTIONS requests", () => {
    const stubRequest = {
      method: "OPTIONS",
      headers: {},
    } as any;
    deleteLength(stubRequest);
    expect(stubRequest.headers["content-length"]).toEqual("0");
  });

  it("should remove `transfer-encoding` from empty DELETE requests", () => {
    const stubRequest = {
      method: "DELETE",
      headers: {
        "transfer-encoding": "chunked",
      },
    } as any;
    deleteLength(stubRequest);
    expect(stubRequest.headers["content-length"]).toEqual("0");
    expect(stubRequest.headers).not.toHaveProperty("transfer-encoding");
  });
});

describe("#timeout", () => {
  it("should set timeout on the socket", () => {
    let done: number | false = false;
    let stubRequest = {
      socket: {
        setTimeout: (value: number) => {
          done = value;
        },
      },
    };
    // @ts-ignore
    timeout(stubRequest, {}, { timeout: 5000 });
    expect(done).toEqual(5000);
  });
});

describe("#XHeaders", () => {
  const stubRequest = {
    connection: {
      remoteAddress: "192.168.1.2",
      remotePort: "8080",
    },
    headers: {
      host: "192.168.1.2:8080",
    } as Record<string, string>,
  };
  const stubHttp2Request = {
    connection: {
      remoteAddress: "192.168.1.2",
      remotePort: "8080",
    },
    headers: {
      ':authority': "192.168.1.2:8080",
    } as Record<string, string>,
  };

  it("set the correct x-forwarded-* headers", () => {
    // @ts-ignore
    XHeaders(stubRequest, {}, { xfwd: true });
    expect(stubRequest.headers["x-forwarded-for"]).toEqual("192.168.1.2");
    expect(stubRequest.headers["x-forwarded-port"]).toEqual("8080");
    expect(stubRequest.headers["x-forwarded-proto"]).toEqual("http");
    expect(stubRequest.headers["x-forwarded-host"]).toEqual("192.168.1.2:8080");
  });

  it("set the correct x-forwarded-* headers for http2", () => {
    // @ts-ignore
    XHeaders(stubHttp2Request, {}, { xfwd: true });
    expect(stubHttp2Request.headers["x-forwarded-for"]).toEqual("192.168.1.2");
    expect(stubHttp2Request.headers["x-forwarded-port"]).toEqual("8080");
    expect(stubHttp2Request.headers["x-forwarded-proto"]).toEqual("http");
    expect(stubHttp2Request.headers["x-forwarded-host"]).toEqual("192.168.1.2:8080");
  });
});

const ports: { [port: string]: number } = {};
function address(p: number | string) {
  return `http://127.0.0.1:${port(p)}`;
}
function port(p: number | string) {
  const x = ports[p];
  if (x == null) {
    throw Error(`invalid port ${p}`);
  }
  return x;
}

describe("#createProxyServer.web() using own http server", () => {
  beforeAll(async () => {
    for (let n = 8080; n < 8090; n++) {
      ports[`${n}`] = await getPort();
    }
  });

  it("should proxy the request using the web proxy handler", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy.createProxyServer({
        target: address(8080),
      });

      function requestHandler(
        req: http.IncomingMessage,
        res: http.ServerResponse,
      ) {
        proxy.web(req, res);
      }

      const proxyServer = http.createServer(requestHandler);

      const source = http.createServer((req, res) => {
        res.end();
        expect(req.method).toEqual("GET");
        if (process.env.FORCE_FETCH_PATH === "true") {
          expect(req.headers.host?.split(":")[1]).toEqual(`${ports["8080"]}`);
        } else {
          expect(req.headers.host?.split(":")[1]).toEqual(`${ports["8081"]}`);
        }
      });

      proxyServer.listen(ports["8081"]);
      source.listen(ports["8080"]);
      http
        .request(address(8081), () => {
          proxyServer.close();
          source.close();
          done();
        })
        .end();
    }));

  it.skipIf(() => process.env.FORCE_FETCH_PATH === "true")(
    "should detect a proxyReq event and modify headers",
    () =>
      new Promise<void>((done) => {
        const proxy = httpProxy.createProxyServer({
          target: address(8080),
        });

        proxy.on("proxyReq", (proxyReq, _req, _res, _options) => {
          proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
        });

        function requestHandler(
          req: http.IncomingMessage,
          res: http.ServerResponse,
        ) {
          proxy.web(req, res);
        }

        const proxyServer = http.createServer(requestHandler);

        const source = http.createServer((req, res) => {
          res.end();
          source.close();
          proxyServer.close();
          expect(req.headers["x-special-proxy-header"]).toEqual("foobar");
          done();
        });

        proxyServer.listen(ports["8081"]);
        source.listen(ports["8080"]);

        http.request(address(8081), () => {}).end();
      }),
  );

  it.skipIf(() => process.env.FORCE_FETCH_PATH === "true")(
    'should skip proxyReq event when handling a request with header "expect: 100-continue" [https://www.npmjs.com/advisories/1486]',
    () =>
      new Promise<void>((done) => {
        const proxy = httpProxy.createProxyServer({
          target: address(8080),
        });

        proxy.on("proxyReq", (proxyReq, _req, _res, _options) => {
          proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
        });

        function requestHandler(
          req: http.IncomingMessage,
          res: http.ServerResponse,
        ) {
          proxy.web(req, res);
        }

        const proxyServer = http.createServer(requestHandler);

        const source = http.createServer((req, res) => {
          res.end();
          source.close();
          proxyServer.close();
          expect(req.headers["x-special-proxy-header"]).not.toEqual("foobar");
          done();
        });

        proxyServer.listen(ports["8081"]);
        source.listen(ports["8080"]);

        const postData = "".padStart(1025, "x");

        const postOptions = {
          hostname: "127.0.0.1",
          port: ports["8081"],
          path: "/",
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData),
            expect: "100-continue",
          },
        };

        const req = http.request(postOptions, () => {});
        req.write(postData);
        req.end();
      }),
  );

  it("should proxy the request and handle error via callback", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy.createProxyServer({
        target: address(8080),
        timeout: 100,
      });

      const proxyServer = http.createServer(requestHandler);

      function requestHandler(
        req: http.IncomingMessage,
        res: http.ServerResponse,
      ) {
        proxy.web(req, res, (err) => {
          proxyServer.close();
          expect((err as NodeJS.ErrnoException).code).toEqual("ECONNREFUSED");
          done();
        });
      }

      proxyServer.listen(ports["8082"]);

      const client = http.request(
        {
          hostname: "127.0.0.1",
          port: ports["8082"],
          method: "GET",
        },
        () => {},
      );
      client.on("error", () => {});
      client.end();
    }));

  it("should proxy the request and handle error via event listener", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy.createProxyServer({
        target: address(8080),
        timeout: 100,
      });

      const proxyServer = http.createServer(requestHandler);

      function requestHandler(
        req: http.IncomingMessage,
        res: http.ServerResponse,
      ) {
        proxy.once("error", (err, errReq, errRes) => {
          proxyServer.close();
          expect(errReq).toEqual(req);
          expect(errRes).toEqual(res);
          expect((err as NodeJS.ErrnoException).code).toEqual("ECONNREFUSED");
          done();
        });

        proxy.web(req, res);
      }

      proxyServer.listen(ports["8083"]);

      const client = http.request(
        {
          hostname: "127.0.0.1",
          port: ports["8083"],
          method: "GET",
        },
        () => {},
      );
      client.on("error", () => {});
      client.end();
    }));

  it("should forward the request and handle error via event listener", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy.createProxyServer({
        forward: "http://127.0.0.1:8080",
        timeout: 100,
      });

      const proxyServer = http.createServer(requestHandler);

      function requestHandler(
        req: http.IncomingMessage,
        res: http.ServerResponse,
      ) {
        proxy.once("error", (err, errReq, errRes) => {
          proxyServer.close();
          expect(errReq).toEqual(req);
          expect(errRes).toEqual(res);
          expect((err as NodeJS.ErrnoException).code).toEqual("ECONNREFUSED");
          done();
        });

        proxy.web(req, res);
      }

      proxyServer.listen(ports["8083"]);

      const client = http.request(
        {
          hostname: "127.0.0.1",
          port: ports["8083"],
          method: "GET",
        },
        () => {},
      );
      client.on("error", () => {});
      client.end();
    }));

  it("should proxy the request and handle timeout error (proxyTimeout)", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy.createProxyServer({
        target: address(8083),
        proxyTimeout: 100,
        timeout: 150, // so client exits and isn't left handing the test.
      });

      const server = require("net").createServer().listen(ports["8083"]);

      const started = Date.now();
      function requestHandler(
        req: http.IncomingMessage,
        res: http.ServerResponse,
      ) {
        proxy.once("error", (err, errReq, errRes) => {
          proxyServer.close();
          server.close();
          expect(errReq).toEqual(req);
          expect(errRes).toEqual(res);
          expect(Date.now() - started).toBeGreaterThan(99);
          expect((err as NodeJS.ErrnoException).code).toBeOneOf([
            "ECONNRESET",
            23,
          ]);
          done();
        });

        proxy.web(req, res);
      }

      const proxyServer = http.createServer(requestHandler);
      proxyServer.listen(ports["8084"]);

      const client = http.request(
        {
          hostname: "127.0.0.1",
          port: ports["8084"],
          method: "GET",
        },
        () => {},
      );
      client.on("error", () => {});
      client.end();
    }));

  it("should proxy the request and handle timeout error", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy.createProxyServer({
        target: address(8083),
        timeout: 100,
      });

      const server = require("net").createServer().listen(ports["8083"]);

      const proxyServer = http.createServer(requestHandler);

      let cnt = 0;
      const doneOne = () => {
        cnt += 1;
        if (cnt === 2) done();
      };

      const started = Date.now();
      function requestHandler(
        req: http.IncomingMessage,
        res: http.ServerResponse,
      ) {
        proxy.once("econnreset", (err, errReq, errRes) => {
          proxyServer.close();
          server.close();
          expect(errReq).toEqual(req);
          expect(errRes).toEqual(res);
          expect((err as NodeJS.ErrnoException).code).toEqual("ECONNRESET");
          doneOne();
        });

        proxy.web(req, res);
      }

      proxyServer.listen(ports["8085"]);

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: ports["8085"],
          method: "GET",
        },
        () => {},
      );

      req.on("error", (err) => {
        // @ts-ignore
        expect(err.code).toEqual("ECONNRESET");
        expect(Date.now() - started).toBeGreaterThan(99);
        doneOne();
      });
      req.end();
    }));

  it(
    "should proxy the request and provide a proxyRes event with the request and response parameters",
    () =>
      new Promise<void>((done) => {
        const proxy = httpProxy.createProxyServer({
          target: address(8080),
        });

        function requestHandler(
          req: http.IncomingMessage,
          res: http.ServerResponse,
        ) {
          proxy.once("proxyRes", (proxyRes, pReq, pRes) => {
            source.close();
            proxyServer.close();
            expect(proxyRes != null).toBe(true);
            expect(pReq).toEqual(req);
            expect(pRes).toEqual(res);
            done();
          });

          proxy.web(req, res);
        }

        const proxyServer = http.createServer(requestHandler);

        const source = http.createServer((_req, res) => {
          res.end("Response");
        });

        proxyServer.listen(port(8086));
        source.listen(port(8080));
        http.request(address(8086), () => {}).end();
      }),
  );

  it.skipIf(() => process.env.FORCE_FETCH_PATH === "true")(
    "should proxy the request and provide and respond to manual user response when using modifyResponse",
    () =>
      new Promise((done) => {
        const proxy = httpProxy.createProxyServer({
          target: address(8080),
          selfHandleResponse: true,
        });

        function requestHandler(
          req: http.IncomingMessage,
          res: http.ServerResponse,
        ) {
          proxy.once("proxyRes", (proxyRes, _pReq, pRes) => {
            proxyRes.pipe(
              concat((body) => {
                expect(body.toString("utf8")).toEqual("Response");
                pRes.end(Buffer.from("my-custom-response"));
              }),
            );
          });

          proxy.web(req, res);
        }

        const proxyServer = http.createServer(requestHandler);

        const source = http.createServer((_req, res) => {
          res.end("Response");
        });

        async.parallel(
          [
            (next) => proxyServer.listen(port(8086), next),
            (next) => source.listen(port(8080), next),
          ],
          (_err) => {
            http
              .get(address(8086), (res) => {
                res.pipe(
                  concat((body) => {
                    expect(body.toString("utf8")).toEqual("my-custom-response");
                    source.close();
                    proxyServer.close();
                    done(undefined);
                  }),
                );
              })
              .once("error", (err) => {
                source.close();
                proxyServer.close();
                done(err);
              });
          },
        );
      }),
  );

  it("should proxy the request and handle changeOrigin option", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy
        .createProxyServer({
          target: address(8080),
          changeOrigin: true,
        })
        .listen(port(8081));

      const source = http
        .createServer((req, res) => {
          source.close();
          proxy.close();
          expect(req.method).toEqual("GET");
          expect(req.headers.host?.split(":")[1]).toEqual(`${port(8080)}`);
          res.end();
          done();
        })
        .listen(port(8080));

      const client = http.request(address(8081), () => {});
      client.on("error", () => {});
      client.end();
    }));

  it("should proxy the request with the Authorization header set", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy.createProxyServer({
        target: address(8080),
        auth: "user:pass",
      });
      const proxyServer = http.createServer(proxy.web);

      const source = http.createServer((req, res) => {
        source.close();
        proxyServer.close();
        const auth = Buffer.from(
          req.headers.authorization?.split(" ")[1] ?? "",
          "base64",
        );
        expect(req.method).toEqual("GET");
        expect(auth.toString()).toEqual("user:pass");
        res.end();
        done();
      });

      proxyServer.listen(port(8081));
      source.listen(port(8080));

      http.request(address(8081), () => {}).end();
    }));

  it("should proxy requests to multiple servers with different options", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy.createProxyServer({xfwd: true});

      // proxies to two servers depending on url, rewriting the url as well
      // http://127.0.0.1:8080/s1/ -> http://127.0.0.1:8081/
      // http://127.0.0.1:8080/ -> http://127.0.0.1:8082/
      function requestHandler(
        req: http.IncomingMessage,
        res: http.ServerResponse,
      ) {
        if (req.url!.startsWith("/s1/")) {
          const target = address(8081) + req.url!.substring(3);
          proxy.web(req, res, {
            ignorePath: true,
            target,
          });
        } else {
          proxy.web(req, res, {
            target: address(8082),
          });
        }
      }

      const proxyServer = http.createServer(requestHandler);

      const source1 = http.createServer((req, res) => {
        expect(req.method).toEqual("GET");
        expect((req.headers["x-forwarded-host"] as string)?.split(":")[1]).toEqual(`${port(8080)}`);
        expect(req.url).toEqual("/test1");
        res.end();
      });

      const source2 = http.createServer((req, res) => {
        source1.close();
        source2.close();
        proxyServer.close();
        expect(req.method).toEqual("GET");
        expect((req.headers["x-forwarded-host"] as string)?.split(":")[1]).toEqual(`${port(8080)}`);
        expect(req.url).toEqual("/test2");
        res.end();
        done();
      });

      proxyServer.listen(port(8080));
      source1.listen(port(8081));
      source2.listen(port(8082));

      http.request(`${address(8080)}/s1/test1`, () => {}).end();
      http.request(`${address(8080)}/test2`, () => {}).end();
    }));
});

describe("with authorization request header", () => {
  const headers = {
    authorization: `Bearer ${Buffer.from("dummy-oauth-token").toString(
      "base64",
    )}`,
  };

  it("should proxy the request with the Authorization header set", () =>
    new Promise<void>((done) => {
      const auth = "user:pass";
      const proxy = httpProxy.createProxyServer({
        target: address(8080),
        auth,
      });
      const proxyServer = http.createServer(proxy.web);

      const source = http.createServer((req, res) => {
        source.close();
        proxyServer.close();
        expect(req).toEqual(
          expect.objectContaining({
            method: "GET",
            headers: expect.objectContaining({
              authorization: `Basic ${Buffer.from(auth).toString("base64")}`,
            }),
          }),
        );
        res.end();
        done();
      });

      proxyServer.listen(port(8081));
      source.listen(port(8080));

      http
        .request(address(8081), {
          headers,
        })
        .end();
    }));
});

describe("#followRedirects", () => {
  it("gets some ports", async () => {
    for (let n = 8080; n < 8082; n++) {
      ports[`${n}`] = await getPort();
    }
  });

  it("should proxy the request follow redirects", () =>
    new Promise<void>((done) => {
      const proxy = httpProxy
        .createProxyServer({
          target: address(8080),
          followRedirects: true,
        })
        .listen(port(8081));

      const source = http
        .createServer((req, res) => {
          if (
            new URL(req.url ?? "", "http://base.invalid").pathname ===
            "/redirect"
          ) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("ok");
            return;
          }
          res.writeHead(301, { Location: "/redirect" });
          res.end();
        })
        .listen(port(8080));

      const client = http.request(address(8081), (res) => {
        source.close();
        proxy.close();
        expect(res.statusCode).toEqual(200);
        done();
      });
      client.end();
    }));
});
