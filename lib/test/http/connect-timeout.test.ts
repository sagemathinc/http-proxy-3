import { EventEmitter, once } from "node:events";
import * as http from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProxyServer } from "../..";
import { setupConnectTimeout } from "../../http-proxy/common";

function createSocket(connecting: boolean) {
  const socket = new EventEmitter() as unknown as Socket;
  Object.defineProperty(socket, "connecting", { value: connecting });
  const destroy = vi.fn();
  socket.destroy = destroy as unknown as Socket["destroy"];
  return { socket, destroy };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("setupConnectTimeout", () => {
  it("destroys a connecting socket after the configured delay", async () => {
    vi.useFakeTimers();
    const { socket, destroy } = createSocket(true);

    setupConnectTimeout(socket, 1_000);
    await vi.advanceTimersByTimeAsync(999);
    expect(destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(destroy).toHaveBeenCalledOnce();
    const error = destroy.mock.calls[0][0] as NodeJS.ErrnoException;
    expect(error.message).toBe("ECONNECT_TIMEOUT");
    expect(error.code).toBe("ECONNECT_TIMEOUT");
    expect(socket.listenerCount("connect")).toBe(0);
    expect(socket.listenerCount("error")).toBe(0);
    expect(socket.listenerCount("close")).toBe(0);
  });

  it("cancels the timeout when the socket connects", async () => {
    vi.useFakeTimers();
    const { socket, destroy } = createSocket(true);

    setupConnectTimeout(socket, 1_000);
    socket.emit("connect");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(destroy).not.toHaveBeenCalled();
    expect(socket.listenerCount("connect")).toBe(0);
    expect(socket.listenerCount("error")).toBe(0);
    expect(socket.listenerCount("close")).toBe(0);
  });

  it("does not arm a timeout for an already-connected socket", async () => {
    vi.useFakeTimers();
    const { socket, destroy } = createSocket(false);

    setupConnectTimeout(socket, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(destroy).not.toHaveBeenCalled();
    expect(socket.eventNames()).toEqual([]);
  });
});

describe.skipIf(process.env.FORCE_FETCH_PATH === "true")(
  "connectTimeout native integration",
  () => {
    it("does not disrupt a fast connection", async () => {
      const targetServer = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end("OK");
      });
      await new Promise<void>((resolve) => targetServer.listen(0, resolve));
      const targetAddress = targetServer.address();
      if (!targetAddress || typeof targetAddress === "string") {
        throw new Error("Target server did not bind to a TCP port");
      }

      const proxy = createProxyServer({
        target: `http://localhost:${targetAddress.port}`,
        connectTimeout: 5_000,
      });

      const server = http.createServer((req, res) => {
        proxy.web(req, res);
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Proxy server did not bind to a TCP port");
      }

      const response = await new Promise<http.IncomingMessage>((resolve) => {
        http.get(`http://localhost:${address.port}/`, resolve);
      });

      expect(response.statusCode).toBe(200);
      response.resume();
      await once(response, "end");

      await Promise.all([
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
        new Promise<void>((resolve, reject) =>
          targetServer.close((error) => (error ? reject(error) : resolve())),
        ),
      ]);
    });
  },
);
