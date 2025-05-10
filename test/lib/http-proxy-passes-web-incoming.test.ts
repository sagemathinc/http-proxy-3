/*
pnpm test ./http-proxy-passes-web-incoming.test.ts
*/

import {
  deleteLength,
  timeout,
  XHeaders,
} from "../../dist/lib/http-proxy/passes/web-incoming";
import * as httpProxy from "../..";
import * as http from "http";
// import * as concat from "concat-stream";
// import * as async from "async";
import getPort from "../get-port";

describe("#deleteLength", () => {
  it("should change `content-length` for DELETE requests", () => {
    const stubRequest = {
      method: "DELETE",
      headers: {},
    };
    deleteLength(stubRequest, {}, {});
    expect(stubRequest.headers["content-length"]).toEqual("0");
  });

  it("should change `content-length` for OPTIONS requests", () => {
    const stubRequest = {
      method: "OPTIONS",
      headers: {},
    };
    deleteLength(stubRequest, {}, {});
    expect(stubRequest.headers["content-length"]).toEqual("0");
  });

  it("should remove `transfer-encoding` from empty DELETE requests", () => {
    const stubRequest = {
      method: "DELETE",
      headers: {
        "transfer-encoding": "chunked",
      },
    };
    deleteLength(stubRequest, {}, {});
    expect(stubRequest.headers["content-length"]).toEqual("0");
    expect(stubRequest.headers).not.toHaveProperty("transfer-encoding");
  });
});

describe("#timeout", () => {
  it("should set timeout on the socket", () => {
    let done = false;
    let stubRequest = {
      socket: {
        setTimeout: (value) => {
          done = value;
        },
      },
    };

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
    },
  };

  it("set the correct x-forwarded-* headers", () => {
    XHeaders(stubRequest, {}, { xfwd: true });
    expect(stubRequest.headers["x-forwarded-for"]).toEqual("192.168.1.2");
    expect(stubRequest.headers["x-forwarded-port"]).toEqual("8080");
    expect(stubRequest.headers["x-forwarded-proto"]).toEqual("http");
  });
});

const ports: { [port: string]: number } = {};
function address(port: number) {
  if (ports[port] == null) {
    throw Error(`invalid port ${port}`);
  }
  return `http://127.0.0.1:${ports[port]}`;
}

