/*
The passes.

A `pass` is just a function that is executed on `req, res, options`
so that you can easily add new checks while still keeping the base
flexible.

The functions exported from this file are not explicitly called.  Instead,
this whole module is imported and iterated over, so in fact they all do get
called elsewhere.
*/

import { parse } from "url";
import * as common from "../common";
import {
  type IncomingMessage as Request,
  type ServerResponse as Response,
} from "http";
import type { ServerOptions } from "../index";

const redirectRegex = /^201|30(1|2|7|8)$/;

// <--

// If is a HTTP 1.0 request, remove chunk headers
export function removeChunked(
  req: Request,
  _res: Response,
  // Response object from the proxy request
  proxyRes: Response,
) {
  if (req.httpVersion === "1.0") {
    proxyRes.removeHeader("transfer-encoding");
  }
}

// If is a HTTP 1.0 request, set the correct connection header
// or if connection header not present, then use `keep-alive`
export function setConnection(
  req: Request,
  _res: Response,
  // Response object from the proxy request
  proxyRes: Response,
) {
  if (req.httpVersion === "1.0") {
    proxyRes.setHeader("connection", req.headers["connection"] ?? "close");
  } else if (req.httpVersion !== "2.0" && !proxyRes.getHeader("connection")) {
    proxyRes.setHeader("connection", req.headers["connection"] ?? "keep-alive");
  }
}

export function setRedirectHostRewrite(
  req: Request,
  _res: Response,
  proxyRes: Response,
  options,
) {
  if (
    (options.hostRewrite || options.autoRewrite || options.protocolRewrite) &&
    proxyRes.getHeader("location") &&
    redirectRegex.test(`${proxyRes.statusCode}`)
  ) {
    const target = parse(options.target);
    const u = parse(proxyRes.getHeaders("location"));

    // make sure the redirected host matches the target host before rewriting
    if (target.host != u.host) {
      return;
    }

    if (options.hostRewrite) {
      u.host = options.hostRewrite;
    } else if (options.autoRewrite) {
      u.host = req.headers["host"];
    }
    if (options.protocolRewrite) {
      u.protocol = options.protocolRewrite;
    }

    proxyRes.setHeaders("location", u.format());
  }
}

// Copy headers from proxyResponse to response
// set each header in response object.
export function writeHeaders(
  req: Request,
  res: Response,
  // Response object from the proxy request
  proxyRes: Response,
  // options.cookieDomainRewrite: Config to rewrite cookie domain
  options,
) {
  let rewriteCookieDomainConfig = options.cookieDomainRewrite;
  let rewriteCookiePathConfig = options.cookiePathRewrite;
  const preserveHeaderKeyCase = options.preserveHeaderKeyCase;
  let rawHeaderKeyMap: { [key: string]: any };
  const setHeader = (key, header) => {
    if (header == undefined) return;
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

  if (typeof rewriteCookieDomainConfig === "string") {
    //also test for ''
    rewriteCookieDomainConfig = { "*": rewriteCookieDomainConfig };
  }

  if (typeof rewriteCookiePathConfig === "string") {
    //also test for ''
    rewriteCookiePathConfig = { "*": rewriteCookiePathConfig };
  }

  // message.rawHeaders is added in: v0.11.6
  // https://nodejs.org/api/http.html#http_message_rawheaders
  if (preserveHeaderKeyCase && proxyRes.rawHeaders != undefined) {
    rawHeaderKeyMap = {};
    for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
      const key = proxyRes.rawHeaders[i];
      rawHeaderKeyMap[key.toLowerCase()] = key;
    }
  }

  for (const key of proxyRes.getHeaderNames()) {
    const header = proxyRes.getHeader(key);
    if (preserveHeaderKeyCase && rawHeaderKeyMap) {
      key = rawHeaderKeyMap[key] || key;
    }
    setHeader(key, header);
  }
}

/**
 * Set the statusCode from the proxyResponse
 *
 * @param {ClientRequest} Req Request object
 * @param {IncomingMessage} Res Response object
 * @param {proxyResponse} Res Response object from the proxy request
 *
 * @api private
 */
export function writeStatusCode(
  _req: Request,
  res: Response,
  proxyRes: Response,
) {
  // From Node.js docs: response.writeHead(statusCode[, statusMessage][, headers])
  if (proxyRes.statusMessage) {
    res.statusCode = proxyRes.statusCode;
    res.statusMessage = proxyRes.statusMessage;
  } else {
    res.statusCode = proxyRes.statusCode;
  }
}
