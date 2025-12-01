import * as httpProxy from "../..";
import * as http from "node:http";
import * as https from "node:https";
import getPort from "../get-port";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from 'vitest';

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
    for (let n = 0; n < 50; n++) {
      ports[n] = await getPort();
    }
  });

describe("HTTPS to HTTP", () => {


  it("should proxy the request, then send back the response", () => new Promise<void>(done => {
    const ports = { source: gen.port, proxy: gen.port };
    const source = http
      .createServer((req, res) => {
        expect(req.method).toEqual("GET");
        expect((req.headers["x-forwarded-host"] as string)?.split(":")[1]).toEqual(`${ports.proxy}`);
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello from " + ports.source);
      })
      .listen(ports.source);

    const proxy = httpProxy
      .createProxyServer({
        target: "http://127.0.0.1:" + ports.source,
        ssl: {
          key: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-key.pem"),
          ),
          cert: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-cert.pem"),
          ),
          ciphers: "AES128-GCM-SHA256",
        },
        xfwd: true,
      })
      .listen(ports.proxy);

    https
      .request(
        {
          host: "localhost",
          port: ports.proxy,
          path: "/",
          method: "GET",
          rejectUnauthorized: false,
        },
        (res) => {
          expect(res.statusCode).toEqual(200);

          res.on("data", (data) => {
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
  }));
});

describe("HTTP to HTTPS", () => {
  it("should proxy the request, then send back the response", () => new Promise<void>(done => {
    const ports = { source: gen.port, proxy: gen.port };
    const source = https
      .createServer(
        {
          key: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-key.pem"),
          ),
          cert: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-cert.pem"),
          ),
          ciphers: "AES128-GCM-SHA256",
        },
        (req, res) => {
          expect(req.method).toEqual("GET");
          // expect(req.headers.host?.split(":")[1]).toEqual(`${ports.proxy}`);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello from " + ports.source);
        },
      )
      .listen(ports.source);

    const proxy = httpProxy
      .createProxyServer({
        target: "https://127.0.0.1:" + ports.source,
        // Allow to use SSL self signed
        secure: false,
      })
      .listen(ports.proxy);

    http
      .request(
        {
          hostname: "127.0.0.1",
          port: ports.proxy,
          method: "GET",
        },
        (res) => {
          expect(res.statusCode).toEqual(200);

          res.on("data", (data) => {
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
  }));
});

describe("HTTPS to HTTPS", () => {
  it("should proxy the request, then send back the response", () => new Promise<void>(done => {
    const ports = { source: gen.port, proxy: gen.port };
    const source = https
      .createServer(
        {
          key: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-key.pem"),
          ),
          cert: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-cert.pem"),
          ),
          ciphers: "AES128-GCM-SHA256",
        },
        (req, res) => {
          expect(req.method).toEqual("GET");
          // expect(req.headers.host?.split(":")[1]).toEqual(`${ports.proxy}`);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello from " + ports.source);
        },
      )
      .listen(ports.source);

    const proxy = httpProxy
      .createProxyServer({
        target: "https://127.0.0.1:" + ports.source,
        ssl: {
          key: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-key.pem"),
          ),
          cert: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-cert.pem"),
          ),
          ciphers: "AES128-GCM-SHA256",
        },
        secure: false,
      })
      .listen(ports.proxy);

    https
      .request(
        {
          host: "localhost",
          port: ports.proxy,
          path: "/",
          method: "GET",
          rejectUnauthorized: false,
        },
        (res) => {
          expect(res.statusCode).toEqual(200);

          res.on("data", (data) => {
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
  }));
});

describe("HTTPS not allow SSL self signed", () => {
  it("should fail with error", () => new Promise<void>(done => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
    const ports = { source: gen.port, proxy: gen.port };
    const source = https
      .createServer({
        key: readFileSync(join(__dirname, "..", "fixtures", "agent2-key.pem")),
        cert: readFileSync(
          join(__dirname, "..", "fixtures", "agent2-cert.pem"),
        ),
        ciphers: "AES128-GCM-SHA256",
      })
      .listen(ports.source);

    const proxy = httpProxy
      .createProxyServer({
        target: "https://127.0.0.1:" + ports.source,
        // because secure is set we reject the self signed cert.
        secure: true,
      })
      .listen(ports.proxy);

    proxy.on("error", (err, _req, res) => {
      res.end();
      expect(err.toString()).toMatch(
        /Error: unable to verify the first certificate|TypeError: fetch failed/,
      );
      source.close();
      proxy.close();
      done();
     process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    });

    const client = http.request({
      hostname: "127.0.0.1",
      port: ports.proxy,
      method: "GET",
    });
    client.end();
  }));
});

describe("HTTPS to HTTP using own server", () => {
  it("should proxy the request, then send back the response", () => new Promise<void>(done => {
    const ports = { source: gen.port, proxy: gen.port };
    const source = http
      .createServer((req, res) => {
        expect(req.method).toEqual("GET");
        expect((req.headers["x-forwarded-host"] as string).split(":")[1]).toEqual(`${ports.proxy}`);
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello from " + ports.source);
      })
      .listen(ports.source);

    const proxy = httpProxy.createServer({
      agent: new http.Agent({ maxSockets: 2 }),
    });

    const ownServer = https
      .createServer(
        {
          key: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-key.pem"),
          ),
          cert: readFileSync(
            join(__dirname, "..", "fixtures", "agent2-cert.pem"),
          ),
          ciphers: "AES128-GCM-SHA256",
        },
        (req, res) => {
          proxy.web(req, res, {
            target: "http://127.0.0.1:" + ports.source,
            xfwd: true,
          });
        },
      )
      .listen(ports.proxy);

    https
      .request(
        {
          host: "localhost",
          port: ports.proxy,
          path: "/",
          method: "GET",
          rejectUnauthorized: false,
        },
        (res) => {
          expect(res.statusCode).toEqual(200);

          res.on("data", (data) => {
            expect(data.toString()).toEqual("Hello from " + ports.source);
          });

          res.on("end", () => {
            source.close();
            ownServer.close();
            done();
          });
        },
      )
      .end();
  }));
});
