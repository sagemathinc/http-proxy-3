/*
A `pass` is just a function that is executed on `req, res, options`
so that you can easily add new checks while still keeping the base
flexible.

The names of passes are exported as WEB_PASSES from this module.

*/

import * as http from "node:http";
import * as https from "node:https";
import { OUTGOING_PASSES, EditableResponse } from "./web-outgoing";
import * as common from "../common";
import * as followRedirects from "follow-redirects";
import {
  type IncomingMessage as Request,
  type ServerResponse as Response,
} from "node:http";
import { type Socket } from "node:net";
import type {
  ErrorCallback,
  NormalizedServerOptions,
  NormalizeProxyTarget,
  ProxyServer,
  ProxyTarget,
  ProxyTargetUrl,
  ServerOptions,
} from "..";
import { Dispatcher, request, stream as uStream, Client } from "undici";

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
export function timeout(req: Request, _res: Response, options: ServerOptions) {
  if (options.timeout) {
    req.socket.setTimeout(options.timeout);
  }
}

// Sets `x-forwarded-*` headers if specified in config.
export function XHeaders(req: Request, _res: Response, options: ServerOptions) {
  if (!options.xfwd) {
    return;
  }

  const encrypted = common.hasEncryptedConnection(req);
  const values = {
    for: req.connection.remoteAddress || req.socket.remoteAddress,
    port: common.getPort(req),
    proto: encrypted ? "https" : "http",
  };

  for (const header of ["for", "port", "proto"] as const) {
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
export async function stream(
  req: Request,
  res: Response,
  options: NormalizedServerOptions,
  _: Buffer | undefined,
  server: ProxyServer,
  cb: ErrorCallback | undefined,
) {
  // And we begin!
  server.emit("start", req, res, options.target || options.forward!);

  const agents = options.followRedirects ? followRedirects : nativeAgents;
  const http = agents.http as typeof import("http");
  const https = agents.https as typeof import("https");

  if (options.forward) {
    const outgoingOptions = common.setupOutgoing(
      options.ssl || {},
      options,
      req,
      "forward",
    );

    const targetUrl = `${outgoingOptions.url}`;

    const undiciOptions: any = {
      method: outgoingOptions.method as Dispatcher.HttpMethod,
      headers: outgoingOptions.headers,
      path: outgoingOptions.path,
    };

    // Handle request body
    if (options.buffer) {
      undiciOptions.body = options.buffer;
    } else if (req.method !== "GET" && req.method !== "HEAD") {
      undiciOptions.body = req;
    }

    try {
      const client = new Client(targetUrl);
      await client.request(undiciOptions);
    } catch (err) {
      if (cb) {
        cb(err as Error, req, res, options.forward);
      } else {
        server.emit("error", err as Error, req, res, options.forward);
      }
    }

    if (!options.target) {
      return res.end();
    }
  }

  // Request initalization
  const outgoingOptions = common.setupOutgoing(options.ssl || {}, options, req);
  const client = new Client(outgoingOptions.url, {
    allowH2: req.httpVersionMajor === 2,
  });
  // const proxyReq = proto.request(outgoingOptions);

  const dispatchOptions: Dispatcher.DispatchOptions = {
    method: outgoingOptions.method as Dispatcher.HttpMethod,
    path: outgoingOptions.path || "/",
    headers: outgoingOptions.headers,

    body:
      options.buffer ||
      (req.method !== "GET" && req.method !== "HEAD" ? req : undefined),
  };

  let responseStarted = false;

  client.dispatch(dispatchOptions, {
    onRequestStart(controller, context) {
      // Can modify the request just before headers are sent
      console.log("onRequestStart");
    },
    onResponseStart(controller, statusCode, headers, statusMessage) {
      // Set response status and headers - crucial for SSE
      res.statusCode = statusCode;

      // Set headers from the record object
      for (const [name, value] of Object.entries(headers)) {
        res.setHeader(name, value);
      }

      // For SSE, ensure headers are sent immediately
      const contentType = headers["content-type"] || headers["Content-Type"];
      if (contentType && contentType.toString().includes("text/event-stream")) {
        res.flushHeaders();
      }

      responseStarted = true;
    },
    onResponseError(controller, err) {
      if (
        req.socket.destroyed &&
        (err as NodeJS.ErrnoException).code === "ECONNRESET"
      ) {
        server.emit("econnreset", err, req, res, outgoingOptions.url);
        controller.abort(err);
        return;
      }

      if (cb) {
        cb(err, req, res, outgoingOptions.url);
      } else {
        server.emit("error", err, req, res, outgoingOptions.url);
      }
    },
    onResponseData(controller, chunk) {
      if (responseStarted) {
        res.write(chunk);
      }
    },
    onResponseEnd(controller, trailers) {
      if (trailers) {
        res.addTrailers(trailers);
      }
      res.end();
      client.close();
    },
  });

  return;

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
  const proxyError = createErrorHandler(proxyReq, options.target!);
  req.on("error", proxyError);
  proxyReq.on("error", proxyError);

  function createErrorHandler(
    proxyReq: http.ClientRequest,
    url: NormalizeProxyTarget<ProxyTargetUrl>,
  ) {
    return (err: Error) => {
      if (
        req.socket.destroyed &&
        (err as NodeJS.ErrnoException).code === "ECONNRESET"
      ) {
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
        pass(
          req,
          res as EditableResponse,
          proxyRes,
          options as NormalizedServerOptions & {
            target: NormalizeProxyTarget<ProxyTarget>;
          },
        );
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
