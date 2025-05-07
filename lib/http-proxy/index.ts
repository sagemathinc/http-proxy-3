import * as http from "http";
import * as https from "https";
import * as web from "./passes/web-incoming";
import * as ws from "./passes/ws-incoming";
import { EventEmitter } from "events";
import type { Stream } from "stream";
import debug from "debug";

const log = debug("http-proxy-3");

export interface ProxyTargetDetailed {
  host: string;
  port: number;
  protocol?: string | undefined;
  hostname?: string | undefined;
  socketPath?: string | undefined;
  key?: string | undefined;
  passphrase?: string | undefined;
  pfx?: Buffer | string | undefined;
  cert?: string | undefined;
  ca?: string | undefined;
  ciphers?: string | undefined;
  secureProtocol?: string | undefined;
}
export type ProxyType = "ws" | "web";
export type ProxyTarget = ProxyTargetUrl | ProxyTargetDetailed;
export type ProxyTargetUrl = URL | string;

export interface ServerOptions {
  // NOTE: `options.target and `options.forward` cannot be both missing.
  // URL string to be parsed with the url module.
  target?: ProxyTarget | undefined;
  // URL string to be parsed with the url module or a URL object.
  forward?: ProxyTargetUrl | undefined;
  // Object to be passed to http(s).request.
  agent?: any;
  // Object to be passed to https.createServer().
  ssl?: any;
  // If you want to proxy websockets.
  ws?: boolean | undefined;
  // Adds x- forward headers.
  xfwd?: boolean | undefined;
  // Verify SSL certificate.
  secure?: boolean | undefined;
  // Explicitly specify if we are proxying to another proxy.
  toProxy?: boolean | undefined;
  // Specify whether you want to prepend the target's path to the proxy path.
  prependPath?: boolean | undefined;
  // Specify whether you want to ignore the proxy path of the incoming request.
  ignorePath?: boolean | undefined;
  // Local interface string to bind for outgoing connections.
  localAddress?: string | undefined;
  // Changes the origin of the host header to the target URL.
  changeOrigin?: boolean | undefined;
  // specify whether you want to keep letter case of response header key
  preserveHeaderKeyCase?: boolean | undefined;
  // Basic authentication i.e. 'user:password' to compute an Authorization header.
  auth?: string | undefined;
  // Rewrites the location hostname on (301 / 302 / 307 / 308) redirects, Default: null.
  hostRewrite?: string | undefined;
  // Rewrites the location host/ port on (301 / 302 / 307 / 308) redirects based on requested host/ port.Default: false.
  autoRewrite?: boolean | undefined;
  // Rewrites the location protocol on (301 / 302 / 307 / 308) redirects to 'http' or 'https'.Default: null.
  protocolRewrite?: string | undefined;
  // rewrites domain of set-cookie headers.
  cookieDomainRewrite?:
    | false
    | string
    | { [oldDomain: string]: string }
    | undefined;
  // rewrites path of set-cookie headers. Default: false
  cookiePathRewrite?:
    | false
    | string
    | { [oldPath: string]: string }
    | undefined;
  // object with extra headers to be added to target requests.
  headers?: { [header: string]: string | string[] | undefined };
  // Timeout (in milliseconds) when proxy receives no response from target. Default: 120000 (2 minutes)
  proxyTimeout?: number | undefined;
  // Timeout (in milliseconds) for incoming requests
  timeout?: number | undefined;
  // Specify whether you want to follow redirects. Default: false
  followRedirects?: boolean | undefined;
  // If set to true, none of the webOutgoing passes are called and it's your responsibility to appropriately return the response by listening and acting on the proxyRes event
  selfHandleResponse?: boolean | undefined;
  // Buffer
  buffer?: Stream | undefined;
}

export class ProxyServer extends EventEmitter {
  public readonly ws;
  public readonly web;

  private options: ServerOptions;
  private webPasses;
  private wsPasses;
  private _server?;

