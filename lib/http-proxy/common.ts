import type { ProxyTargetDetailed, ServerOptions } from "./index";
import { type IncomingMessage as Request } from "http";
import { TLSSocket } from "tls";
import type { Socket } from "net";
import * as urllib from "url";

const upgradeHeader = /(^|,)\s*upgrade\s*($|,)/i;

// Simple Regex for testing if protocol is https
export const isSSL = /^https|wss/;

type Outgoing0 = ProxyTargetDetailed & ServerOptions;

export interface Outgoing extends Outgoing0 {
  method?: any;
  rejectUnauthorized?: boolean;
  path?: string;
  headers: { [header: string]: string | string[] | undefined } & {
    overwritten?: boolean;
  };
}

// If we allow this header and a user sends it with a request,
// then serving this request goes into a weird broken state, which
// wastes resources.  This could be a DOS security vulnerability.
// We strip this header if it appears in any request, and then things
// work fine.
// See https://github.com/http-party/node-http-proxy/issues/1647
const HEADER_BLACKLIST = "trailer";

// setupOutgoing -- Copies the right headers from `options` and `req` to
// `outgoing` which is then used to fire the proxied request by calling
// http.request or https.request with outgoing as input.
// Returns Object with all required properties outgoing options.
export function setupOutgoing(
  // Base object to be filled with required properties
  outgoing: Outgoing,
  // Config object passed to the proxy
  options,
  // Request Object
  req: Request,
  // String to select forward or target
  forward?: string,
) {
  outgoing.port =
    options[forward || "target"].port ??
    (isSSL.test(options[forward || "target"].protocol) ? 443 : 80);

  for (const e of [
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
  ]) {
    outgoing[e] = options[forward || "target"][e];
  }

  outgoing.method = options.method || req.method;
  outgoing.headers = { ...req.headers };

  if (options.headers) {
    outgoing.headers = { ...outgoing.headers, ...options.headers };
  }

  // note -- we do the scan in this order since
  // the header could be any case, i.e., doing
  // outgoing.headers['Trailer'] won't work, because
  // it might be {'TrAiLeR':...}
  for (const header in outgoing.headers) {
    if (HEADER_BLACKLIST == header.toLowerCase()) {
      delete outgoing.headers[header];
      break;
    }
  }

  if (options.auth) {
    outgoing.auth = options.auth;
  }

  if (options.ca) {
    outgoing.ca = options.ca;
  }

  if (isSSL.test(options[forward || "target"].protocol)) {
    outgoing.rejectUnauthorized =
      typeof options.secure === "undefined" ? true : options.secure;
  }

  outgoing.agent = options.agent || false;
  outgoing.localAddress = options.localAddress;

  // Remark: If we are false and not upgrading, set the connection: close. This is the right thing to do
  // as node core doesn't handle this COMPLETELY properly yet.
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
  const target = options[forward || "target"];
  // target if defined is a URL object so has attribute "pathname", not "path".
  const targetPath =
    target && options.prependPath !== false ? getPath(target.pathname) : "/";

  let outgoingPath = options.toProxy ? req.url : getPath(req.url);

  // Remark: ignorePath will just straight up ignore whatever the request's
  // path is. This can be labeled as FOOT-GUN material if you do not know what
  // you are doing and are using conflicting options.
  outgoingPath = !options.ignorePath ? outgoingPath : "";

  outgoing.path = urlJoin(targetPath, outgoingPath ?? "");

  if (options.changeOrigin) {
    outgoing.headers.host =
      required(outgoing.port, options[forward || "target"].protocol) &&
      !hasPort(outgoing.host)
        ? outgoing.host + ":" + outgoing.port
        : outgoing.host;
  }
  return outgoing;
}

// Set the proper configuration for sockets,
// set no delay and set keep alive, also set
// the timeout to 0.
// Return the configured socket.
export function setupSocket(socket: Socket): Socket {
  socket.setTimeout(0);
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 0);
  return socket;
}

// Get the port number from the host. Or guess it based on the connection type.
export function getPort(
  // Incoming HTTP request.
  req: Request,
): // Retjurn the port number, as a string.
string {
  const res = req.headers.host ? req.headers.host.match(/:(\d+)/) : "";
  return res ? res[1] : hasEncryptedConnection(req) ? "443" : "80";
}

// Check if the request has an encrypted connection.
export function hasEncryptedConnection(
  req: // Incoming HTTP request.
  Request,
): boolean {
  const conn = req.connection;
  return (
    (conn instanceof TLSSocket && conn.encrypted) || Boolean((conn as any).pair)
  );
}

// OS-agnostic join (doesn't break on URLs like path.join does on Windows)>
export function urlJoin(...args: string[]): string {
  // join url and merge all query string.
  const queryParams: string[] = [];
  let queryParamRaw = "";
  let retSegs;

  args.forEach((url, index) => {
    const qpStart = url.indexOf("?");
    if (qpStart !== -1) {
      queryParams.push(url.substring(qpStart + 1));
      args[index] = url.substring(0, qpStart);
    }
  });
  queryParamRaw = queryParams.filter(Boolean).join("&");

  // Join all strings, but remove empty strings so we don't get extra slashes from
  // joining e.g. ['', 'am']
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

// Rewrites or removes the domain of a cookie header
export function rewriteCookieProperty(
  header: string | any[],
  // config = mapping of domain to rewritten domain.
  //         '*' key to match any domain, null value to remove the domain.
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

// Check the host and see if it potentially has a port in it (keep it simple)
function hasPort(host: string): boolean {
  return !!~host.indexOf(":");
}

function getPath(url?: string): string {
  const u = toURL(url);
  return `${u.pathname ?? ""}${u.search ?? ""}`;
}

export function toURL(url: URL | urllib.Url | string | undefined): URL {
  if (url instanceof URL) {
    return url;
  } else if (typeof url === "object" && typeof url.href === "string") {
    // urllib.Url is deprecated but we support it by converting to URL
    return new URL(url.href, "http://dummy.org");
  } else {
    return new URL(url ?? "", "http://dummy.org");
  }
}

// vendor simplified version of https://www.npmjs.com/package/requires-port to
// reduce dep and add typescript.
function required(port: number, protocol: string): boolean {
  protocol = protocol.split(":")[0];
  port = +port;

  if (!port) return false;

  switch (protocol) {
    case "http":
    case "ws":
      return port !== 80;

    case "https":
    case "wss":
      return port !== 443;
  }

  return port !== 0;
}
