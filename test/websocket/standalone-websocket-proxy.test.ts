/*
standalone-websocket-proxy.test.ts: Proxying websockets over HTTP with a standalone HTTP server.
*/

import * as httpProxy from "../..";
import getPort from "../get-port";
import { once } from "../wait";
import { createServer } from "http";
import { Server } from "socket.io";
import { io as socketioClient } from "socket.io-client";

describe("Proxying websockets over HTTP with a standalone HTTP server.", () => {
  let ports;
  it("assigns ports", async () => {
    ports = { ws: await getPort(), proxy: await getPort() };
  });

  let servers: any = {};

  it("Create the target websocket server", async () => {
    const io = new Server();
    servers.ws = io;
    io.on("connection", (client) => {
      client.on("message", () => {
        client.send("from server");
      });
    });
    io.listen(ports.ws);
  });

  let proxy;
  it("Setup our proxy server to proxy standard HTTP requests", async () => {
    proxy = httpProxy.createProxyServer({
      target: {
        host: "localhost",
        port: ports.ws,
      },
    });

    servers.proxyServer = createServer((req, res) => {
      proxy.web(req, res);
    });
  });

  it("Listen to the `upgrade` event and proxy the WebSocket requests as well.", async () => {
    servers.proxyServer.on("upgrade", (req, socket, head) => {
      proxy.ws(req, socket, head);
    });
    servers.proxyServer.listen(ports.proxy);
  });

  it("Create client and test the proxy server directly", async () => {
    const client = socketioClient(`ws://localhost:${ports.proxy}`);
    client.send("I am the client");
    const msg = await once(client as any, "message");
    expect(msg).toEqual(["from server"]);
    client.close();
  });

  it("cleans up", () => {
    Object.values(servers).map((x: any) => x?.close());
  });
});

/*

try {
  var io = require('socket.io'),
      client = require('socket.io-client');
}
catch (ex) {
  console.error('Socket.io is required for this example:');
  console.error('npm ' + 'install'.green);
  process.exit(1);
}

//
// Create the target HTTP server and setup
// socket.io on it.
//
var server = io.listen(9015);
server.sockets.on('connection', function (client) {
  util.debug('Got websocket connection');

  client.on('message', function (msg) {
    util.debug('Got message from client: ' + msg);
  });

  client.send('from server');
});

//
// Setup our server to proxy standard HTTP requests
//
var proxy = new httpProxy.createProxyServer({
  target: {
    host: 'localhost',
    port: 9015
  }
});
var proxyServer = http.createServer(function (req, res) {
  proxy.web(req, res);
});

//
// Listen to the `upgrade` event and proxy the
// WebSocket requests as well.
//
proxyServer.on('upgrade', function (req, socket, head) {
  proxy.ws(req, socket, head);
});

proxyServer.listen(8015);

//
// Setup the socket.io client against our proxy
//
var ws = client.connect('ws://localhost:8015');

ws.on('message', function (msg) {
  util.debug('Got message: ' + msg);
  ws.send('I am the client');
});
*/
