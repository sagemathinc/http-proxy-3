import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { http as redirects } from "follow-redirects";
import { afterEach, describe, expect, it } from "vitest";

const servers: http.Server[] = [];

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }),
  );
});

// Exercise the installed dependency itself: http-proxy normally supplies an
// object of headers and does not expose follow-redirects' sensitiveHeaders option.
function get(
  url: string,
  headers: http.RequestOptions["headers"],
  sensitiveHeaders: string[],
) {
  return new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
    const options = { headers, sensitiveHeaders };
    const request = redirects.get(url, options, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("error", reject);
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(2000, () =>
      request.destroy(new Error("redirect timed out")),
    );
  });
}

describe("follow-redirects credential stripping", () => {
  for (const arrayHeaders of [false, true]) {
    for (const crossOrigin of [false, true]) {
      it(`${crossOrigin ? "strips" : "retains"} sensitive ${arrayHeaders ? "array" : "object"} headers on ${crossOrigin ? "cross" : "same"}-origin redirects`, async () => {
        const headers = {
          authorization: "Bearer test-only",
          "proxy-authorization": "Basic test-only",
          cookie: "session=test-only",
          "x-token^secret": "test-only-caret",
          "x-token|secret": "test-only-pipe",
          "x-public-marker": "keep-me",
        };
        const sensitiveHeaders = ["x-token^secret", "x-token|secret"];
        let initialHeaders: http.IncomingHttpHeaders | undefined;
        const echo: http.RequestListener = (req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(req.headers));
        };
        const target = await listen(echo);
        const source = await listen((req, res) => {
          if (req.url === "/final") return echo(req, res);
          initialHeaders = req.headers;
          res.writeHead(302, {
            location: crossOrigin ? `${target}/final` : "/final",
          });
          res.end();
        });
        // Node does not synthesize Host for its raw array form of headers.
        const inputHeaders = { ...headers, host: new URL(source).host };
        const result = await get(
          source,
          arrayHeaders ? Object.entries(inputHeaders).flat() : inputHeaders,
          sensitiveHeaders,
        );
        expect(initialHeaders).toMatchObject(headers);
        expect(result["x-public-marker"]).toBe("keep-me");
        for (const name of [
          "authorization",
          "proxy-authorization",
          "cookie",
          ...sensitiveHeaders,
        ]) {
          if (crossOrigin) expect(result).not.toHaveProperty(name);
          else expect(result[name]).toBe(headers[name as keyof typeof headers]);
        }
      });
    }
  }
});
