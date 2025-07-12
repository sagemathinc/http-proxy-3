import * as http from "http";
import * as https from "https";
import * as net from "net";
import { WEB_PASSES } from "./passes/web-incoming";
import { WS_PASSES } from "./passes/ws-incoming";
import { EventEmitter } from "events";
import type { Stream } from "stream";
import debug from "debug";
import { toURL } from "./common";

const log = debug("http-proxy-3");

export interface ProxyTargetDetailed {
  host: string;
  port: number;
  protocol?: string;
  hostname?: string;
  socketPath?: string;
  key?: string;
  passphrase?: string;
  pfx?: Buffer | string;
  cert?: string;
  ca?: string;
  ciphers?: string;
  secureProtocol?: string;
}
export type ProxyType = "ws" | "web";
export type ProxyTarget = ProxyTargetUrl | ProxyTargetDetailed;
export type ProxyTargetUrl = URL | string | { port: number; host: string; protocol?: string };

export type NormalizeProxyTarget<T extends ProxyTargetUrl> = Exclude<T, string> | URL;

export interface ServerOptions {
  // NOTE: `options.target and `options.forward` cannot be both missing when the
  // actually proxying is called.  However, they can be missing when creating the
  // proxy server in the first place!  E.g., you could make a proxy server P with
  // no options, then use P.web(req,res, {target:...}).
  /** URL string to be parsed with the url module. */
  target?: ProxyTarget;
  /** URL string to be parsed with the url module or a URL object. */
  forward?: ProxyTargetUrl;
  /** Object to be passed to http(s).request. */
  agent?: any;
  /** Object to be passed to https.createServer(). */
  ssl?: any;
  /** If you want to proxy websockets. */
  ws?: boolean;
  /** Adds x- forward headers. */
  xfwd?: boolean;
  /** Verify SSL certificate. */
  secure?: boolean;
  /** Explicitly specify if we are proxying to another proxy. */
  toProxy?: boolean;
  /** Specify whether you want to prepend the target's path to the proxy path. */
  prependPath?: boolean;
  /** Specify whether you want to ignore the proxy path of the incoming request. */
  ignorePath?: boolean;
  /** Local interface string to bind for outgoing connections. */
  localAddress?: string;
  /** Changes the origin of the host header to the target URL. */
  changeOrigin?: boolean;
  /** specify whether you want to keep letter case of response header key */
  preserveHeaderKeyCase?: boolean;
  /** Basic authentication i.e. 'user:password' to compute an Authorization header. */
  auth?: string;
  /** Rewrites the location hostname on (301 / 302 / 307 / 308) redirects, Default: null. */
  hostRewrite?: string;
  /** Rewrites the location host/ port on (301 / 302 / 307 / 308) redirects based on requested host/ port.Default: false. */
  autoRewrite?: boolean;
  /** Rewrites the location protocol on (301 / 302 / 307 / 308) redirects to 'http' or 'https'.Default: null. */
  protocolRewrite?: string;
  /** rewrites domain of set-cookie headers. */
  cookieDomainRewrite?: false | string | { [oldDomain: string]: string };
  /** rewrites path of set-cookie headers. Default: false */
  cookiePathRewrite?: false | string | { [oldPath: string]: string };
  /** object with extra headers to be added to target requests. */
  headers?: { [header: string]: string | string[] | undefined };
  /** Timeout (in milliseconds) when proxy receives no response from target. Default: 120000 (2 minutes) */
  proxyTimeout?: number;
  /** Timeout (in milliseconds) for incoming requests */
  timeout?: number;
  /** Specify whether you want to follow redirects. Default: false */
  followRedirects?: boolean;
  /** If set to true, none of the webOutgoing passes are called and it's your responsibility to appropriately return the response by listening and acting on the proxyRes event */
  selfHandleResponse?: boolean;
  /** Buffer */
  buffer?: Stream;
  /** Explicitly set the method type of the ProxyReq */
  method?: string;
  /**
   * Optionally override the trusted CA certificates.
   * This is passed to https.request.
   */
  ca?: string;
}

