import * as http from "node:http";
import * as http2 from "node:http2";
import * as net from "node:net";
import { WEB_PASSES } from "./passes/web-incoming";
import { WS_PASSES } from "./passes/ws-incoming";
import { EventEmitter } from "node:events";
import type { Stream } from "node:stream";
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
export type ProxyTargetUrl =
  | URL
  | string
  | { port: number; host: string; protocol?: string };

export type NormalizeProxyTarget<T extends ProxyTargetUrl> =
  | Exclude<T, string>
  | URL;

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
  /** Enable using fetch for proxy requests. Set to true for defaults, or provide custom configuration. */
  fetch?: boolean | FetchOptions;
}

// use `any` when `lib: "dom"` is included in tsconfig.json,
// as dispatcher property does not exist in RequestInit in that case
export type Dispatcher = (typeof globalThis extends { onmessage: any }
  ? any
  : RequestInit)["dispatcher"];

export interface FetchOptions {
  /** Allow custom dispatcher */
  dispatcher?: Dispatcher;
  /** Fetch request options */
  requestOptions?: RequestInit;
  /** Called before making the fetch request */
  onBeforeRequest?: (
    requestOptions: RequestInit,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: NormalizedServerOptions,
  ) => void | Promise<void>;
  /** Called after receiving the fetch response */
  onAfterResponse?: (
    response: Response,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: NormalizedServerOptions,
  ) => void | Promise<void>;
}

export interface NormalizedServerOptions extends ServerOptions {
  target?: NormalizeProxyTarget<ProxyTarget>;
  forward?: NormalizeProxyTarget<ProxyTargetUrl>;
}

export type ErrorCallback<
  TIncomingMessage extends
    typeof http.IncomingMessage = typeof http.IncomingMessage,
  TServerResponse extends
    typeof http.ServerResponse = typeof http.ServerResponse,
  TError = Error,
> = (
  err: TError,
  req: InstanceType<TIncomingMessage>,
  res: InstanceType<TServerResponse> | net.Socket,
  target?: ProxyTargetUrl,
) => void;

type ProxyServerEventMap<
  TIncomingMessage extends
    typeof http.IncomingMessage = typeof http.IncomingMessage,
  TServerResponse extends
    typeof http.ServerResponse = typeof http.ServerResponse,
  TError = Error,
> = {
  error: Parameters<ErrorCallback<TIncomingMessage, TServerResponse, TError>>;
  start: [
    req: InstanceType<TIncomingMessage>,
    res: InstanceType<TServerResponse>,
    target: ProxyTargetUrl,
  ];
  open: [socket: net.Socket];
  proxyReq: [
    proxyReq: http.ClientRequest,
    req: InstanceType<TIncomingMessage>,
    res: InstanceType<TServerResponse>,
    options: ServerOptions,
    socket: net.Socket,
  ];
  proxyRes: [
    proxyRes: InstanceType<TIncomingMessage>,
    req: InstanceType<TIncomingMessage>,
    res: InstanceType<TServerResponse>,
  ];
  proxyReqWs: [
    proxyReq: http.ClientRequest,
    req: InstanceType<TIncomingMessage>,
    socket: net.Socket,
    options: ServerOptions,
    head: any,
  ];
  econnreset: [
    err: Error,
    req: InstanceType<TIncomingMessage>,
    res: InstanceType<TServerResponse>,
    target: ProxyTargetUrl,
  ];
  end: [
    req: InstanceType<TIncomingMessage>,
    res: InstanceType<TServerResponse>,
    proxyRes: InstanceType<TIncomingMessage>,
  ];
  close: [
    proxyRes: InstanceType<TIncomingMessage>,
    proxySocket: net.Socket,
    proxyHead: any,
  ];
};

type ProxyMethodArgs<
  TIncomingMessage extends
    typeof http.IncomingMessage = typeof http.IncomingMessage,
  TServerResponse extends
    typeof http.ServerResponse = typeof http.ServerResponse,
  TError = Error,
