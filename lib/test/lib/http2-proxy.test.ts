import * as httpProxy from "../..";
import * as http from "node:http";
import * as http2 from "node:http2";
import getPort from "../get-port";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, it, expect } from 'vitest';

const ports: { [port: string]: number } = {};
let portIndex = -1;
const gen = {} as { port: number };
Object.defineProperty(gen, "port", {
  get: function get() {
    portIndex++;
    return ports[portIndex];
  },
});

describe("HTTP2 to HTTP", () => {
  it("creates some ports", async () => {
    for (let n = 0; n < 50; n++) {
      ports[n] = await getPort();
    }
  });

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

    const client = http2.connect(`https://localhost:${ports.proxy}`)
    const req = client.request({ ':path': '/' });
    req.on('response', (headers, _flags) => {
      expect(headers[':status']).toEqual(200);
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        expect(chunk.toString()).toEqual("Hello from " + ports.source);
      });
      req.on('end', () => {
        source.close();
        proxy.close();
        done();
      });
    });
    req.end();
  }));
});

describe("HTTP2 to HTTP using own server", () => {
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

    const proxy = httpProxy.createServer({
      agent: new http.Agent({ maxSockets: 2 }),
      xfwd: true,
    });

    const ownServer = http2
      .createSecureServer(
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
          // @ts-expect-error -- ignore type incompatibility
          proxy.web(req, res, {
            target: "http://127.0.0.1:" + ports.source,
          });
        },
      )
      .listen(ports.proxy);

    const client = http2.connect(`https://localhost:${ports.proxy}`)
    const req = client.request({ ':path': '/' });
    req.on('response', (headers, _flags) => {
      expect(headers[':status']).toEqual(200);
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        expect(chunk.toString()).toEqual("Hello from " + ports.source);
      });
      req.on('end', () => {
        source.close();
        ownServer.close();
        done();
      });
    });
    req.end();
  }));
});
