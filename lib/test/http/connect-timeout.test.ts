import { describe, it, expect } from "vitest";
import { createProxyServer } from "../..";
import * as http from "http";

describe("connectTimeout option", () => {
  it("should timeout when target is unreachable (filtered port)", async () => {
    const proxy = createProxyServer({
      target: "http://10.255.255.1:12345", // Non-routable IP - will hang
      connectTimeout: 1000, // 1 second timeout
    });

    const server = http.createServer((req, res) => {
      proxy.web(req, res);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const errorPromise = new Promise<Error>((resolve) => {
      proxy.on("error", (err: Error) => resolve(err));
    });

    // Make a request
    http.get(`http://localhost:${port}/`).on("error", () => {});

    const error = await errorPromise;
    
    expect(error.message).toBe("ECONNECT_TIMEOUT");
    expect((error as NodeJS.ErrnoException).code).toBe("ECONNECT_TIMEOUT");

    server.close();
  });

  it("should not timeout when connection is fast", async () => {
    // Create a target server
    const targetServer = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("OK");
    });
    await new Promise<void>((resolve) => targetServer.listen(0, resolve));
    const targetPort = (targetServer.address() as any).port;

    const proxy = createProxyServer({
      target: `http://localhost:${targetPort}`,
      connectTimeout: 5000, // 5 seconds - plenty of time
    });

    const server = http.createServer((req, res) => {
      proxy.web(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const response = await new Promise<http.IncomingMessage>((resolve) => {
      http.get(`http://localhost:${port}/`, resolve);
    });

    expect(response.statusCode).toBe(200);

    server.close();
    targetServer.close();
  });
});
