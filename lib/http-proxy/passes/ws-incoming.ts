/*
Websockets Passes: Array of passes.

A `pass` is just a function that is executed on `req, socket, options`
so that you can easily add new checks while still keeping the base
flexible.

The names of passes are exported as WS_PASSES from this module.
*/

import * as http from "node:http";
import * as https from "node:https";
import * as common from "../common";
import type { Request, ProxyResponse } from "./web-incoming";
import { OUTGOING_PASSES, EditableResponse } from "./web-outgoing";
import type { Socket } from "node:net";
import debug from "debug";
import type { NormalizedServerOptions, NormalizeProxyTarget, ProxyServer, ProxyTarget } from "..";

const log = debug("http-proxy-3:ws-incoming");
const web_o = Object.values(OUTGOING_PASSES);

function createSocketCounter(name: string) {
  let sockets = new Set<number>();
  return ({
    add,
    rm,
  }: {
    add?: Socket & { id?: number };
    rm?: Socket & { id?: number };
  } = {}) => {
    if (add) {
      if (!add.id) {
        add.id = Math.random();
      }
      if (!sockets.has(add.id)) {
        sockets.add(add.id);
      }
    }
    if (rm) {
      if (!rm.id) {
        rm.id = Math.random();
      }
      if (sockets.has(rm.id)) {
        sockets.delete(rm.id);
      }
    }
    log(
      "socket counter:",
      { [name]: sockets.size },
      add ? "add" : rm ? "rm" : "",
    );
    return sockets.size;
  };
}

const socketCounter = createSocketCounter("socket");
const proxySocketCounter = createSocketCounter("proxySocket");

/* MockResponse
   when a websocket gets a regular HTTP Response,
   apply proxied headers
*/
class MockResponse implements EditableResponse {
  constructor() {
    this.headers = {};
    this.statusCode = 200
    this.statusMessage = "";
  }
  public headers: { [key: string]: string};
  public statusCode: number;
  public statusMessage: string;
  
  setHeader(key: string, value: string)  {
    this.headers[key] = value;
    return this;
  };
}

export function numOpenSockets(): number {
  return socketCounter() + proxySocketCounter();
}

// WebSocket requests must have the `GET` method and
// the `upgrade:websocket` header
export function checkMethodAndHeader(
  req: Request,
  socket: Socket,
): true | undefined {
  log("websocket: checkMethodAndHeader");
  if (req.method !== "GET" || !req.headers.upgrade) {
    socket.destroy();
    return true;
  }

  if (req.headers.upgrade.toLowerCase() !== "websocket") {
    socket.destroy();
    return true;
  }
}

// Sets `x-forwarded-*` headers if specified in config.
export function XHeaders(req: Request, _socket: Socket, options: NormalizedServerOptions) {
  if (!options.xfwd) return;
  log("websocket: XHeaders");

  const values = {
    for: req.connection.remoteAddress || req.socket.remoteAddress,
    port: common.getPort(req),
    proto: common.hasEncryptedConnection(req) ? "wss" : "ws",
  };

  for (const header of ["for", "port", "proto"] as const) {
    req.headers["x-forwarded-" + header] =
      (req.headers["x-forwarded-" + header] || "") +
      (req.headers["x-forwarded-" + header] ? "," : "") +
      values[header];
  }
}