  constructor(options: ServerOptions = {}) {
    super();
    log("creating a ProxyServer", options);
    options.prependPath = options.prependPath === false ? false : true;
    this.options = options;
    this.web = this.createRightProxy("web")(options);
    this.ws = this.createRightProxy("ws")(options);
    this.webPasses = Object.keys(web).map((pass: string) => web[pass]);
    this.wsPasses = Object.keys(ws).map((pass: string) => ws[pass]);
    this.on("error", this.onError);
  }

  // createRightProxy - Returns a function that when called creates the loader for
  // either `ws` or `web`'s passes.
  createRightProxy = (type: ProxyType): Function => {
    log("createRightProxy", { type });
    return (options) => {
      return (...args: any[] /* req, res, [head], [opts] */) => {
        const req = args[0];
        // log("proxy got request from", req.url);
        const res = args[1];
        const passes = type === "ws" ? this.wsPasses : this.webPasses;
        let counter = args.length - 1;
        let head;
        let cb;

        // optional args parse begin
        if (typeof args[counter] === "function") {
          cb = args[counter];
          counter--;
        }

        let requestOptions = options;
        if (!(args[counter] instanceof Buffer) && args[counter] !== res) {
          // Copy global options, and
          // overwrite with request options
          requestOptions = { ...options, ...args[counter] };
          counter--;
        }

        if (args[counter] instanceof Buffer) {
          head = args[counter];
        }

        for (const e of ["target", "forward"]) {
          if (typeof requestOptions[e] === "string") {
            requestOptions[e] = new URL(requestOptions[e]);
          }
        }

        if (!requestOptions.target && !requestOptions.forward) {
          this.emit(
            "error",
            new Error("Must provide a proper URL as target or forward"),
          );
          return;
        }

        for (const pass of passes) {
          /**
           * Call of passes functions
           *     pass(req, res, options, head)
           *
           * In WebSockets case, the `res` variable
           * refer to the connection socket
           *    pass(req, socket, options, head)
           */
          if (pass(req, res, requestOptions, head, this, cb)) {
            // passes can return a truthy value to halt the loop
            break;
          }
        }
      };
    };
  };

  onError = (err: Error) => {
    // Force people to handle their own errors
    if (this.listeners("error").length === 1) {
      throw err;
    }
  };

  listen = (port: number, hostname?: string) => {
    log("listen", { port, hostname });
    const self = this;
    const closure = function (req, res) {
      self.web(req, res);
    };

    this._server = this.options.ssl
      ? https.createServer(this.options.ssl, closure)
      : http.createServer(closure);

    if (this.options.ws) {
      this._server.on("upgrade", (req, socket, head) => {
        self.ws(req, socket, head);
      });
    }

    this._server.listen(port, hostname);

    return this;
  };

  // if the proxy started its own http server, this is the address of that server.
  address = () => {
    return this._server?.address();
  };

  close = (cb?: Function) => {
    const self = this;
    if (this._server) {
      this._server.close(done);
    }

    // Wrap cb to nullify server after all open connections are closed.
    function done() {
      self._server = null;
      if (cb) {
        cb.apply(null, arguments);
      }
    }
  };

  before = (type: ProxyType, passName: string, cb: Function) => {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = type === "ws" ? this.wsPasses : this.webPasses;
    let i = false;

    passes.forEach((v, idx) => {
      if (v.name === passName) {
        i = idx;
      }
    });

    if (i === false) {
      throw new Error("No such pass");
    }

    passes.splice(i, 0, cb);
  };

  after = (type: ProxyType, passName: string, cb: Function) => {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = type === "ws" ? this.wsPasses : this.webPasses;
    let i = false;

    passes.forEach((v, idx) => {
      if (v.name === passName) {
        i = idx;
      }
    });

    if (i === false) {
      throw new Error("No such pass");
    }

    passes.splice(i++, 0, cb);
  };
}
