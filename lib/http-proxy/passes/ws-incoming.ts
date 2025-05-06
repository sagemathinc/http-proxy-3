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

  var values = {
    for: req.connection.remoteAddress || req.socket.remoteAddress,
    port: common.getPort(req),
    proto: common.hasEncryptedConnection(req) ? "wss" : "ws",
  };

  ["for", "port", "proto"].forEach((header: string) => {
    req.headers["x-forwarded-" + header] =
      (req.headers["x-forwarded-" + header] || "") +
      (req.headers["x-forwarded-" + header] ? "," : "") +
      values[header];
  });
}

// Does the actual proxying. Make the request and upgrade it
// send the Switching Protocols request and pipe the sockets.
export function stream(req, socket, options, head, server, clb) {
  const createHttpHeader = (line, headers) => {
    return (
      Object.keys(headers)
        .reduce(
          (head, key) => {
            var value = headers[key];

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

  const proxyReq = (
    common.isSSL.test(options.target.protocol) ? https : http
  ).request(common.setupOutgoing(options.ssl || {}, options, req));

  // Enable developers to modify the proxyReq before headers are sent
  if (server) {
    server.emit("proxyReqWs", proxyReq, req, socket, options, head);
  }

  // Error Handler
  proxyReq.on("error", onOutgoingError);
  proxyReq.on("response", (res) => {
    // if upgrade event isn't going to happen, close the socket
    if (!res.upgrade) {
      socket.write(
        createHttpHeader(
          "HTTP/" +
            res.httpVersion +
            " " +
            res.statusCode +
            " " +
            res.statusMessage,
          res.headers,
        ),
      );
      res.pipe(socket);
    }
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    proxySocket.on("error", onOutgoingError);

    // Allow us to listen when the websocket has completed
    proxySocket.on("end", () => {
      server.emit("close", proxyRes, proxySocket, proxyHead);
    });

    // The pipe below will end proxySocket if socket closes cleanly, but not
    // if it errors (eg, vanishes from the net and starts returning
    // EHOSTUNREACH). We need to do that explicitly.
    socket.on("error", () => {
      proxySocket.destroy();
    });

    common.setupSocket(proxySocket);

    if (proxyHead && proxyHead.length) {
      proxySocket.unshift(proxyHead);
    }

    //
    // Remark: Handle writing the headers to the socket when switching protocols
    // Also handles when a header is an array
    //
    socket.write(
      createHttpHeader("HTTP/1.1 101 Switching Protocols", proxyRes.headers),
    );

    proxySocket.pipe(socket).pipe(proxySocket);

    server.emit("open", proxySocket);
    server.emit("proxySocket", proxySocket); //DEPRECATED.
  });

  function onOutgoingError(err) {
    if (clb) {
      clb(err, req, socket);
    } else {
      server.emit("error", err, req, socket);
    }
    socket.end();
  }

  // TODO: XXX: CHECK IF THIS IS THIS CORRECT
  return proxyReq.end();
}