export interface NormalizedServerOptions extends ServerOptions {
  target?: NormalizeProxyTarget<ProxyTarget>;
  forward?: NormalizeProxyTarget<ProxyTargetUrl>;
}

export type ErrorCallback =
  (
    err: Error,
    req: http.IncomingMessage,
    res: http.ServerResponse | net.Socket,
    target?: ProxyTargetUrl,
  ) => void;

type ProxyServerEventMap = {
  error: Parameters<ErrorCallback>;
  start: [
    req: http.IncomingMessage,
    res: http.ServerResponse,
    target: ProxyTargetUrl,
  ];
  open: [socket: net.Socket];
  proxyReq: [
    proxyReq: http.ClientRequest,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: ServerOptions,
    socket: net.Socket,
  ];
  proxyRes: [
    proxyRes: http.IncomingMessage,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ];
  proxyReqWs: [
    proxyReq: http.ClientRequest,
    req: http.IncomingMessage,
    socket: net.Socket,
    options: ServerOptions,
    head: any,
  ];
  econnreset: [
    err: Error,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    target: ProxyTargetUrl,
  ];
  end: [
    req: http.IncomingMessage,
    res: http.ServerResponse,
    proxyRes: http.IncomingMessage,
  ];
  close: [
    proxyRes: http.IncomingMessage,
    proxySocket: net.Socket,
    proxyHead: any,
  ];
}

type ProxyMethodArgs = {
  ws: [
    req: http.IncomingMessage,
    socket: any,
    head: any,
    ...args:
      [
        options?: ServerOptions,
        callback?: ErrorCallback,
      ]
    | [
        callback?: ErrorCallback,
      ]
  ]
  web: [
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ...args:
        [
          options: ServerOptions,
          callback?: ErrorCallback,
        ]
      | [
          callback?: ErrorCallback
        ]
  ]
}

type PassFunctions = {
  ws: (
    req: http.IncomingMessage,
    socket: net.Socket,
    options: NormalizedServerOptions,
    head: Buffer | undefined,
    server: ProxyServer,
    cb?: ErrorCallback
  ) => unknown
  web: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: NormalizedServerOptions,
    head: Buffer | undefined,
    server: ProxyServer,
    cb?: ErrorCallback
  ) => unknown
}

export class ProxyServer extends EventEmitter<ProxyServerEventMap> {
  /**
   * Used for proxying WS(S) requests
   * @param req - Client request.
   * @param socket - Client socket.
   * @param head - Client head.
   * @param options - Additional options.
   */
  public readonly ws: (...args: ProxyMethodArgs["ws"]) => void;

  /**
   * Used for proxying regular HTTP(S) requests
   * @param req - Client request.
   * @param res - Client response.
   * @param options - Additional options.
   */
  public readonly web: (...args: ProxyMethodArgs["web"]) => void;

  private options: ServerOptions;
  private webPasses: Array<PassFunctions['web']>;
  private wsPasses: Array<PassFunctions['ws']>;
  private _server?: http.Server | https.Server | null;

  /**
   * Creates the proxy server with specified options.
   * @param options - Config object passed to the proxy
   */
  constructor(options: ServerOptions = {}) {
    super();
    log("creating a ProxyServer", options);
    options.prependPath = options.prependPath === false ? false : true;
    this.options = options;
    this.web = this.createRightProxy("web")(options);
    this.ws = this.createRightProxy("ws")(options);
    this.webPasses = Object.values(WEB_PASSES);
    this.wsPasses = Object.values(WS_PASSES);
    this.on("error", this.onError);
  }

  /**
   * Creates the proxy server with specified options.
   * @param options Config object passed to the proxy
   * @returns Proxy object with handlers for `ws` and `web` requests
   */
  static createProxyServer(options?: ServerOptions): ProxyServer {
    return new ProxyServer(options);
  }

