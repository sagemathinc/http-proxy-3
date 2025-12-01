# http-proxy-3

[![Build package and run tests](https://github.com/sagemathinc/http-proxy-3/actions/workflows/test.yml/badge.svg)](https://github.com/sagemathinc/http-proxy-3/actions/workflows/test.yml)

**THIS IS MAINTAINED AND READY TO USE IN PRODUCTION. Please use it!**

- Used in production by:
  - [CoCalc](https://cocalc.com)
  - [JupyterHub](https://jupyter.org/hub)
  - [Vite](https://vite.dev/)

http\-proxy\-3 is a modern API compatible rewrite of
[http\-proxy](https://github.com/http-party/node-http-proxy), the original nodejs
http proxy server. `http-proxy-3` is an HTTP programmable proxying library that
supports http/https and websockets. It is also suitable for implementing components
such as reverse proxies and load balancers. It's main strength is that you can combine application logic written in Javascript with a proxy server, unlike what
can be done using nginx or haproxy.

**PR's welcome!**

Contributors:

- [William](https://wstein.org/) [Stein](https://github.com/williamstein) -- lead dev; started this fork and did the initial Typescript rewrite, etc.
- [sapphi-red](https://green.sapphi.red/about) -- greatly improved Typescript support to prepare http-proxy-3 for use in [Vite](https://vite.dev/)
- [ImranR-TI](https://github.com/ImranR-TI) -- very helpful bug reports
- [Corvince](https://github.com/corvince) -- HTTP/2 Support
- Everybody who ever contributed to [http-proxy](https://www.npmjs.com/package/http-proxy)

**Status:**

October 8, 2025 STATUS compared to [http-proxy](https://www.npmjs.com/package/http-proxy) and [httpxy](https://www.npmjs.com/package/httpxy):

- Library entirely rewritten in Typescript in a modern style, with many typings added internally and strict mode enabled.
- **HTTP/2 Support**: Full HTTP/2 support via fetch API with callback-based request/response lifecycle hooks.
- All dependent packages updated to latest versions, addressing all security vulnerabilities according to `pnpm audit`.
- Code rewritten to not use deprecated/insecure API's, e.g., using `URL` instead of `parse`.
- Fixed multiple socket leaks in the Websocket proxy code, going beyond [http-proxy-node16](https://www.npmjs.com/package/http-proxy-node16) to also instrument and logging socket counts. Also fixed an issue with uncatchable errors when using websockets.
- Switch to pnpm for development.
- More jest unit tests than both http-proxy and httpxy: converted all the http-proxy examples into working unit tests that they actually work (http-proxy's unit tests just setup the examples in many cases, but didn't test that they actually work). Also httpxy seems to have almost no tests. These tests should make contributing PR's much easier.
- [Partial HTTP2 support](https://github.com/sagemathinc/http-proxy-3/pull/33).
- Addressed [this vulnerability](https://github.com/http-party/node-http-proxy/issues/1647).

**Motivation:** http-proxy is one of the oldest and most famous nodejs modules, and it gets downloaded around 15 million times a week, and I've loved using it for years. Unfortunately, it is [unmaintained](https://github.com/http-party/node-http-proxy/issues/1687), it has significant leaks that [regularly crash production servers](https://github.com/jupyterhub/configurable-http-proxy/issues/434), and is written in ancient untyped Javascript. The maintainers have long since stopped responding, so there is no choice but to fork and start over. I wanted to do my part to help maintain the open source ecosystem, hence this library. I hope you find it useful.

**Performance:**

I've been adding load tests to the unit tests in various places. Generally speaking on a local machine over localhost the penalty to using the proxy server is that **things take about twice as long**. That's not surprising because it's twice as much work being done.

**Related Projects:**

- https://github.com/unjs/httpxy: it has the same motivation as this project -- it's a modern maintained rewrite of http-proxy. Unfortunately, it seems to have [very little unit testing](https://github.com/unjs/httpxy/tree/main/test). In http-proxy-3 (and the original http-proxy), there's an order of magnitude more unit test code than code in the actual library.

**Officially supported platforms:**

We run GitHUB CI on the following:

- nodejs versions 20, 22, and 24

**Development:**

```sh
git clone https://github.com/sagemathinc/http-proxy-3.git
cd http-proxy-3
pnpm install
pnpm build
pnpm test
```

Then do

```
pnpm tsc
```

and make changes to code under lib/.

Code Style: use prettier with the defaults.

[![Build package and run tests](https://github.com/sagemathinc/http-proxy-3/actions/workflows/test.yml/badge.svg)](https://github.com/sagemathinc/http-proxy-3/actions/workflows/test.yml)

## User's Guide

This is the original user's guide, but with various updates.

- [Installation](#installation)
- [Core Concept](#core-concept)
- [Use Cases](#use-cases)
  - [Setup a basic stand-alone proxy server](#setup-a-basic-stand-alone-proxy-server)
  - [Setup a stand-alone proxy server with custom server logic](#setup-a-stand-alone-proxy-server-with-custom-server-logic)
  - [Setup a stand-alone proxy server with proxy request header re-writing](#setup-a-stand-alone-proxy-server-with-proxy-request-header-re-writing)
  - [Modify a response from a proxied server](#modify-a-response-from-a-proxied-server)
  - [Setup a stand-alone proxy server with latency](#setup-a-stand-alone-proxy-server-with-latency)
  - [Using HTTPS](#using-https)
  - [Proxying WebSockets](#proxying-websockets)
  - [HTTP/2 Support with Fetch](#http2-support-with-fetch)
- [Options](#options)
- [Configuration Compatibility](#configuration-compatibility)
- [Listening for proxy events](#listening-for-proxy-events)
- [Shutdown](#shutdown)
- [Miscellaneous](#miscellaneous)
  - [Test](#test)
  - [ProxyTable API](#proxytable-api)
  - [Logo](#logo)
- [Contributing and Issues](#contributing-and-issues)
- [License](#license)

### Installation

`npm install http-proxy-3 --save`

**[Back to top](#table-of-contents)**

### Core Concept

A new proxy is created by calling `createProxyServer` and passing
an `options` object as argument ([valid properties are available here](lib/http-proxy/index.ts))

```js
import { createProxyServer } from "http-proxy-3";
const proxy = createProxyServer(options); // See below
```

http-proxy-3 supports two request processing paths:
- **Native Path**: Uses Node.js native `http`/`https` modules (default)
- **Fetch Path**: Uses fetch API for HTTP/2 support (when `fetch` option is provided)

Unless listen(..) is invoked on the object, this does not create a webserver. See below.

An object is returned with four methods:

- web `req, res, [options]` (used for proxying regular HTTP(S) requests)
- ws `req, socket, head, [options]` (used for proxying WS(S) requests)
- listen `port` (a function that wraps the object in a webserver, for your convenience)
- close `[callback]` (a function that closes the inner webserver and stops listening on given port)

It is then possible to proxy requests by calling these functions

```js
http.createServer((req, res) => {
  proxy.web(req, res, { target: "http://mytarget.com:8080" });
});
```

Errors can be listened on either using the Event Emitter API

```js
proxy.on('error', (err) => {
  ...
});
```

or using the callback API

```javascript
proxy.web(req, res, { target: 'http://mytarget.com:8080' }, (err) => { ... });
```

When a request is proxied it follows two different pipelines ([available here](lib/http-proxy/passes))
which apply transformations to both the `req` and `res` object.
The first pipeline (incoming) is responsible for the creation and manipulation of the stream that connects your client to the target.
The second pipeline (outgoing) is responsible for the creation and manipulation of the stream that, from your target, returns data
to the client.

**[Back to top](#table-of-contents)**

### Use Cases

There are unit tested examples illustrating everything below in
the tests subdirectory.

#### Setup a basic stand-alone proxy server

```js
import * as http from "node:http";
import { createProxyServer } from "http-proxy-3";

// Create your proxy server and set the target in the options.
createProxyServer({ target: "http://localhost:9000" }).listen(8000); // See (†)

// Create your target server
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write(
      "request successfully proxied!" +
        "\n" +
        JSON.stringify(req.headers, true, 2),
    );
    res.end();
  })
  .listen(9000);
```

† Just like with the nodejs http module, invoking `listen(...)` triggers the creation of a web server. Otherwise, just the proxy instance is created, which is just a lightweight object with configuration. _If you call close on the proxy it is a no\-op unless you have called listen._

**[Back to top](#table-of-contents)**

#### Setup a stand-alone proxy server with custom server logic

This example shows how you can proxy a request using your own HTTP server
and also you can put your own logic to handle the request.

```js
import * as http from "node:http";
import { createProxyServer } from "http-proxy-3";

// Create a proxy server with custom application logic
const proxy = createProxyServer({});

// Create your custom server and just call `proxy.web()` to proxy
// a web request to the target passed in the options
// also you can use `proxy.ws()` to proxy a websockets request
const server = http.createServer((req, res) => {
  // You can define here your custom logic to handle the request
  // and then proxy the request.
  proxy.web(req, res, { target: "http://127.0.0.1:5050" });
});

console.log("listening on port 5050");
server.listen(5050);
```

**[Back to top](#table-of-contents)**

#### Setup a stand-alone proxy server with proxy request header re-writing

This example shows how you can proxy a request using your own HTTP server that
modifies the outgoing proxy request by adding a special header.

##### Using Traditional Events (Native HTTP/HTTPS)

```js
import * as http from "node:http";
import { createProxyServer } from "http-proxy-3";

// Create a proxy server with custom application logic
const proxy = createProxyServer({});

// To modify the proxy connection before data is sent, you can listen
// for the 'proxyReq' event. When the event is fired, you will receive
// the following arguments:
// (http.ClientRequest proxyReq, http.IncomingMessage req,
//  http.ServerResponse res, Object options). This mechanism is useful when
// you need to modify the proxy request before the proxy connection
// is made to the target.
proxy.on("proxyReq", (proxyReq, req, res, options, socket) => {
  proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
});

const server = http.createServer((req, res) => {
  // You can define here your custom logic to handle the request
  // and then proxy the request.
  proxy.web(req, res, {
    target: "http://127.0.0.1:5050",
  });
});

console.log("listening on port 5050");
server.listen(5050);
```

##### Using Callbacks (Fetch/HTTP/2)

```js
import * as http from "node:http";
import { createProxyServer } from "http-proxy-3";
import { Agent } from "undici";

// Create a proxy server with fetch and HTTP/2 support
const proxy = createProxyServer({
  target: "https://127.0.0.1:5050",
  fetchOptions: {
    requestOptions: {dispatcher: new Agent({ allowH2: true })},
    // Modify the request before it's sent
    onBeforeRequest: async (requestOptions, req, res, options) => {
      requestOptions.headers['X-Special-Proxy-Header'] = 'foobar';
      requestOptions.headers['X-HTTP2-Enabled'] = 'true';
    },
    // Access the response after it's received
    onAfterResponse: async (response, req, res, options) => {
      console.log(`Proxied ${req.url} -> ${response.status}`);
    }
  }
});

const server = http.createServer((req, res) => {
  // The headers are modified via the onBeforeRequest callback
  proxy.web(req, res);
});

console.log("listening on port 5050");
server.listen(5050);
```

**[Back to top](#table-of-contents)**

#### Modify a response from a proxied server

Sometimes when you have received a HTML/XML document from the server of origin you would like to modify it before forwarding it on.

[Harmon](https://github.com/No9/harmon) allows you to do this in a streaming style so as to keep the pressure on the proxy to a minimum.

**[Back to top](#table-of-contents)**

#### Setup a stand-alone proxy server with latency

```js
import * as http from "node:http";
import { createProxyServer } from "http-proxy-3";

// Create a proxy server with latency
const proxy = createProxyServer();

// Create your server that makes an operation that waits a while
// and then proxies the request
http
  .createServer((req, res) => {
    // This simulates an operation that takes 500ms to execute
    setTimeout(function () {
      proxy.web(req, res, {
        target: "http://localhost:9008",
      });
    }, 500);
  })
  .listen(8008);

// Create your target server
http
  .createServer(function (req, res) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write(
      "request successfully proxied to: " +
        req.url +
        "\n" +
        JSON.stringify(req.headers, true, 2),
    );
    res.end();
  })
  .listen(9008);
```

**[Back to top](#table-of-contents)**

#### Using HTTPS

You can activate the validation of a secure SSL certificate to the target connection (avoid self-signed certs), just set `secure: true` in the options.

##### HTTPS -> HTTP

```js
// Create the HTTPS proxy server in front of a HTTP server
httpProxy
  .createServer({
    target: {
      host: "localhost",
      port: 9009,
    },
    ssl: {
      key: fs.readFileSync("valid-ssl-key.pem", "utf8"),
      cert: fs.readFileSync("valid-ssl-cert.pem", "utf8"),
    },
  })
  .listen(8009);
```

##### HTTPS -> HTTPS

```js
// Create the proxy server listening on port 443
httpProxy
  .createServer({
    ssl: {
      key: fs.readFileSync("valid-ssl-key.pem", "utf8"),
      cert: fs.readFileSync("valid-ssl-cert.pem", "utf8"),
    },
    target: "https://localhost:9010",
    secure: true, // Depends on your needs, could be false.
  })
  .listen(443);
```

##### HTTP -> HTTPS (using a PKCS12 client certificate)

```js
// Create an HTTP proxy server with an HTTPS target
httpProxy
  .createProxyServer({
    target: {
      protocol: "https:",
      host: "my-domain-name",
      port: 443,
      pfx: fs.readFileSync("path/to/certificate.p12"),
      passphrase: "password",
    },
    changeOrigin: true,
  })
  .listen(8000);
```

**[Back to top](#table-of-contents)**

#### Proxying WebSockets

You can activate the websocket support for the proxy using `ws:true` in the options.

```js
// Create a proxy server for websockets
httpProxy
  .createServer({
    target: "ws://localhost:9014",
    ws: true,
  })
  .listen(8014);
```

Also you can proxy the websocket requests just calling the `ws(req, socket, head)` method.

```js
import * as http from "node:http";
import { createProxyServer } from "http-proxy-3";

// Setup our server to proxy standard HTTP requests

const proxy = createProxyServer({
  target: {
    host: "localhost",
    port: 9015,
  },
});
var proxyServer = http.createServer((req, res) => {
  proxy.web(req, res);
});

// Listen to the `upgrade` event and proxy the
// WebSocket requests as well.
proxyServer.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head);
});

proxyServer.listen(8015);
```

**[Back to top](#table-of-contents)**

#### HTTP/2 Support with Fetch

> **⚠️ Experimental Feature**: The fetch code path for HTTP/2 support is currently experimental. While it provides HTTP/2 functionality and has comprehensive test coverage, the API and behavior may change in future versions. Use with caution in production environments.

http-proxy-3 supports HTTP/2 through the native fetch API. When fetch is enabled, the proxy can communicate with HTTP/2 servers. The fetch code path is runtime-agnostic and works across different JavaScript runtimes (Node.js, Deno, Bun, etc.). However, this means HTTP/2 support depends on the runtime. Deno enables HTTP/2 by default, Bun currently does not and Node.js requires to set a different dispatcher. See next section for Node.js details.


##### Basic HTTP/2 Setup

```js
import { createProxyServer } from "http-proxy-3";
import { Agent, setGlobalDispatcher } from "undici";

// Either enable HTTP/2 for all fetch operations
setGlobalDispatcher(new Agent({ allowH2: true }));

// Or create a proxy with HTTP/2 support using fetch
const proxy = createProxyServer({
  target: "https://http2-server.example.com",
  fetchOptions: {
    requestOptions: {dispatcher: new Agent({ allowH2: true })}
  }
});
```

##### Simple Fetch Enablement

```js
// Shorthand to enable fetch with defaults
const proxy = createProxyServer({
  target: "https://http2-server.example.com",
  fetch  // Uses default fetch configuration
});
```

##### Advanced Configuration with Callbacks

```js
const proxy = createProxyServer({
  target: "https://api.example.com",
  fetchOptions: {
    requestOptions: {
      // Use undici's Agent for HTTP/2 support
      dispatcher: new Agent({
        allowH2: true,
        connect: {
          rejectUnauthorized: false,  // For self-signed certs
          timeout: 10000
        }
      }),
    // Additional fetch request options
      headersTimeout: 30000,
      bodyTimeout: 60000
    },
    // Called before making the fetch request
    onBeforeRequest: async (requestOptions, req, res, options) => {
      // Modify outgoing request
      requestOptions.headers['X-API-Key'] = 'your-api-key';
      requestOptions.headers['X-Request-ID'] = Math.random().toString(36);
    },
    // Called after receiving the fetch response
    onAfterResponse: async (response, req, res, options) => {
      // Access full response object
      console.log(`Status: ${response.status}`);
      console.log('Headers:', response.headers);
      // Note: response.body is a stream that will be piped to res automatically
    }
  }
});
```

##### HTTP/2 with HTTPS Proxy

```js
import { readFileSync } from "node:fs";
import { Agent } from "undici";

const proxy = createProxyServer({
  target: "https://http2-target.example.com",
  ssl: {
    key: readFileSync("server-key.pem"),
    cert: readFileSync("server-cert.pem")
  },
  fetchOptions: {
    requestOptions: {
      dispatcher: new Agent({ 
        allowH2: true,
        connect: { rejectUnauthorized: false }
      })
    }
  },
}).listen(8443);
```


**Important Notes:**
- When `fetch` option is provided, the proxy uses the fetch API instead of Node.js native `http`/`https` modules
- To enable HTTP/2, pass a dispatcher (e.g., from undici with `allowH2: true`) in the fetch configuration
- The `onBeforeRequest` and `onAfterResponse` callbacks are only available in the fetch code path
- Traditional `proxyReq` and `proxyRes` events are not emitted in the fetch path - use the callbacks instead
- The fetch approach is runtime-agnostic and doesn't require undici as a dependency for basic HTTP/1.1 proxying

**[Back to top](#table-of-contents)**

### Options

`httpProxy.createProxyServer` supports the following options:

- **target**: url string to be parsed with the url module

- **forward**: url string to be parsed with the url module or a URL object. A forward proxy without target set just forwards requests but does NOT actually wait for a response and return it to the caller.

- **agent**: object to be passed to http\(s\).request \(see Node's [https agent](http://nodejs.org/api/https.html#https_class_https_agent) and [http agent](http://nodejs.org/api/http.html#http_class_http_agent) objects\)

- **ssl**: object to be passed to https.createServer\(\)

- **ws**: true/false, if you want to proxy websockets

- **xfwd**: true/false, adds x\-forward headers

- **secure**: true/false, if you want to verify the SSL Certs. Set this to false if you're proxying another server that has a self-signed cert, e.g., [test/examples/http/proxy-https-to-https.test.ts](lib/test/http/proxy-https-to-https.test.ts).

- **toProxy**: true/false, passes the absolute URL as the `path` \(useful for proxying to proxies\)

- **prependPath**: true/false, Default: true \- specify whether you want to prepend the target's path to the proxy path

- **ignorePath**: true/false, Default: false \- specify whether you want to ignore the proxy path of the incoming request \(note: you will have to append / manually if required\).

- **localAddress**: Local interface string to bind for outgoing connections

- **changeOrigin**: true/false, Default: false \- changes the origin of the host header to the target URL

- **preserveHeaderKeyCase**: true/false, Default: false \- specify whether you want to keep letter case of response header key

- **auth**: Basic authentication i.e. 'user:password' to compute an Authorization header.

- **hostRewrite**: rewrites the location hostname on \(201/301/302/307/308\) redirects.

- **autoRewrite**: rewrites the location host/port on \(201/301/302/307/308\) redirects based on requested host/port. Default: false.

- **protocolRewrite**: rewrites the location protocol on \(201/301/302/307/308\) redirects to 'http' or 'https'. Default: null.

- **cookieDomainRewrite**: rewrites domain of `set-cookie` headers. Possible values:
  - `false` \(default\): disable cookie rewriting
  - String: new domain, for example `cookieDomainRewrite: "new.domain"`. To remove the domain, use `cookieDomainRewrite: ""`.
  - Object: mapping of domains to new domains, use `"*"` to match all domains.
    For example keep one domain unchanged, rewrite one domain and remove other domains:
    ```
    cookieDomainRewrite: {
      "unchanged.domain": "unchanged.domain",
      "old.domain": "new.domain",
      "*": ""
    }
    ```

- **cookiePathRewrite**: rewrites path of `set-cookie` headers. Possible values:
  - `false` \(default\): disable cookie rewriting
  - String: new path, for example `cookiePathRewrite: "/newPath/"`. To remove the path, use `cookiePathRewrite: ""`. To set path to root use `cookiePathRewrite: "/"`.
  - Object: mapping of paths to new paths, use `"*"` to match all paths.
    For example, to keep one path unchanged, rewrite one path and remove other paths:
    ```
    cookiePathRewrite: {
      "/unchanged.path/": "/unchanged.path/",
      "/old.path/": "/new.path/",
      "*": ""
    }
    ```

- **headers**: object with extra headers to be added to target requests.

- **proxyTimeout**: timeout \(in millis\) for outgoing proxy requests

- **timeout**: timeout \(in millis\) for incoming requests

- **followRedirects**: true/false, Default: false \- specify whether you want to follow redirects

- **selfHandleResponse** true/false, if set to true, none of the webOutgoing passes are called and it's your responsibility to appropriately return the response by listening and acting on the `proxyRes` event

- **buffer**: stream of data to send as the request body. Maybe you have some middleware that consumes the request stream before proxying it on e.g. If you read the body of a request into a field called 'req.rawbody' you could restream this field in the buffer option:

  ```
  'use strict';

  const streamify = require('stream-array');
  const HttpProxy = require('http-proxy');
  const proxy = new HttpProxy();

  module.exports = (req, res, next) => {

    proxy.web(req, res, {
      target: 'http://localhost:4003/',
      buffer: streamify(req.rawBody)
    }, next);

  };
  ```

- **ca**: Optionally override the trusted CA certificates. This is passed to https.request.

- **fetchOptions**: Enable fetch API for HTTP/2 support. Provide an object of type `FetchOptions` for custom configuration:
  - `requestOptions`: Additional fetch request options (e.g., undici Agent with `allowH2: true` for HTTP/2 as dispatcher)
  - `onBeforeRequest`: Async callback called before making the fetch request
  - `onAfterResponse`: Async callback called after receiving the fetch response

**NOTE:**
`options.ws` and `options.ssl` are optional.
`options.target` and `options.forward` cannot both be missing

If you are using the `proxyServer.listen` method, the following options are also applicable:

- **ssl**: object to be passed to https.createServer()
- **ws**: true/false, if you want to proxy websockets

**[Back to top](#table-of-contents)**

### Configuration Compatibility

The following table shows which configuration options are compatible with different code paths:

| Option | Native HTTP/HTTPS | Fetch/HTTP/2 | Notes |
|--------|-------------------|---------------|--------|
| `target` | ✅ | ✅ | Core option, works in both paths |
| `forward` | ✅ | ✅ | Core option, works in both paths |
| `agent` | ✅ | ❌ | Native agents only |
| `ssl` | ✅ | ✅ | HTTPS server configuration |
| `ws` | ✅ | ❌ | WebSocket proxying uses native path only |
| `xfwd` | ✅ | ✅ | X-Forwarded headers |
| `secure` | ✅ | ❌¹ | SSL certificate verification |
| `toProxy` | ✅ | ✅ | Proxy-to-proxy configuration |
| `prependPath` | ✅ | ✅ | Path manipulation |
| `ignorePath` | ✅ | ✅ | Path manipulation |
| `localAddress` | ✅ | ✅ | Local interface binding |
| `changeOrigin` | ✅ | ❌ | Host header rewriting |
| `preserveHeaderKeyCase` | ✅ | ❌ | Header case preservation |
| `auth` | ✅ | ✅ | Basic authentication |
| `hostRewrite` | ✅ | ✅ | Redirect hostname rewriting |
| `autoRewrite` | ✅ | ✅ | Automatic redirect rewriting |
| `protocolRewrite` | ✅ | ✅ | Protocol rewriting on redirects |
| `cookieDomainRewrite` | ✅ | ✅ | Cookie domain rewriting |
| `cookiePathRewrite` | ✅ | ✅ | Cookie path rewriting |
| `headers` | ✅ | ✅ | Extra headers to add |
| `proxyTimeout` | ✅ | ✅ | Outgoing request timeout |
| `timeout` | ✅ | ✅ | Incoming request timeout |
| `followRedirects` | ✅ | ✅ | Redirect following |
| `selfHandleResponse` | ✅ | ✅ | Manual response handling |
| `buffer` | ✅ | ✅ | Request body stream |
| `method` | ✅ | ✅ | HTTP method override |
| `ca` | ✅ | ✅ | Custom CA certificates |
| `fetch` | ❌ | ✅ | Fetch-specific configuration |

**Notes:**
- ¹ `secure` is not directly supported in the fetch path. Instead, use a custom dispatcher with `{rejectUnauthorized: false}` to disable SSL certificate verification (e.g., for self-signed certificates).

**Code Path Selection:**
- **Native Path**: Used by default, supports HTTP/1.1 and WebSockets
- **Fetch Path**: Activated when `fetchOptions` option is provided, supports HTTP/2 (with appropriate dispatcher)

**Event Compatibility:**
- **Native Path**: Emits traditional events (`proxyReq`, `proxyRes`, `proxyReqWs`)
- **Fetch Path**: Uses callback functions (`onBeforeRequest`, `onAfterResponse`) instead of events

**[Back to top](#table-of-contents)**

### Listening for proxy events

- `error`: The error event is emitted if the request to the target fail. **We do not do any error handling of messages passed between client and proxy, and messages passed between proxy and target, so it is recommended that you listen on errors and handle them.**
- `proxyReq`: This event is emitted before the data is sent. It gives you a chance to alter the proxyReq request object. Applies to "web" connections
- `proxyReqWs`: This event is emitted before the data is sent. It gives you a chance to alter the proxyReq request object. Applies to "websocket" connections
- `proxyRes`: This event is emitted if the request to the target got a response.
- `open`: This event is emitted once the proxy websocket was created and piped into the target websocket.
- `close`: This event is emitted once the proxy websocket was closed.
- (DEPRECATED) `proxySocket`: Deprecated in favor of `open`.

**Note**: When using the fetch code path (HTTP/2), the `proxyReq` and `proxyRes` events are **not** emitted. Instead, use the `onBeforeRequest` and `onAfterResponse` callback functions in the `fetch` configuration.

#### Traditional Events (Native HTTP/HTTPS path)

```js
import { createProxyServer } from "http-proxy-3";

const proxy = createProxyServer({
  target: "http://localhost:9005",
});

proxy.listen(8005);

// Listen for the `error` event on `proxy`.
proxy.on("error", (err, req, res) => {
  res.writeHead(500, {
    "Content-Type": "text/plain",
  });
  res.end("Something went wrong. And we are reporting a custom error message.");
});

// Listen for the `proxyRes` event on `proxy`.
proxy.on("proxyRes", (proxyRes, req, res) => {
  console.log(
    "RAW Response from the target",
    JSON.stringify(proxyRes.headers, true, 2),
  );
});

// Listen for the `open` event on `proxy`.
proxy.on("open", (proxySocket) => {
  // listen for messages coming FROM the target here
  proxySocket.on("data", hybiParseAndLogMessage);
});
```

#### Callback Functions (Fetch/HTTP2 path)

```js
import { createProxyServer } from "http-proxy-3";
import { Agent } from "undici";

const proxy = createProxyServer({
  target: "https://api.example.com",
  fetchOptions: {
    requestOptions: {dispatcher: new Agent({ allowH2: true })},
    // Called before making the fetch request
    onBeforeRequest: async (requestOptions, req, res, options) => {
      // Modify the outgoing request
      requestOptions.headers['X-Custom-Header'] = 'added-by-callback';
      console.log('Making request to:', requestOptions.headers.host);
    },
    // Called after receiving the fetch response
    onAfterResponse: async (response, req, res, options) => {
      // Access the full response object
      console.log(`Response: ${response.status}`, response.headers);
      // Note: response.body is a stream that will be piped to res automatically
    }
  }
});
```

// Listen for the `close` event on `proxy`.
proxy.on("close", (res, socket, head) => {
  // view disconnected websocket connections
  console.log("Client disconnected");
});
```

**[Back to top](#table-of-contents)**

### Shutdown

- When testing or running server within another program it may be necessary to close the proxy.
- This will stop the proxy from accepting new connections.

```js
const proxy = createProxyServer({
  target: {
    host: "localhost",
    port: 1337,
  },
});

proxy.close();
```

**[Back to top](#table-of-contents)**

### Miscellaneous

If you want to handle your own response after receiving the `proxyRes`, you can do
so with `selfHandleResponse`. As you can see below, if you use this option, you
are able to intercept and read the `proxyRes` but you must also make sure to
reply to the `res` itself otherwise the original client will never receive any
data.

### Modify response

```js
const option = {
  target: target,
  selfHandleResponse: true,
};

proxy.on("proxyRes", (proxyRes, req, res) => {
  var body = [];
  proxyRes.on("data", (chunk) => {
    body.push(chunk);
  });
  proxyRes.on("end", () => {
    body = Buffer.concat(body).toString();
    console.log("res from proxied server:", body);
    res.end("my response to cli");
  });
});

proxy.web(req, res, option);
```

#### ProxyTable API

A proxy table API is available through this add-on [module](https://github.com/donasaur/http-proxy-rules), which lets you define a set of rules to translate matching routes to target routes that the reverse proxy will talk to.

#### **Test**

```sh
pnpm test
```

**[Back to top](#table-of-contents)**

### Contributing and Issues

- Submit a PR! Port ideas from [https://github.com/http\-party/node\-http\-proxy/pulls](https://github.com/http-party/node-http-proxy/pulls) and [https://github.com/http\-party/node\-http\-proxy/issues](https://github.com/http-party/node-http-proxy/issues). Email me at [wstein@sagemath.com](mailto:wstein@sagemath.com).

**[Back to top](#table-of-contents)**

### License

> The MIT License (MIT)
>
> Copyright (c) 2010 - 2025 William Stein, Charlie Robbins, Jarrett Cruger & all other Contributors.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.
