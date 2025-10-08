import type { NormalizedServerOptions, ProxyTargetDetailed, ServerOptions } from "./index";
import { type IncomingMessage as Request } from "node:http";
import { TLSSocket } from "node:tls";
import type { Socket } from "node:net";
import * as urllib from "node:url";

const upgradeHeader = /(^|,)\s*upgrade\s*($|,)/i;

// Simple Regex for testing if protocol is https
export const isSSL = /^https|wss/;

type Outgoing0 = ProxyTargetDetailed & ServerOptions;

export interface Outgoing extends Outgoing0 {
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

const HTTP2_HEADER_BLACKLIST = [
  ':method',
  ':path',
  ':scheme',
  ':authority',
]

// setupOutgoing -- Copies the right headers from `options` and `req` to
// `outgoing` which is then used to fire the proxied request by calling
// http.request or https.request with outgoing as input.
// Returns Object with all required properties outgoing options.
export function setupOutgoing(
  // Base object to be filled with required properties
  outgoing: Outgoing,
  // Config object passed to the proxy
  options: NormalizedServerOptions,
  // Request Object
  req: Request,
  // String to select forward or target
  forward?: "forward",
) {
  // the final path is target path + relative path requested by user:
  const target = options[forward || "target"]!;

  outgoing.port =
    +(target.port ?? (target.protocol !== undefined && isSSL.test(target.protocol) ? 443 : 80));

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
  ] as const) {
    // @ts-expect-error -- this mapping is valid
    outgoing[e] = target[e];
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

  if (req.httpVersionMajor > 1) {
    for (const header of HTTP2_HEADER_BLACKLIST) {
      delete outgoing.headers[header];
    }
  }

  if (options.auth) {
    delete outgoing.headers.authorization;
    outgoing.auth = options.auth;
  }

  if (options.ca) {
    outgoing.ca = options.ca;
  }

  if (target.protocol !== undefined && isSSL.test(target.protocol)) {
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

  // target if defined is a URL object so has attribute "pathname", not "path".
  const targetPath =
    target && options.prependPath !== false && 'pathname' in target ? getPath(`${target.pathname}${target.search ?? ""}`) : "/";

  let outgoingPath = options.toProxy ? req.url : getPath(req.url);

  // Remark: ignorePath will just straight up ignore whatever the request's
  // path is. This can be labeled as FOOT-GUN material if you do not know what
  // you are doing and are using conflicting options.
  outgoingPath = !options.ignorePath ? outgoingPath : "";

  outgoing.path = urlJoin(targetPath, outgoingPath ?? "");

  if (options.changeOrigin) {
    outgoing.headers.host =
      target.protocol !== undefined &&
      required(outgoing.port, target.protocol) &&
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
  // Return the port number, as a string.
): string {
  const res = req.headers.host ? req.headers.host.match(/:(\d+)/) : "";
  return res ? res[1] : hasEncryptedConnection(req) ? "443" : "80";
}

// Check if the request has an encrypted connection.
export function hasEncryptedConnection(
  // Incoming HTTP request.
  req: Request,
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

  args.forEach((url, index) => {
    const qpStart = url.indexOf("?");
    if (qpStart !== -1) {
      queryParams.push(url.substring(qpStart + 1));
      args[index] = url.substring(0, qpStart);
    }
  });
  queryParamRaw = queryParams.filter(Boolean).join("&");

  // Join all strings, but remove empty strings so we don't get extra slashes from
  // joining e.g. ['', 'am'].
  // Also we respect strings that start and end in multiple slashes, e.g., so
  //  ['/', '//test', '///foo'] --> '//test'
  // since e.g., http://localhost//test///foo is a valid URL. See
  // lib/test/http/double-slashes.test.ts
  // The algorithm for joining is just straightforward and simple, instead
  // of the complicated "too clever" code from http-proxy. This just concats
  // the strings together, not adding any slashes, and also combining adjacent
  // slashes in two segments, e.g., ['/foo/','/bar'] --> '/foo/bar'
  let retSegs = "";
  for (const seg of args) {
    if (!seg) {
      continue;
    }
    if (retSegs.endsWith("/")) {
      if (seg.startsWith("/")) {
        retSegs += seg.slice(1);
      } else {
        retSegs += seg;
      }
    } else {
      if (seg.startsWith("/")) {
        retSegs += seg;
      } else {
        retSegs += "/" + seg;
      }
    }
  }

  // Only join the query string if it exists so we don't have trailing a '?'
  // on every request
  return queryParamRaw ? retSegs + "?" + queryParamRaw : retSegs;
}

// Rewrites or removes the domain of a cookie header
export function rewriteCookieProperty(
  header: string,
  config: Record<string, string>,
  property: string,
): string;
export function rewriteCookieProperty(
  header: string | string[],
  config: Record<string, string>,
  property: string,
): string | string[];
export function rewriteCookieProperty(
  header: string | string[],
  // config = mapping of domain to rewritten domain.
  //         '*' key to match any domain, null value to remove the domain.
  config: Record<string, string>,
  property: string,
): string | string[] {
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
  if (url === '' || url?.startsWith('?')) {
    return url
  }
  const u = toURL(url);
  return `${u.pathname ?? ""}${u.search ?? ""}`;
}

export function toURL(url: URL | urllib.Url | ProxyTargetDetailed | string | undefined): URL {
  if (url instanceof URL) {
    return url;
  } else if (typeof url === "object" && 'href' in url && typeof url.href === "string") {
    url = url.href;
  }
  if (!url) {
    url = "";
  }
  if (typeof url != "string") {
    // it has to be a string at this point, but to keep typescript happy:
    url = `${url}`;
  }
  if (url.startsWith("//")) {
    // special case -- this would be viewed as a this is a "network-path reference",
    // so we explicitly prefix with our http schema.  See
    url = `http://base.invalid${url}`;
  }
  // urllib.Url is deprecated but we support it by converting to URL
  return new URL(url, "http://base.invalid");
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