  /**
   * Creates the proxy server with specified options.
   * @param options Config object passed to the proxy
   * @returns Proxy object with handlers for `ws` and `web` requests
   */
  static createServer(options?: ServerOptions): ProxyServer {
    return new ProxyServer(options);
  }

  /**
   * Creates the proxy server with specified options.
   * @param options Config object passed to the proxy
   * @returns Proxy object with handlers for `ws` and `web` requests
   */
  static createProxy(options?: ServerOptions): ProxyServer {
    return new ProxyServer(options);
  }

  // createRightProxy - Returns a function that when called creates the loader for
  // either `ws` or `web`'s passes.
  createRightProxy = <PT extends ProxyType>(type: PT): Function => {
    log("createRightProxy", { type });
    return (options: ServerOptions) => {
      return (...args: ProxyMethodArgs[PT] /* req, res, [head], [opts] */) => {
        const req = args[0];
        log("proxy: ", { type, path: req.url });
        const res = args[1];
        const passes = type === "ws" ? this.wsPasses : this.webPasses;
        if (type == "ws") {
          // socket -- proxy websocket errors to our error handler;
          // see https://github.com/sagemathinc/http-proxy-3/issues/5
          // NOTE: as mentioned below, res is the socket in this case.
          // One of the passes does add an error handler, but there's no
          // guarantee we even get to that pass before something bad happens,
          // and there's no way for a user of http-proxy-3 to get ahold
          // of this res object and attach their own error handler until
          // after the passes. So we better attach one ASAP right here:
          (res as net.Socket).on("error", (err) => {
            this.emit("error", err, req, res);
          });
        }
        let counter = args.length - 1;
        let head: Buffer | undefined;
        let cb: ErrorCallback | undefined;

        // optional args parse begin
        if (typeof args[counter] === "function") {
          cb = args[counter];
          counter--;
        }

        let requestOptions: ServerOptions;
        if (!(args[counter] instanceof Buffer) && args[counter] !== res) {
          // Copy global options, and overwrite with request options
          requestOptions = { ...options, ...args[counter] };
          counter--;
        } else {
          requestOptions = { ...options };
        }

        if (args[counter] instanceof Buffer) {
          head = args[counter];
        }

        for (const e of ["target", "forward"] as const) {
          if (typeof requestOptions[e] === "string") {
            requestOptions[e] = toURL(requestOptions[e]);
          }
        }

        if (!requestOptions.target && !requestOptions.forward) {
          this.emit("error", new Error("Must set target or forward"), req, res);
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
          if (pass(req, res, requestOptions as NormalizedServerOptions, head, this, cb)) {
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

  /**
   * A function that wraps the object in a webserver, for your convenience
   * @param port - Port to listen on
   * @param hostname - The hostname to listen on
   */
  listen = (port: number, hostname?: string) => {
    log("listen", { port, hostname });

    this._server = this.options.ssl
      ? https.createServer(this.options.ssl, this.web)
      : http.createServer(this.web);

    if (this.options.ws) {
      this._server.on("upgrade", (req, socket, head) => {
        this.ws(req, socket, head);
      });
    }

    this._server.listen(port, hostname);

    return this;
  };

  // if the proxy started its own http server, this is the address of that server.
  address = () => {
    return this._server?.address();
  };

  /**
   * A function that closes the inner webserver and stops listening on given port
   */
  close = (cb?: Function) => {
    if (this._server == null) {
      cb?.();
      return;
    }
    // Wrap cb anb nullify server after all open connections are closed.
    this._server.close((err?) => {
      this._server = null;
      cb?.(err);
    });
  };

  before = <PT extends ProxyType>(type: PT, passName: string, cb: PassFunctions[PT]) => {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = (type === "ws" ? this.wsPasses : this.webPasses) as PassFunctions[PT][];
    let i: false | number = false;

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

  after = <PT extends ProxyType>(type: PT, passName: string, cb: PassFunctions[PT]) => {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = (type === "ws" ? this.wsPasses : this.webPasses) as PassFunctions[PT][];
    let i: false | number = false;

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