describe("#createProxyServer.web() using own http server", () => {
  it("gets some ports", async () => {
    for (let n = 8080; n < 8090; n++) {
      ports[`${n}`] = await getPort();
    }
  });

  it("should proxy the request using the web proxy handler", (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      res.end();
      expect(req.method).toEqual("GET");
      expect(req.headers.host?.split(":")[1]).toEqual(`${ports["8081"]}`);
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
  });

  it("should detect a proxyReq event and modify headers", (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    proxy.on("proxyReq", (proxyReq, _req, _res, _options) => {
      proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
    });

    function requestHandler(req, res) {
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
  });

  it('should skip proxyReq event when handling a request with header "expect: 100-continue" [https://www.npmjs.com/advisories/1486]', (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    proxy.on("proxyReq", (proxyReq, _req, _res, _options) => {
      proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
    });

    function requestHandler(req, res) {
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
  });

  it("should proxy the request and handle error via callback", (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      timeout: 100,
    });

    const proxyServer = http.createServer(requestHandler);

    function requestHandler(req, res) {
      proxy.web(req, res, (err) => {
        proxyServer.close();
        expect(err.code).toEqual("ECONNREFUSED");
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
  });

  it("should proxy the request and handle error via event listener", (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      timeout: 100,
    });

    const proxyServer = http.createServer(requestHandler);

    function requestHandler(req, res) {
      proxy.once("error", (err, errReq, errRes) => {
        proxyServer.close();
        expect(errReq).toEqual(req);
        expect(errRes).toEqual(res);
        expect(err.code).toEqual("ECONNREFUSED");
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
  });

  it("should forward the request and handle error via event listener", (done) => {
    const proxy = httpProxy.createProxyServer({
      forward: "http://127.0.0.1:8080",
      timeout: 100,
    });

    const proxyServer = http.createServer(requestHandler);

    function requestHandler(req, res) {
      proxy.once("error", (err, errReq, errRes) => {
        proxyServer.close();
        expect(errReq).toEqual(req);
        expect(errRes).toEqual(res);
        expect(err.code).toEqual("ECONNREFUSED");
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
  });

  it("should proxy the request and handle timeout error (proxyTimeout)", (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8083),
      proxyTimeout: 100,
      timeout: 150, // so client exits and isn't left handing the test.
    });

    const server = require("net").createServer().listen(ports["8083"]);

    const started = Date.now();
    function requestHandler(req, res) {
      proxy.once("error", (err, errReq, errRes) => {
        proxyServer.close();
        server.close();
        expect(errReq).toEqual(req);
        expect(errRes).toEqual(res);
        expect(Date.now() - started).toBeGreaterThan(99);
        expect(err.code).toEqual("ECONNRESET");
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
  });

  it("should proxy the request and handle timeout error", (done) => {
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
    function requestHandler(req, res) {
      proxy.once("econnreset", (err, errReq, errRes) => {
        proxyServer.close();
        server.close();
        expect(errReq).toEqual(req);
        expect(errRes).toEqual(res);
        expect(err.code).toEqual("ECONNRESET");
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
  });
  /*

  it("should proxy the request and provide a proxyRes event with the request and response parameters", (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    function requestHandler(req, res) {
      proxy.once("proxyRes", (_proxyRes, pReq, pRes) => {
        source.close();
        proxyServer.close();
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

    proxyServer.listen("8086");
    source.listen(ports['8080']);
    http.request("http://127.0.0.1:8086", () => {}).end();
  });

  it("should proxy the request and provide and respond to manual user response when using modifyResponse", (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      selfHandleResponse: true,
    });

    function requestHandler(req, res) {
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
        (next) => proxyServer.listen(8086, next),
        (next) => source.listen(8080, next),
      ],
      (_err) => {
        http
          .get("http://127.0.0.1:8086", (res) => {
            res.pipe(
              concat((body) => {
                expect(body.toString("utf8")).toEqual("my-custom-response");
                source.close();
                proxyServer.close();
                done();
              }),
            );
          })
          .once("error", done);
      },
    );
  });

  it("should proxy the request and handle changeOrigin option", (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      changeOrigin: true,
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, _res) => {
      source.close();
      proxyServer.close();
      expect(req.method).toEqual("GET");
      expect(req.headers.host?.split(":")[1]).toEqual("8080");
      done();
    });

    proxyServer.listen(ports['8081']);
    source.listen(ports['8080']);

    http.request(address(8081), () => {}).end();
  });

  it("should proxy the request with the Authorization header set", (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      auth: "user:pass",
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, _res) => {
      source.close();
      proxyServer.close();
      const auth = new Buffer(
        req.headers.authorization?.split(" ")[1] ?? "",
        "base64",
      );
      expect(req.method).toEqual("GET");
      expect(auth.toString()).toEqual("user:pass");
      done();
    });

    proxyServer.listen(ports['8081']);
    source.listen(ports['8080']);

    http.request(address(8081), () => {}).end();
  });

  it("should proxy requests to multiple servers with different options", (done) => {
    const proxy = httpProxy.createProxyServer();

    // proxies to two servers depending on url, rewriting the url as well
    // http://127.0.0.1:8080/s1/ -> http://127.0.0.1:8081/
    // http://127.0.0.1:8080/ -> http://127.0.0.1:8082/
    function requestHandler(req, res) {
      if (req.url.indexOf("/s1/") === 0) {
        proxy.web(req, res, {
          ignorePath: true,
          target: address(8081) + req.url.substring(3),
        });
      } else {
        proxy.web(req, res, {
          target: "http://127.0.0.1:8082",
        });
      }
    }

    const proxyServer = http.createServer(requestHandler);

    const source1 = http.createServer((req, _res) => {
      expect(req.method).toEqual("GET");
      expect(req.headers.host?.split(":")[1]).toEqual("8080");
      expect(req.url).toEqual("/test1");
    });

    const source2 = http.createServer((req, _res) => {
      source1.close();
      source2.close();
      proxyServer.close();
      expect(req.method).toEqual("GET");
      expect(req.headers.host?.split(":")[1]).toEqual("8080");
      expect(req.url).toEqual("/test2");
      done();
    });

    proxyServer.listen(ports['8080']);
    source1.listen(ports['8081']);
    source2.listen("8082");

    http.request("http://127.0.0.1:8080/s1/test1", () => {}).end();
    http.request("http://127.0.0.1:8080/test2", () => {}).end();
  });
  */
});

/*

describe("#followRedirects", () => {
  it("should proxy the request follow redirects",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      followRedirects: true,
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      if (url.parse(req.url).pathname === "/redirect") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      }

      res.writeHead(301, { Location: "/redirect" });
      res.end();
    });

    proxyServer.listen(ports['8081']);
    source.listen(ports['8080']);

    http
      .request(address(8081), function (res) {
        source.close();
        proxyServer.close();
        expect(res.statusCode).toEqual(200);
        done();
      })
      .end();
  });
});
const webPasses = require("../lib/http-proxy/passes/web-incoming"),
  httpProxy = require("../lib/http-proxy"),
  expect = require("expect.js"),
  concat = require("concat-stream"),
  async = require("async"),
  url = require("url"),
  http = require("http");

describe("lib/http-proxy/passes/web.js", () => {
  describe("#deleteLength", () => {
    it("should change `content-length` for DELETE requests", () => {
      const stubRequest = {
        method: "DELETE",
        headers: {},
      };
      deleteLength(stubRequest, {}, {});
      expect(stubRequest.headers["content-length"]).toEqual("0");
    });

    it("should change `content-length` for OPTIONS requests", () => {
      const stubRequest = {
        method: "OPTIONS",
        headers: {},
      };
      deleteLength(stubRequest, {}, {});
      expect(stubRequest.headers["content-length"]).toEqual("0");
    });

    it("should remove `transfer-encoding` from empty DELETE requests", () => {
      const stubRequest = {
        method: "DELETE",
        headers: {
          "transfer-encoding": "chunked",
        },
      };
      deleteLength(stubRequest, {}, {});
      expect(stubRequest.headers["content-length"]).toEqual("0");
      expect(stubRequest.headers).to.not.have.key("transfer-encoding");
    });
  });

  describe("#timeout", () => {
    it("should set timeout on the socket", () => {
      const done = false,
        stubRequest = {
          socket: {
            setTimeout: function (value) {
              done = value;
            },
          },
        };

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
      },
    };

    it("set the correct x-forwarded-* headers", () => {
      XHeaders(stubRequest, {}, { xfwd: true });
      expect(stubRequest.headers["x-forwarded-for"]).toEqual("192.168.1.2");
      expect(stubRequest.headers["x-forwarded-port"]).toEqual("8080");
      expect(stubRequest.headers["x-forwarded-proto"]).toEqual("http");
    });
  });
});

describe("#createProxyServer.web() using own http server", () => {
  it("should proxy the request using the web proxy handler",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      source.close();
      proxyServer.close();
      expect(req.method).toEqual("GET");
      expect(req.headers.host.split(":")[1]).toEqual("8081");
      done();
    });

    proxyServer.listen(ports['8081']);
    source.listen(ports['8080']);

    http.request(address(8081), () => {}).end();
  });

  it("should detect a proxyReq event and modify headers",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    proxy.on("proxyReq", function (proxyReq, req, res, options) {
      proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      source.close();
      proxyServer.close();
      expect(req.headers["x-special-proxy-header"]).toEqual("foobar");
      done();
    });

    proxyServer.listen(ports['8081']);
    source.listen(ports['8080']);

    http.request(address(8081), () => {}).end();
  });

  it('should skip proxyReq event when handling a request with header "expect: 100-continue" [https://www.npmjs.com/advisories/1486]',  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    proxy.on("proxyReq", function (proxyReq, req, res, options) {
      proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      source.close();
      proxyServer.close();
      expect(req.headers["x-special-proxy-header"]).to.not.toEqual("foobar");
      done();
    });

    proxyServer.listen(ports['8081']);
    source.listen(ports['8080']);

    const postData = "".padStart(1025, "x");

    const postOptions = {
      hostname: "127.0.0.1",
      port: 8081,
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
  });

  it("should proxy the request and handle error via callback",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    const proxyServer = http.createServer(requestHandler);

    function requestHandler(req, res) {
      proxy.web(req, res, function (err) {
        proxyServer.close();
        expect(err.code).toEqual("ECONNREFUSED");
        done();
      });
    }

    proxyServer.listen("8082");

    http
      .request(
        {
          hostname: "127.0.0.1",
          port: "8082",
          method: "GET",
        },
        () => {},
      )
      .end();
  });

  it("should proxy the request and handle error via event listener",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    const proxyServer = http.createServer(requestHandler);

    function requestHandler(req, res) {
      proxy.once("error", function (err, errReq, errRes) {
        proxyServer.close();
        expect(errReq).toEqual(req);
        expect(errRes).toEqual(res);
        expect(err.code).toEqual("ECONNREFUSED");
        done();
      });

      proxy.web(req, res);
    }

    proxyServer.listen("8083");

    http
      .request(
        {
          hostname: "127.0.0.1",
          port: "8083",
          method: "GET",
        },
        () => {},
      )
      .end();
  });

  it("should forward the request and handle error via event listener",  (done) => {
    const proxy = httpProxy.createProxyServer({
      forward: "http://127.0.0.1:8080",
    });

    const proxyServer = http.createServer(requestHandler);

    function requestHandler(req, res) {
      proxy.once("error", function (err, errReq, errRes) {
        proxyServer.close();
        expect(errReq).toEqual(req);
        expect(errRes).toEqual(res);
        expect(err.code).toEqual("ECONNREFUSED");
        done();
      });

      proxy.web(req, res);
    }

    proxyServer.listen("8083");

    http
      .request(
        {
          hostname: "127.0.0.1",
          port: "8083",
          method: "GET",
        },
        () => {},
      )
      .end();
  });

  it("should proxy the request and handle timeout error (proxyTimeout)",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: "http://127.0.0.1:45000",
      proxyTimeout: 100,
    });

    require("net").createServer().listen(45000);

    const proxyServer = http.createServer(requestHandler);

    const started = Date.now();
    function requestHandler(req, res) {
      proxy.once("error", function (err, errReq, errRes) {
        proxyServer.close();
        expect(errReq).toEqual(req);
        expect(errRes).toEqual(res);
        expect(Date.now() - started).to.be.greaterThan(99);
        expect(err.code).toEqual("ECONNRESET");
        done();
      });

      proxy.web(req, res);
    }

    proxyServer.listen("8084");

    http
      .request(
        {
          hostname: "127.0.0.1",
          port: "8084",
          method: "GET",
        },
        () => {},
      )
      .end();
  });

  it("should proxy the request and handle timeout error",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: "http://127.0.0.1:45001",
      timeout: 100,
    });

    require("net").createServer().listen(45001);

    const proxyServer = http.createServer(requestHandler);

    const cnt = 0;
    const doneOne = () => {
      cnt += 1;
      if (cnt === 2) done();
    };

    const started = Date.now();
    function requestHandler(req, res) {
      proxy.once("econnreset", function (err, errReq, errRes) {
        proxyServer.close();
        expect(errReq).toEqual(req);
        expect(errRes).toEqual(res);
        expect(err.code).toEqual("ECONNRESET");
        doneOne();
      });

      proxy.web(req, res);
    }

    proxyServer.listen("8085");

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: "8085",
        method: "GET",
      },
      () => {},
    );

    req.on("error", function (err) {
      expect(err.code).toEqual("ECONNRESET");
      expect(Date.now() - started).to.be.greaterThan(99);
      doneOne();
    });
    req.end();
  });

  it("should proxy the request and provide a proxyRes event with the request and response parameters",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
    });

    function requestHandler(req, res) {
      proxy.once("proxyRes", function (proxyRes, pReq, pRes) {
        source.close();
        proxyServer.close();
        expect(pReq).toEqual(req);
        expect(pRes).toEqual(res);
        done();
      });

      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      res.end("Response");
    });

    proxyServer.listen("8086");
    source.listen(ports['8080']);
    http.request("http://127.0.0.1:8086", () => {}).end();
  });

  it("should proxy the request and provide and respond to manual user response when using modifyResponse",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      selfHandleResponse: true,
    });

    function requestHandler(req, res) {
      proxy.once("proxyRes", function (proxyRes, pReq, pRes) {
        proxyRes.pipe(
          concat(function (body) {
            expect(body.toString("utf8")).toEqual("Response");
            pRes.end(Buffer.from("my-custom-response"));
          }),
        );
      });

      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      res.end("Response");
    });

    async.parallel(
      [
        (next) => proxyServer.listen(8086, next),
        (next) => source.listen(8080, next),
      ],
      function (err) {
        http
          .get("http://127.0.0.1:8086", function (res) {
            res.pipe(
              concat(function (body) {
                expect(body.toString("utf8")).toEqual("my-custom-response");
                source.close();
                proxyServer.close();
                done();
              }),
            );
          })
          .once("error", done);
      },
    );
  });

  it("should proxy the request and handle changeOrigin option",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      changeOrigin: true,
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      source.close();
      proxyServer.close();
      expect(req.method).toEqual("GET");
      expect(req.headers.host.split(":")[1]).toEqual("8080");
      done();
    });

    proxyServer.listen(ports['8081']);
    source.listen(ports['8080']);

    http.request(address(8081), () => {}).end();
  });

  it("should proxy the request with the Authorization header set",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      auth: "user:pass",
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      source.close();
      proxyServer.close();
      const auth = new Buffer(req.headers.authorization.split(" ")[1], "base64");
      expect(req.method).toEqual("GET");
      expect(auth.toString()).toEqual("user:pass");
      done();
    });

    proxyServer.listen(ports['8081']);
    source.listen(ports['8080']);

    http.request(address(8081), () => {}).end();
  });

  it("should proxy requests to multiple servers with different options",  (done) => {
    const proxy = httpProxy.createProxyServer();

    // proxies to two servers depending on url, rewriting the url as well
    // http://127.0.0.1:8080/s1/ -> http://127.0.0.1:8081/
    // http://127.0.0.1:8080/ -> http://127.0.0.1:8082/
    function requestHandler(req, res) {
      if (req.url.indexOf("/s1/") === 0) {
        proxy.web(req, res, {
          ignorePath: true,
          target: address(8081) + req.url.substring(3),
        });
      } else {
        proxy.web(req, res, {
          target: "http://127.0.0.1:8082",
        });
      }
    }

    const proxyServer = http.createServer(requestHandler);

    const source1 = http.createServer((req, res) => {
      expect(req.method).toEqual("GET");
      expect(req.headers.host.split(":")[1]).toEqual("8080");
      expect(req.url).toEqual("/test1");
    });

    const source2 = http.createServer((req, res) => {
      source1.close();
      source2.close();
      proxyServer.close();
      expect(req.method).toEqual("GET");
      expect(req.headers.host.split(":")[1]).toEqual("8080");
      expect(req.url).toEqual("/test2");
      done();
    });

    proxyServer.listen(ports['8080']);
    source1.listen(ports['8081']);
    source2.listen("8082");

    http.request("http://127.0.0.1:8080/s1/test1", () => {}).end();
    http.request("http://127.0.0.1:8080/test2", () => {}).end();
  });
});

describe("#followRedirects", () => {
  it("should proxy the request follow redirects",  (done) => {
    const proxy = httpProxy.createProxyServer({
      target: address(8080),
      followRedirects: true,
    });

    function requestHandler(req, res) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer((req, res) => {
      if (url.parse(req.url).pathname === "/redirect") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      }

      res.writeHead(301, { Location: "/redirect" });
      res.end();
    });

    proxyServer.listen(ports['8081']);
    source.listen(ports['8080']);

    http
      .request(address(8081), function (res) {
        source.close();
        proxyServer.close();
        expect(res.statusCode).toEqual(200);
        done();
      })
      .end();
  });
});
*/