> = {
  ws: [
    req: InstanceType<TIncomingMessage>,
    socket: any,
    head: any,
    ...args:
      | [
          options?: ServerOptions,
          callback?: ErrorCallback<TIncomingMessage, TServerResponse, TError>,
        ]
      | [callback?: ErrorCallback<TIncomingMessage, TServerResponse, TError>],
  ];
  web: [
    req: InstanceType<TIncomingMessage>,
    res: InstanceType<TServerResponse>,
    ...args:
      | [
          options: ServerOptions,
          callback?: ErrorCallback<TIncomingMessage, TServerResponse, TError>,
        ]
      | [callback?: ErrorCallback<TIncomingMessage, TServerResponse, TError>],
  ];
};

type PassFunctions<
  TIncomingMessage extends
    typeof http.IncomingMessage = typeof http.IncomingMessage,
  TServerResponse extends
    typeof http.ServerResponse = typeof http.ServerResponse,
  TError = Error,
> = {
  ws: (
    req: InstanceType<TIncomingMessage>,
    socket: net.Socket,
    options: NormalizedServerOptions,
    head: Buffer | undefined,
    server: ProxyServer<TIncomingMessage, TServerResponse, TError>,
    cb?: ErrorCallback<TIncomingMessage, TServerResponse, TError>,
  ) => unknown;
  web: (
    req: InstanceType<TIncomingMessage>,
    res: InstanceType<TServerResponse>,
    options: NormalizedServerOptions,
    head: Buffer | undefined,
    server: ProxyServer<TIncomingMessage, TServerResponse, TError>,
    cb?: ErrorCallback<TIncomingMessage, TServerResponse, TError>,
  ) => unknown;
};

export class ProxyServer<
  TIncomingMessage extends
    typeof http.IncomingMessage = typeof http.IncomingMessage,
  TServerResponse extends
    typeof http.ServerResponse = typeof http.ServerResponse,
  TError = Error,
> extends EventEmitter<
  ProxyServerEventMap<TIncomingMessage, TServerResponse, TError>
