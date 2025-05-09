/*
A `pass` is just a function that is executed on `req, res, options`
so that you can easily add new checks while still keeping the base
flexible.

The names of passes are exported as WEB_PASSES from this module.

*/

import * as http from "http";
import * as https from "https";
import { OUTGOING_PASSES } from "./web-outgoing";
import * as common from "../common";
import * as followRedirects from "follow-redirects";
import {
  type IncomingMessage as Request,
  type ServerResponse as Response,
} from "http";
import { type Socket } from "net";

export type ProxyResponse = Request & {
  headers: { [key: string]: string | string[] };
};
export type { Request, Response };

const web_o = Object.values(OUTGOING_PASSES);

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

  for (const header of ["for", "port", "proto"]) {
    req.headers["x-forwarded-" + header] =
      (req.headers["x-forwarded-" + header] || "") +
      (req.headers["x-forwarded-" + header] ? "," : "") +
      values[header];
  }

  req.headers["x-forwarded-host"] =
    req.headers["x-forwarded-host"] || req.headers["host"] || "";
}

// Does the actual proxying. If `forward` is enabled fires up
// a ForwardStream (there is NO RESPONSE), same happens for ProxyStream. The request
// just dies otherwise.
export function stream(req: Request, res: Response, options, _, server, cb) {
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
      // no target, so we do not send anything back to the client.
      // If target is set, we do a separate proxy below, which might be to a
      // completely different server.
      return res.end();
    }
  }

  // Request initalization
  const proto = options.target.protocol === "https:" ? https : http;
  const outgoingOptions = common.setupOutgoing(options.ssl || {}, options, req);
  const proxyReq = proto.request(outgoingOptions);

  // Enable developers to modify the proxyReq before headers are sent
  proxyReq.on("socket", (socket: Socket) => {
    if (server && !proxyReq.getHeader("expect")) {
      server.emit("proxyReq", proxyReq, req, res, options, socket);
    }
  });

  // allow outgoing socket to timeout so that we could
  // show an error page at the initial request
  if (options.proxyTimeout) {
    proxyReq.setTimeout(options.proxyTimeout, () => {
      proxyReq.destroy();
    });
  }

  // Ensure we abort proxy if request is aborted
  res.on("close", () => {
    const aborted = !res.writableFinished;
    if (aborted) {
      proxyReq.destroy();
    }
  });

  // handle errors in proxy and incoming request, just like for forward proxy
  const proxyError = createErrorHandler(proxyReq, options.target);
  req.on("error", proxyError);
  proxyReq.on("error", proxyError);

  function createErrorHandler(proxyReq, url) {
    return (err) => {
      if (req.socket.destroyed && err.code === "ECONNRESET") {
        server.emit("econnreset", err, req, res, url);
        proxyReq.destroy();
        return;
      }

      if (cb) {
        cb(err, req, res, url);
      } else {
        server.emit("error", err, req, res, url);
      }
    };
  }

  (options.buffer || req).pipe(proxyReq);

  proxyReq.on("response", (proxyRes: ProxyResponse) => {
    server?.emit("proxyRes", proxyRes, req, res);

    if (!res.headersSent && !options.selfHandleResponse) {
      for (const pass of web_o) {
        // note: none of these return anything
        pass(req, res, proxyRes, options);
      }
    }

    if (!res.finished) {
      // Allow us to listen for when the proxy has completed
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

export const WEB_PASSES = { deleteLength, timeout, XHeaders, stream };
