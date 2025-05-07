/*
Test basic example of proxying over HTTP
*/

import * as http from "http";
import * as httpProxy from "../../../dist/lib";

export async function server() {
  // Target Http Server
  const target = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write(
      "request successfully proxied to: " +
        req.url +
        "\n" +
        JSON.stringify(req.headers, true, 2),
    );
    res.end();
  });
  target.listen();

  // Basic Http Proxy Server
  const proxy = httpProxy
    .createServer({
      target: `http://localhost:${target.address().port}`,
    })
    .listen();
  proxy.on("error", (e) => {
    console.log("error", e);
  });
  proxy.on("close", () => {
    console.log("proxy closed");
  });

  if (!process.env.TEST_MODE) {
    console.log(`http proxy server started on port ${target.address().port}`);
    console.log(`http server started on port ${proxy.address().port}`);
  }
  return { proxy, target };
}

describe("tests proxying a basic http server", () => {
  it("does a consistency check", async () => {
    const { proxy, target } = await server();
    const a = await (
      await fetch(`http://localhost:${proxy.address().port}`)
    ).text();
    expect(a).toContain("request successfully proxied");
    const b = await (
      await fetch(`http://localhost:${target.address().port}`)
    ).text();
    expect(b).toContain("request successfully proxied");

    proxy.close();
    target.close();
  });
});
