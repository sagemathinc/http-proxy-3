/*
A `pass` is just a function that is executed on `req, res, options`
so that you can easily add new checks while still keeping the base
flexible.

NOTE: The functions exported from this module are not explicitly called. 
Instead, this whole module is imported and iterated over, so in fact 
they all do get called elsewhere.

*/

import * as http from "http";
import * as https from "https";
import * as webOutgoing from "./web-outgoing";
import * as common from "../common";
import * as followRedirects from "follow-redirects";
import {
  type IncomingMessage as Request,
  type ServerResponse as Response,
} from "http";

export type ProxyResponse = Request & {
  headers: { [key: string]: string | string[] };
};
export { Request, Response };

const web_o = Object.keys(webOutgoing).map((pass) => webOutgoing[pass]);

const nativeAgents = { http, https };

//  Sets `content-length` to '0' if request is of DELETE type.
export function deleteLength(req: Request) {
  if (
    (req.method === "DELETE" || req.method === "OPTIONS") &&
    !req.headers["content-length"]
  ) {
    req.headers["content-length"] = "0";
    delete req.headers["transfer-encoding"];
  }
}

// Sets timeout in request socket if it was specified in options.
export function timeout(req: Request, _res, options) {
  if (options.timeout) {
    req.socket.setTimeout(options.timeout);
  }
}

// Sets `x-forwarded-*` headers if specified in config.
export function XHeaders(req: Request, _res, options) {
  if (!options.xfwd) {
    return;
  }

  const encrypted = common.hasEncryptedConnection(req);
  const values = {
    for: req.connection.remoteAddress || req.socket.remoteAddress,
    port: common.getPort(req),
    proto: encrypted ? "https" : "http",
  };

  ["for", "port", "proto"].forEach((header) => {
    req.headers["x-forwarded-" + header] =
      (req.headers["x-forwarded-" + header] || "") +
      (req.headers["x-forwarded-" + header] ? "," : "") +
      values[header];
  });

  req.headers["x-forwarded-host"] =
    req.headers["x-forwarded-host"] || req.headers["host"] || "";
}

// Does the actual proxying. If `forward` is enabled fires up
// a ForwardStream, same happens for ProxyStream. The request
// just dies otherwise.
export function stream(req: Request, res: Response, options, _, server, clb) {
  // And we begin!
  server.emit("start", req, res, options.target || options.forward);

  const agents = options.followRedirects ? followRedirects : nativeAgents;
  const http = agents.http;
  const https = agents.https;

  if (options.forward) {
    // forward enabled, so just pipe the request
    const forwardReq = (
      options.forward.protocol === "https:" ? https : http
    ).request(common.setupOutgoing(options.ssl || {}, options, req, "forward"));

    // error handler (e.g. ECONNRESET, ECONNREFUSED)
    // Handle errors on incoming request as well as it makes sense to
    const forwardError = createErrorHandler(forwardReq, options.forward);
    req.on("error", forwardError);
    forwardReq.on("error", forwardError);

    (options.buffer || req).pipe(forwardReq);
    if (!options.target) {
      return res.end();
    }
  }

  // Request initalization
  const proxyReq = (
    options.target.protocol === "https:" ? https : http
  ).request(common.setupOutgoing(options.ssl || {}, options, req));

  // Enable developers to modify the proxyReq before headers are sent
  proxyReq.on("socket", (socket) => {
    if (server && !proxyReq.getHeader("expect")) {
      server.emit("proxyReq", proxyReq, req, res, options, socket);
    }
  });

  // allow outgoing socket to timeout so that we could
  // show an error page at the initial request
  if (options.proxyTimeout) {
    proxyReq.setTimeout(options.proxyTimeout, () => {
      proxyReq.abort();
    });
  }

  // Ensure we abort proxy if request is aborted
  res.on("close", () => {
    const aborted = !res.writableFinished;
    if (aborted) {
      proxyReq.abort();
    }
  });

  // handle errors in proxy and incoming request, just like for forward proxy
  const proxyError = createErrorHandler(proxyReq, options.target);
  req.on("error", proxyError);
  proxyReq.on("error", proxyError);

  function createErrorHandler(proxyReq, url) {
    return function proxyError(err) {
      if (req.socket.destroyed && err.code === "ECONNRESET") {
        server.emit("econnreset", err, req, res, url);
        return proxyReq.abort();
      }

      if (clb) {
        clb(err, req, res, url);
      } else {
        server.emit("error", err, req, res, url);
      }
    };
  }

  (options.buffer || req).pipe(proxyReq);

  proxyReq.on("response", (proxyRes: ProxyResponse) => {
    server?.emit("proxyRes", proxyRes, req, res);

    if (!res.headersSent && !options.selfHandleResponse) {
      for (let i = 0; i < web_o.length; i++) {
        if (web_o[i](req, res, proxyRes, options)) {
          break;
        }
      }
    }

    if (!res.finished) {
      // Allow us to listen when the proxy has completed
      proxyRes.on("end", () => {
        server?.emit("end", req, res, proxyRes);
      });
      // We pipe to the response unless its expected to be handled by the user
      if (!options.selfHandleResponse) {
        proxyRes.pipe(res);
      }
    } else {
      server?.emit("end", req, res, proxyRes);
    }
  });
}
