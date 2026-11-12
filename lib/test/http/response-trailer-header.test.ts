import * as net from "node:net";
import * as http from "node:http";
import getPort from "../get-port";
import ProxyServer, { createServer } from "../..";
import { describe, it, expect } from "vitest";

// The target announces trailers with a Trailer header. Trailers are never
// forwarded, and Node's ServerResponse throws ERR_HTTP_TRAILER_INVALID for
// Trailer together with Content-Length, which used to crash the process.
describe("Trailer header in the target response", () => {
  let port: number, target: net.Server;
  let proxy: ProxyServer, httpServer: http.Server, proxyPort: number;
  const errors: string[] = [];

  it("create a raw target server", async () => {
    port = await getPort();
    target = net.createServer((socket) => {
      socket.once("data", (data) => {
        const chunked = data.toString().startsWith("GET /chunked");
        socket.end(
          chunked
            ? "HTTP/1.1 200 OK\r\nTrailer: X-T\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nok\r\n0\r\nX-T: 1\r\n\r\n"
            : "HTTP/1.1 200 OK\r\nTrailer: X-T\r\nContent-Length: 2\r\n\r\nok",
        );
      });
    });
    await new Promise<void>((resolve) =>
      target.listen(port, "127.0.0.1", resolve),
    );
  });

  it("create a proxy server", async () => {
    proxy = createServer({ target: `http://127.0.0.1:${port}` });
    proxy.on("error", (err, _req, res) => {
      errors.push(String(err));
      (res as http.ServerResponse).end();
    });
    httpServer = http.createServer((req, res) => proxy.web(req, res));
    proxyPort = await getPort();
    await new Promise<void>((resolve) =>
      httpServer.listen(proxyPort, "127.0.0.1", resolve),
    );
  });

  const get = (path: string) =>
    new Promise<{
      status?: number;
      headers: http.IncomingHttpHeaders;
      body: string;
    }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${proxyPort}${path}`, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body }),
          );
        })
        .on("error", reject);
    });

  it("forwards a Content-Length response without the Trailer header", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
    expect(res.headers.trailer).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("forwards a chunked response without the Trailer header", async () => {
    const res = await get("/chunked");
    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
    expect(res.headers.trailer).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("clean up", () => {
    target.close();
    httpServer.close();
  });
});
