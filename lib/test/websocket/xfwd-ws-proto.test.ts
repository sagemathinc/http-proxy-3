import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import * as httpProxy from "../..";
import getPort from "../get-port";

interface ListeningProxy {
  address: () => unknown;
  close: (callback?: (error?: Error) => void) => void;
}

async function waitForProxyToListen(proxy: ListeningProxy) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (proxy.address()) return;
    await waitForImmediate();
  }
  throw new Error("proxy did not begin listening");
}

function closeProxy(proxy: ListeningProxy) {
  return new Promise<void>((resolve, reject) => {
    proxy.close((error?: Error) => (error ? reject(error) : resolve()));
  });
}

function closeWebSocketServer(server: WebSocketServer) {
  return new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
}

async function expectForwardedProtocol(
  encrypted: boolean,
  expectedProtocol: "http" | "https",
) {
  const upstreamPort = await getPort();
  const proxyPort = await getPort();
  const upstream = new WebSocketServer({ port: upstreamPort });
  await once(upstream, "listening");

  let upstreamSocket: WebSocket | undefined;
  const forwardedProtocol = new Promise<string | undefined>((resolve) => {
    upstream.once("connection", (socket, request) => {
      upstreamSocket = socket;
      const value = request.headers["x-forwarded-proto"];
      resolve(Array.isArray(value) ? value.join(",") : value);
    });
  });

  const proxy = httpProxy.createProxyServer({
    target: `ws://127.0.0.1:${upstreamPort}`,
    ws: true,
    xfwd: true,
    xfwdWsProtoAsHttp: true,
    ...(encrypted
      ? {
          ssl: {
            key: readFileSync(
              join(__dirname, "..", "fixtures", "agent2-key.pem"),
            ),
            cert: readFileSync(
              join(__dirname, "..", "fixtures", "agent2-cert.pem"),
            ),
          },
        }
      : {}),
  });
  proxy.listen(proxyPort);
  await waitForProxyToListen(proxy);

  const client = new WebSocket(
    `${encrypted ? "wss" : "ws"}://127.0.0.1:${proxyPort}`,
    { rejectUnauthorized: false },
  );

  try {
    await once(client, "open");
    expect(await forwardedProtocol).toBe(expectedProtocol);
  } finally {
    client.terminate();
    upstreamSocket?.terminate();
    await Promise.all([closeProxy(proxy), closeWebSocketServer(upstream)]);
  }
}

describe("WebSocket X-Forwarded-Proto HTTP schemes", () => {
  it("forwards http through a plain WebSocket proxy", async () => {
    await expectForwardedProtocol(false, "http");
  });

  it("forwards https through a TLS WebSocket proxy", async () => {
    await expectForwardedProtocol(true, "https");
  });
});
