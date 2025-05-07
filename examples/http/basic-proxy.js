/*
  basic-proxy.js: Basic example of proxying over HTTP

  Copyright (c) 2013 - 2016 Charlie Robbins, Jarrett Cruger & the Contributors.

  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  "Software"), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
  NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
  LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
  WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

const http = require("http");
const httpProxy = require("../../dist/lib");
const getPort = require("get-port").default;

const welcome = [
  "#    # ##### ##### #####        #####  #####   ####  #    # #   #",
  "#    #   #     #   #    #       #    # #    # #    #  #  #   # # ",
  "######   #     #   #    # ##### #    # #    # #    #   ##     #  ",
  "#    #   #     #   #####        #####  #####  #    #   ##     #  ",
  "#    #   #     #   #            #      #   #  #    #  #  #    #  ",
  "#    #   #     #   #            #      #    #  ####  #    #   #  ",
].join("\n");

console.log(welcome);

async function server() {
  const PORT1 = await getPort();
  const PORT2 = await getPort();

  // Basic Http Proxy Server
  const proxy = httpProxy
    .createServer({
      target: `http://localhost:${PORT1}`,
    })
    .listen(PORT2);
  proxy.on("error", (e) => {
    console.log("error", e);
  });
  proxy.on("close", () => {
    console.log("proxy closed");
  });

  // Target Http Server
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write(
        "request successfully proxied to: " +
          req.url +
          "\n" +
          JSON.stringify(req.headers, true, 2),
      );
      res.end();
    })
    .listen(PORT1);

  console.log(`http proxy server started on port ${PORT2}`);
  console.log(`http server started on port ${PORT1}`);
  return { PORT1, PORT2 };
}

async function check() {
  const { PORT1, PORT2 } = await server();
  const a = await (await fetch(`http://localhost:${PORT1}`)).text();
  const b = await (await fetch(`http://localhost:${PORT2}`)).text();
  console.log({ a, b });
  if (
    a.includes("request successfully proxied") &&
    b.includes("request successfully proxied")
  ) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

check();
