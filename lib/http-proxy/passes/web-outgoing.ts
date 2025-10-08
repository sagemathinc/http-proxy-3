/*
The passes.

A `pass` is just a function that is executed on `req, res, options`
so that you can easily add new checks while still keeping the base
flexible.

NOTE: The function in OUTGOING_PASSES are called. They are assumed
to not return anything.
*/

import type { NormalizedServerOptions, NormalizeProxyTarget, ProxyTarget } from "..";
import * as common from "../common";
import type { Request, ProxyResponse } from "./web-incoming";

const redirectRegex = /^201|30(1|2|7|8)$/;

// interface for subset of Response that's actually used here
// needed for running outgoing passes on MockResponse in ws-incoming
export interface EditableResponse {
  statusCode: number;
  statusMessage: string;
  setHeader(key: string, value: string | string[]): this;
}

// <--

// If is a HTTP 1.0 request, remove chunk headers
export function removeChunked(
  _req: Request,
  _res: EditableResponse,
  // Response object from the proxy request
  proxyRes: ProxyResponse,
) {
  // transfer-encoding is hop-by-hop, don't preserve it across proxy hops
  delete proxyRes.headers["transfer-encoding"];
}

// If is a HTTP 1.0 request, set the correct connection header
// or if connection header not present, then use `keep-alive`
export function setConnection(
  req: Request,
  _res: EditableResponse,
  // Response object from the proxy request
  proxyRes: ProxyResponse,
) {
  if (req.httpVersion === "1.0") {
    proxyRes.headers["connection"] = req.headers["connection"] || "close";
  } else if (req.httpVersion !== "2.0" && !proxyRes.headers["connection"]) {
    proxyRes.headers["connection"] = req.headers["connection"] || "keep-alive";
  }
}

export function setRedirectHostRewrite(
  req: Request,
  _res: EditableResponse,
  proxyRes: ProxyResponse,
  options: NormalizedServerOptions & { target: NormalizeProxyTarget<ProxyTarget> },
) {
  if (
    (options.hostRewrite || options.autoRewrite || options.protocolRewrite) &&
    proxyRes.headers["location"] &&
    redirectRegex.test(`${proxyRes.statusCode}`)
  ) {
    const target = common.toURL(options.target);
    const location = proxyRes.headers["location"];
    if (typeof location != "string") {
      return;
    }
    const u = common.toURL(location);

    // make sure the redirected host matches the target host before rewriting
    if (target.host != u.host) {
      return;
    }

    if (options.hostRewrite) {
      u.host = options.hostRewrite;
    } else if (options.autoRewrite) {
      u.host = req.headers["host"] ?? "";
    }
    if (options.protocolRewrite) {
      u.protocol = options.protocolRewrite;
    }

    proxyRes.headers["location"] = u.toString();
  }
}

// Copy headers from proxyRes to res.
export function writeHeaders(
  _req: Request,
  // Response to set headers in
  res: EditableResponse,
  // Response object from the proxy request
  proxyRes: ProxyResponse,
  // options.cookieDomainRewrite: Config to rewrite cookie domain
  options: NormalizedServerOptions & { target: NormalizeProxyTarget<ProxyTarget> },
) {
  const rewriteCookieDomainConfig =
    typeof options.cookieDomainRewrite === "string"
      ? // also test for ''
        { "*": options.cookieDomainRewrite }
      : options.cookieDomainRewrite;
  const rewriteCookiePathConfig =
    typeof options.cookiePathRewrite === "string"
      ? // also test for ''
        { "*": options.cookiePathRewrite }
      : options.cookiePathRewrite;

  const preserveHeaderKeyCase = options.preserveHeaderKeyCase;
  const setHeader = (key: string, header: string | string[]) => {
    if (header == undefined) {
      return;
    }
    if (rewriteCookieDomainConfig && key.toLowerCase() === "set-cookie") {
      header = common.rewriteCookieProperty(
        header,
        rewriteCookieDomainConfig,
        "domain",
      );
    }
    if (rewriteCookiePathConfig && key.toLowerCase() === "set-cookie") {
      header = common.rewriteCookieProperty(
        header,
        rewriteCookiePathConfig,
        "path",
      );
    }
    res.setHeader(String(key).trim(), header);
  };

  // message.rawHeaders is added in: v0.11.6
  // https://nodejs.org/api/http.html#http_message_rawheaders
  let rawHeaderKeyMap: undefined | { [key: string]: string };
  if (preserveHeaderKeyCase && proxyRes.rawHeaders != undefined) {
    rawHeaderKeyMap = {};
    for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
      const key = proxyRes.rawHeaders[i];
      rawHeaderKeyMap[key.toLowerCase()] = key;
    }
  }

  for (const key0 in proxyRes.headers) {
    let key = key0;
    if (_req.httpVersionMajor > 1 && key === "connection") {
      // don't send connection header to http2 client
      continue;
    }
    const header = proxyRes.headers[key];
    if (preserveHeaderKeyCase && rawHeaderKeyMap) {
      key = rawHeaderKeyMap[key] ?? key;
    }
    setHeader(key, header);
  }
}

// Set the statusCode from the proxyResponse
export function writeStatusCode(
  _req: Request,
  res: EditableResponse,
  proxyRes: ProxyResponse,
) {
  // From Node.js docs: response.writeHead(statusCode[, statusMessage][, headers])
  res.statusCode = proxyRes.statusCode!;

  if (proxyRes.statusMessage && _req.httpVersionMajor === 1) {
    res.statusMessage = proxyRes.statusMessage;
  }
}

export const OUTGOING_PASSES = {
  removeChunked,
  setConnection,
  setRedirectHostRewrite,
  writeHeaders,
  writeStatusCode,
};
