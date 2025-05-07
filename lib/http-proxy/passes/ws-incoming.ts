/*!
 * Websockets Passes: Array of passes.
 *
 * A `pass` is just a function that is executed on `req, socket, options`
 * so that you can easily add new checks while still keeping the base
 * flexible.
 */

import * as http from "http";
import * as https from "https";
import * as common from "../common";
import type { Request } from "./web-incoming";
import type { Socket } from "net";
import debug from "debug";

const log = debug("http-proxy-3:ws-incoming");

function createSocketCounter(name) {
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
    log("socket counter:", { [name]: sockets.size });
  };
}

const socketCounter = createSocketCounter("socket");
const proxySocketCounter = createSocketCounter("proxySocket");

// WebSocket requests must have the `GET` method and
// the `upgrade:websocket` header
export function checkMethodAndHeader(
  req: Request,
  socket: Socket,
): true | undefined {
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
export function XHeaders(req: Request, _socket: Socket, options) {
  if (!options.xfwd) return;

  const values = {
    for: req.connection.remoteAddress || req.socket.remoteAddress,
    port: common.getPort(req),
    proto: common.hasEncryptedConnection(req) ? "wss" : "ws",
  };

  for (const header of ["for", "port", "proto"]) {
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
  options,
  head: Buffer,
  server,
  cb: Function,
) {
  const proxySockets: Socket[] = [];
  socketCounter({ add: socket });
  const cleanUpProxySockets = () => {
    for (const p of proxySockets) {
      p.destroy();
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

  const createHttpHeader = (line, headers) => {
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

      proxySocket.on("end", () => {
        socket.destroy();
      });

      // Allow us to listen for when the websocket has completed.
      proxySocket.on("close", () => {
        socket.destroy();
        server.emit("close", proxyRes, proxySocket, proxyHead);
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

  function onOutgoingError(err) {
    if (cb) {
      cb(err, req, socket);
    } else {
      server.emit("error", err, req, socket);
    }
    socket.destroy();
  }

  proxyReq.end();
}
