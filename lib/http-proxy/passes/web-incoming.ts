/*
A `pass` is just a function that is executed on `req, res, options`
so that you can easily add new checks while still keeping the base
flexible.

The names of passes are exported as WEB_PASSES from this module.

*/

import type {
  IncomingMessage as Request,
  ServerResponse as Response,
} from "node:http";
import * as http from "node:http";
import * as https from "node:https";
import type { Socket } from "node:net";
import type Stream from "node:stream";
import * as followRedirects from "follow-redirects";
import type { Dispatcher } from "undici";
import type { ErrorCallback, FetchOptions, NormalizedServerOptions, NormalizeProxyTarget, ProxyServer, ProxyTarget, ProxyTargetUrl, ServerOptions } from "..";
import * as common from "../common";
import { type EditableResponse, OUTGOING_PASSES } from "./web-outgoing";
import { Readable } from "node:stream";

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
export function stream(req: Request, res: Response, options: NormalizedServerOptions, _: Buffer | undefined, server: ProxyServer, cb: ErrorCallback | undefined) {
  // And we begin!
  server.emit("start", req, res, options.target || options.forward!);

  if (options.fetch) {
    return stream2(req, res, options, _, server, cb);
  }

  const agents = options.followRedirects ? followRedirects : nativeAgents;
  const http = agents.http as typeof import('http');
  const https = agents.https as typeof import('https');

  if (options.forward) {
    // forward enabled, so just pipe the request
    const proto = options.forward.protocol === "https:" ? https : http;
    const outgoingOptions = common.setupOutgoing(
      options.ssl || {},
      options,
      req,
      "forward",
    );
    const forwardReq = proto.request(outgoingOptions);

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
  const proto = options.target!.protocol === "https:" ? https : http;
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
  const proxyError = createErrorHandler(proxyReq, options.target!);
  req.on("error", proxyError);
  proxyReq.on("error", proxyError);

  function createErrorHandler(proxyReq: http.ClientRequest, url: NormalizeProxyTarget<ProxyTargetUrl>) {
    return (err: Error) => {
      if (req.socket.destroyed && (err as NodeJS.ErrnoException).code === "ECONNRESET") {
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
        pass(req, res as EditableResponse, proxyRes, options as NormalizedServerOptions & { target: NormalizeProxyTarget<ProxyTarget> });
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


async function stream2(
  req: Request,
  res: Response,
  options: NormalizedServerOptions,
  _: Buffer | undefined,
  server: ProxyServer,
  cb?: ErrorCallback,
) {

  // Helper function to handle errors consistently throughout the undici path
  // Centralizes the error handling logic to avoid repetition
  const handleError = (err: Error, target?: ProxyTargetUrl) => {
    if (cb) {
      cb(err, req, res, target);
    } else {
      server.emit("error", err, req, res, target);
    }
  };

  req.on("error", (err: Error) => {
    if (req.socket.destroyed && (err as NodeJS.ErrnoException).code === "ECONNRESET") {
      const target = options.target || options.forward;
      if (target) {
        server.emit("econnreset", err, req, res, target);
      }
      return;
    }
    handleError(err);
  });

  const fetchOptions = options.fetch === true ? {} as FetchOptions : options.fetch;
  if (!fetchOptions) {
    throw new Error("stream2 called without fetch options");
  }


  if (options.forward) {
    const outgoingOptions = common.setupOutgoing(
      options.ssl || {},
      options,
      req,
      "forward",
    );

    const requestOptions: RequestInit = {
      method: outgoingOptions.method,
    }

    if (fetchOptions.dispatcher) {
      requestOptions.dispatcher = fetchOptions.dispatcher;
    }

    // Handle request body
    if (options.buffer) {
      requestOptions.body = options.buffer as Stream.Readable;
    } else if (req.method !== "GET" && req.method !== "HEAD") {
      requestOptions.body = req;
    }

    // Call onBeforeRequest callback before making the forward request
    if (fetchOptions.onBeforeRequest) {
      try {
        await fetchOptions.onBeforeRequest(requestOptions, req, res, options);
      } catch (err) {
        handleError(err as Error, options.forward);
        return;
      }
    }

    try {
      const result = await fetch(outgoingOptions.url, requestOptions);

      // Call onAfterResponse callback for forward requests (though they typically don't expect responses)
      if (fetchOptions.onAfterResponse) {
        try {
          await fetchOptions.onAfterResponse(result, req, res, options);
        } catch (err) {
          handleError(err as Error, options.forward);
          return;
        }
      }
    } catch (err) {
      handleError(err as Error, options.forward);
    }

    if (!options.target) {
      return res.end();
    }
  }

  const outgoingOptions = common.setupOutgoing(options.ssl || {}, options, req);

  const requestOptions: RequestInit = {
    method: outgoingOptions.method as Dispatcher.HttpMethod,
    headers: outgoingOptions.headers as Record<string, string>,
    ...fetchOptions.requestOptions
  };

  if (fetchOptions.dispatcher) {
    requestOptions.dispatcher = fetchOptions.dispatcher;
  }

  if (options.auth) {
    requestOptions.headers = { ...requestOptions.headers, authorization: `Basic ${Buffer.from(options.auth).toString("base64")}` };
  }

  if (options.buffer) {
    requestOptions.body = options.buffer as Stream.Readable;
  } else if (req.method !== "GET" && req.method !== "HEAD") {
    requestOptions.body = req;
  }

  // Call onBeforeRequest callback before making the request
  if (fetchOptions.onBeforeRequest) {
    try {
      await fetchOptions.onBeforeRequest(requestOptions, req, res, options);
    } catch (err) {
      handleError(err as Error, options.target);
      return;
    }
  }

  try {
    const response = await fetch(outgoingOptions.url, requestOptions);

    // Call onAfterResponse callback after receiving the response
    if (fetchOptions.onAfterResponse) {
      try {
        await fetchOptions.onAfterResponse(response, req, res, options);
      } catch (err) {
        handleError(err as Error, options.target);
        return;
      }
    }


    // ProxyRes is used in the outgoing passes
    // But since only certain properties are used, we can fake it here
    // to avoid having to refactor everything.
    const fakeProxyRes = {
      ...response, rawHeaders: Object.entries(response.headers).flatMap(([key, value]) => {
        if (Array.isArray(value)) {
          return value.flatMap(v => (v != null ? [key, v] : []));
        }
        return value != null ? [key, value] : [];
      }) as string[]
    } as unknown as ProxyResponse;

    if (!res.headersSent && !options.selfHandleResponse) {
      for (const pass of web_o) {
        // note: none of these return anything
        pass(req, res as EditableResponse, fakeProxyRes, options as NormalizedServerOptions & { target: NormalizeProxyTarget<ProxyTarget> });
      }
    }

    if (!res.writableEnded) {
      // Allow us to listen for when the proxy has completed
      const nodeStream = response.body
        ? Readable.from(response.body as AsyncIterable<Uint8Array>)
        : null;

      if (nodeStream) {
        nodeStream.on("end", () => {
          server?.emit("end", req, res, fakeProxyRes);
        });
        // We pipe to the response unless its expected to be handled by the user
        if (!options.selfHandleResponse) {
          nodeStream.pipe(res);
        }
      } else {
        server?.emit("end", req, res, fakeProxyRes);
      }
    } else {
      server?.emit("end", req, res, fakeProxyRes);
    }

  } catch (err) {
    if (err) {
      handleError(err as Error, options.target);
    }
  }


}

export const WEB_PASSES = { deleteLength, timeout, XHeaders, stream };
