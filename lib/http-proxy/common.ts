import * as required from "requires-port";
import type { ProxyTargetDetailed, ServerOptions } from "./index";
import { type IncomingMessage as Request } from "http";
import { TLSSocket } from "tls";

const upgradeHeader = /(^|,)\s*upgrade\s*($|,)/i;

/**
 * Simple Regex for testing if protocol is https
 */
export const isSSL = /^https|wss/;

/**
 * Copies the right headers from `options` and `req` to
 * `outgoing` which is then used to fire the proxied
 * request.
 *
 * Examples:
 *
 *    common.setupOutgoing(outgoing, options, req)
 *    // => { host: ..., hostname: ...}
 *
 * @param {Object} Outgoing Base object to be filled with required properties
 * @param {Object} Options Config object passed to the proxy
 * @param {ClientRequest} Req Request Object
 * @param {String} Forward String to select forward or target
 *
 * @return {Object} Outgoing Object with all required properties set
 *
 * @api private
 */

type Outgoing0 = ProxyTargetDetailed & ServerOptions;

export interface Outgoing extends Outgoing0 {
  method?: any;
  rejectUnauthorized?: boolean;
  path?: string;
  headers: { [header: string]: string | string[] | undefined };
}

export function setupOutgoing(
  outgoing: Outgoing,
  options,
  req: Request,
  forward: string = "target",
) {
  outgoing.port =
    options[forward].port ?? (isSSL.test(options[forward].protocol) ? 443 : 80);

  [
    "host",
    "hostname",
    "socketPath",
    "pfx",
    "key",
    "passphrase",
    "cert",
    "ca",
    "ciphers",
    "secureProtocol",
  ].forEach(function (e) {
    outgoing[e] = options[forward][e];
  });

  outgoing.method = options.method ?? req.method;
  outgoing.headers = { ...req.headers };

  if (options.headers) {
    outgoing.headers = { ...outgoing.headers, ...options.headers };
  }

  if (options.auth) {
    outgoing.auth = options.auth;
  }

  if (options.ca) {
    outgoing.ca = options.ca;
  }

  if (isSSL.test(options[forward].protocol)) {
    outgoing.rejectUnauthorized =
      typeof options.secure === "undefined" ? true : options.secure;
  }

  outgoing.agent = options.agent || false;
  outgoing.localAddress = options.localAddress;

  //
  // Remark: If we are false and not upgrading, set the connection: close. This is the right thing to do
  // as node core doesn't handle this COMPLETELY properly yet.
  //
  if (!outgoing.agent) {
    outgoing.headers = outgoing.headers || {};
    if (
      typeof outgoing.headers.connection !== "string" ||
      !upgradeHeader.test(outgoing.headers.connection)
    ) {
      outgoing.headers.connection = "close";
    }
  }

  // the final path is target path + relative path requested by user:
  const target = options[forward];
  const targetPath =
    target && options.prependPath !== false ? target.pathname || "" : "";

  let outgoingPath = !options.toProxy
    ? (new URL(req.url ?? "", "http://dummy").pathname ?? "")
    : req.url;

  //
  // Remark: ignorePath will just straight up ignore whatever the request's
  // path is. This can be labeled as FOOT-GUN material if you do not know what
  // you are doing and are using conflicting options.
  //
  outgoingPath = !options.ignorePath ? outgoingPath : "";

  outgoing.path = urlJoin(targetPath, outgoingPath ?? "");

  if (options.changeOrigin) {
    outgoing.headers.host =
      required(outgoing.port, options[forward].protocol) &&
      !hasPort(outgoing.host)
        ? outgoing.host + ":" + outgoing.port
        : outgoing.host;
  }
  return outgoing;
}

/**
 * Set the proper configuration for sockets,
 * set no delay and set keep alive, also set
 * the timeout to 0.
 *
 * Examples:
 *
 *    common.setupSocket(socket)
 *    // => Socket
 *
 * @param {Socket} Socket instance to setup
 *
 * @return {Socket} Return the configured socket.
 *
 * @api private
 */

export function setupSocket(socket) {
  socket.setTimeout(0);
  socket.setNoDelay(true);

  socket.setKeepAlive(true, 0);

  return socket;
}

/**
 * Get the port number from the host. Or guess it based on the connection type.
 *
 * @param {Request} req Incoming HTTP request.
 *
 * @return {String} The port number.
 *
 * @api private
 */
export function getPort(req: Request): string {
  const res = req.headers.host ? req.headers.host.match(/:(\d+)/) : "";
  return res ? res[1] : hasEncryptedConnection(req) ? "443" : "80";
}

/**
 * Check if the request has an encrypted connection.
 *
 * @param req Incoming HTTP request.
 *
 * @return Whether the connection is encrypted or not.
 */
export function hasEncryptedConnection(req: Request): boolean {
  const conn = req.connection;
  return (
    (conn instanceof TLSSocket && conn.encrypted) || Boolean((conn as any).pair)
  );
}

/**
 * OS-agnostic join (doesn't break on URLs like path.join does on Windows)>
 *
 * @return The generated path.
 */

export function urlJoin(...args: string[]): string {
  //
  // join url and merge all query string.
  //
  const queryParams: string[] = [];
  let queryParamRaw = "";
  let retSegs;

  args.forEach((url, index) => {
    var qpStart = url.indexOf("?");
    if (qpStart !== -1) {
      queryParams.push(url.substring(qpStart + 1));
      args[index] = url.substring(0, qpStart);
    }
  });
  queryParamRaw = queryParams.filter(Boolean).join("&");

  //
  // Join all strings, but remove empty strings so we don't get extra slashes from
  // joining e.g. ['', 'am']
  //
  retSegs = args
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/")
    .replace("http:/", "http://")
    .replace("https:/", "https://");

  // Only join the query string if it exists so we don't have trailing a '?'
  // on every request
  return queryParamRaw ? retSegs + "?" + queryParamRaw : retSegs;
}

/**
 * Rewrites or removes the domain of a cookie header
 *
 * @param {String|Array} Header
 * @param {Object} Config, mapping of domain to rewritten domain.
 *                 '*' key to match any domain, null value to remove the domain.
 *
 * @api private
 */
export function rewriteCookieProperty(
  header: string | any[],
  config: object,
  property: string,
) {
  if (Array.isArray(header)) {
    return header.map((headerElement) => {
      return rewriteCookieProperty(headerElement, config, property);
    });
  }
  return header.replace(
    new RegExp("(;\\s*" + property + "=)([^;]+)", "i"),
    (match, prefix, previousValue) => {
      let newValue;
      if (previousValue in config) {
        newValue = config[previousValue];
      } else if ("*" in config) {
        newValue = config["*"];
      } else {
        //no match, return previous value
        return match;
      }
      if (newValue) {
        //replace value
        return prefix + newValue;
      } else {
        //remove value
        return "";
      }
    },
  );
}

/**
 * Check the host and see if it potentially has a port in it (keep it simple)
 *
 * @returns {Boolean} Whether we have one or not
 *
 * @api private
 */
function hasPort(host: string): boolean {
  return !!~host.indexOf(":");
}