// Do the actual proxying. Make the request and upgrade it.
// Send the Switching Protocols request and pipe the sockets.
export function stream(
  req: Request,
  socket: Socket,
  options: NormalizedServerOptions,
  head: Buffer | undefined,
  server: ProxyServer,
  cb?: Function,
) {
  log("websocket: new stream");
  const proxySockets: Socket[] = [];
  socketCounter({ add: socket });
  const cleanUpProxySockets = () => {
    for (const p of proxySockets) {
      p.end();
    }
  };
  socket.on("close", () => {
    socketCounter({ rm: socket });
    cleanUpProxySockets();
  });

  // The pipe below will end proxySocket if socket closes cleanly, but not
  // if it errors (eg, vanishes from the net and starts returning
  // EHOSTUNREACH). We need to do that explicitly.
  socket.on("error", cleanUpProxySockets);

  const createHttpHeader = (line: string, headers: http.IncomingHttpHeaders) => {
    return (
      Object.keys(headers)
        .reduce(
          (head, key) => {
            const value = headers[key];

            if (!Array.isArray(value)) {
              head.push(key + ": " + value);
              return head;
            }

            for (let i = 0; i < value.length; i++) {
              head.push(key + ": " + value[i]);
            }
            return head;
          },
          [line],
        )
        .join("\r\n") + "\r\n\r\n"
    );
  };

  common.setupSocket(socket);

  if (head && head.length) {
    socket.unshift(head);
  }

  // @ts-expect-error FIXME: options.target may be undefined
  const proto = common.isSSL.test(options.target.protocol) ? https : http;

  const outgoingOptions = common.setupOutgoing(options.ssl || {}, options, req);
  const proxyReq = proto.request(outgoingOptions);

  // Enable developers to modify the proxyReq before headers are sent
  if (server) {
    server.emit("proxyReqWs", proxyReq, req, socket, options, head);
  }

  // Error Handler
  proxyReq.on("error", onOutgoingError);

  proxyReq.on(
    "upgrade",
    (proxyRes: Request, proxySocket: Socket, proxyHead: Buffer) => {
      log("upgrade");

      proxySocketCounter({ add: proxySocket });
      proxySockets.push(proxySocket);
      proxySocket.on("close", () => {
        proxySocketCounter({ rm: proxySocket });
      });

      proxySocket.on("error", onOutgoingError);

      // Allow us to listen for when the websocket has completed.
      proxySocket.on("end", () => {
        server.emit("close", proxyRes, proxySocket, proxyHead);
      });

      proxySocket.on("close", () => {
        socket.end();
      });

      common.setupSocket(proxySocket);

      if (proxyHead && proxyHead.length) {
        proxySocket.unshift(proxyHead);
      }

      // Remark: Handle writing the headers to the socket when switching protocols
      // Also handles when a header is an array.
      socket.write(
        createHttpHeader("HTTP/1.1 101 Switching Protocols", proxyRes.headers),
      );

      proxySocket.pipe(socket).pipe(proxySocket);

      server.emit("open", proxySocket);
    },
  );

  function onOutgoingError(err: Error) {
    if (cb) {
      cb(err, req, socket);
    } else {
      server.emit("error", err, req, socket);
    }
    // I changed this from "socket.end()" which is what node-http-proxy does to destroySoon() due to getting
    // the unit test "should close client socket if upstream is closed before upgrade" from lib/http-proxy.test.ts
    // to work.  Just doing socket.end() leaves things half open for a while if proxySocket errors out,
    // which may be another leak type situation and definitely doesn't work for unit testing.
    socket.destroySoon();
  }

  // if we get a response, backend is not a websocket endpoint,
  // relay HTTP response and close the socket
  proxyReq.on("response", (proxyRes: ProxyResponse) => {
    log("got non-ws HTTP response",
        {
          statusCode: proxyRes.statusCode,
          statusMessage: proxyRes.statusMessage,
        }
    );

    const res = new MockResponse();
    for (const pass of web_o) {
      // note: none of these return anything
      pass(req, res as EditableResponse, proxyRes, options as NormalizedServerOptions & { target: NormalizeProxyTarget<ProxyTarget> });
    }
    // avoid Invalid character error in chunk size
    delete res.headers['transfer-encoding'];

    const proxyHead = createHttpHeader(
      `HTTP/${req.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}`,
      res.headers,
    );
    if (!socket.destroyed) {
      socket.write(proxyHead);
      proxyRes.pipe(socket);
    } else {
      // make sure response is consumed
      proxyRes.resume();
    }
  });

  proxyReq.end();
}

export const WS_PASSES = { checkMethodAndHeader, XHeaders, stream };