> {
  /**
   * Used for proxying WS(S) requests
   * @param req - Client request.
   * @param socket - Client socket.
   * @param head - Client head.
   * @param options - Additional options.
   */
  public readonly ws: (
    ...args: ProxyMethodArgs<TIncomingMessage, TServerResponse, TError>["ws"]
  ) => void;

  /**
   * Used for proxying regular HTTP(S) requests
   * @param req - Client request.
   * @param res - Client response.
   * @param options - Additional options.
   */
  public readonly web: (
    ...args: ProxyMethodArgs<TIncomingMessage, TServerResponse, TError>["web"]
  ) => void;

  private options: ServerOptions;
  private webPasses: Array<
    PassFunctions<TIncomingMessage, TServerResponse, TError>["web"]
  >;
  private wsPasses: Array<
    PassFunctions<TIncomingMessage, TServerResponse, TError>["ws"]
  >;
  private _server?:
    | http.Server<TIncomingMessage, TServerResponse>
    | http2.Http2SecureServer<TIncomingMessage, TServerResponse>
    | null;

  /**
   * Creates the proxy server with specified options.
   * @param options - Config object passed to the proxy
   */
  constructor(options: ServerOptions = {}) {
    super();
    log("creating a ProxyServer", options);
    options.prependPath = options.prependPath !== false;
    this.options = options;
    this.web = this.createRightProxy("web")(options);
    this.ws = this.createRightProxy("ws")(options);
    this.webPasses = Object.values(WEB_PASSES) as Array<
      PassFunctions<TIncomingMessage, TServerResponse, TError>["web"]
    >;
    this.wsPasses = Object.values(WS_PASSES) as Array<
      PassFunctions<TIncomingMessage, TServerResponse, TError>["ws"]
    >;
    this.on("error", this.onError);
  }

  /**
   * Creates the proxy server with specified options.
   * @param options Config object passed to the proxy
   * @returns Proxy object with handlers for `ws` and `web` requests
   */
  static createProxyServer<
    TIncomingMessage extends typeof http.IncomingMessage,
    TServerResponse extends typeof http.ServerResponse,
    TError = Error,
  >(
    options?: ServerOptions,
  ): ProxyServer<TIncomingMessage, TServerResponse, TError> {
    return new ProxyServer<TIncomingMessage, TServerResponse, TError>(options);
  }

  /**
   * Creates the proxy server with specified options.
   * @param options Config object passed to the proxy
   * @returns Proxy object with handlers for `ws` and `web` requests
   */
  static createServer<
    TIncomingMessage extends typeof http.IncomingMessage,
    TServerResponse extends typeof http.ServerResponse,
    TError = Error,
  >(
    options?: ServerOptions,
  ): ProxyServer<TIncomingMessage, TServerResponse, TError> {
    return new ProxyServer<TIncomingMessage, TServerResponse, TError>(options);
  }

  /**
   * Creates the proxy server with specified options.
   * @param options Config object passed to the proxy
   * @returns Proxy object with handlers for `ws` and `web` requests
   */
  static createProxy<
    TIncomingMessage extends typeof http.IncomingMessage,
    TServerResponse extends typeof http.ServerResponse,
    TError = Error,
  >(
    options?: ServerOptions,
  ): ProxyServer<TIncomingMessage, TServerResponse, TError> {
    return new ProxyServer<TIncomingMessage, TServerResponse, TError>(options);
  }

  // createRightProxy - Returns a function that when called creates the loader for
  // either `ws` or `web`'s passes.
  createRightProxy = <PT extends ProxyType>(type: PT): Function => {
    log("createRightProxy", { type });
    return (options: ServerOptions) => {
      return (
        ...args: ProxyMethodArgs<
          TIncomingMessage,
          TServerResponse,
          TError
        >[PT] /* req, res, [head], [opts] */
      ) => {
        const req = args[0];
        log("proxy: ", { type, path: (req as http.IncomingMessage).url });
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
          (res as net.Socket).on("error", (err: TError) => {
            this.emit("error", err, req, res);
          });
        }
        let counter = args.length - 1;
        let head: Buffer | undefined;
        let cb:
          | ErrorCallback<TIncomingMessage, TServerResponse, TError>
          | undefined;

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
          this.emit(
            "error",
            new Error("Must set target or forward") as TError,
            req,
            res,
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
          if (
            pass(
              req,
              res,
              requestOptions as NormalizedServerOptions,
              head,
              this,
              cb,
            )
          ) {
            // passes can return a truthy value to halt the loop
            break;
          }
        }
      };
    };
  };

  onError = (err: TError) => {
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

    const requestListener = (
      req: InstanceType<TIncomingMessage> | http2.Http2ServerRequest,
      res: InstanceType<TServerResponse> | http2.Http2ServerResponse,
    ) => {
      this.web(
        req as InstanceType<TIncomingMessage>,
        res as InstanceType<TServerResponse>,
      );
    };

    this._server = this.options.ssl
      ? http2.createSecureServer(
          { ...this.options.ssl, allowHTTP1: true },
          requestListener,
        )
      : http.createServer<TIncomingMessage, TServerResponse>(requestListener);

    if (this.options.ws) {
      this._server.on(
        "upgrade",
        (req: InstanceType<TIncomingMessage>, socket, head) => {
          this.ws(req, socket, head);
        },
      );
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

  before = <PT extends ProxyType>(
    type: PT,
    passName: string,
    cb: PassFunctions<TIncomingMessage, TServerResponse, TError>[PT],
  ) => {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = (
      type === "ws" ? this.wsPasses : this.webPasses
    ) as PassFunctions<TIncomingMessage, TServerResponse, TError>[PT][];
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

  after = <PT extends ProxyType>(
    type: PT,
    passName: string,
    cb: PassFunctions<TIncomingMessage, TServerResponse, TError>[PT],
  ) => {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = (
      type === "ws" ? this.wsPasses : this.webPasses
    ) as PassFunctions<TIncomingMessage, TServerResponse, TError>[PT][];
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
