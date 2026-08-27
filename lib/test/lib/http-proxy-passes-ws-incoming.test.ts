/*
pnpm test ./http-proxy-passes-ws-incoming.test.ts
*/

import {
  checkMethodAndHeader as checkMethodAndHeader0,
  XHeaders,
} from "../../http-proxy/passes/ws-incoming";
import {describe, it, expect} from 'vitest';

// disable typescript for this function
function checkMethodAndHeader(...args: any[]) {
  return checkMethodAndHeader0(args[0], args[1]);
}

describe("#checkMethodAndHeader", () => {
  it("should drop non-GET connections", () => {
    let destroyCalled = false,
      stubRequest = {
        method: "DELETE",
        headers: {},
      },
      stubSocket = {
        destroy: () => {
          // Simulate Socket.destroy() method when call
          destroyCalled = true;
        },
      };
    const returnValue = checkMethodAndHeader(stubRequest, stubSocket);
    expect(returnValue).toBe(true);
    expect(destroyCalled).toBe(true);
  });

  it("should drop connections when no upgrade header", () => {
    let destroyCalled = false,
      stubRequest = {
        method: "GET",
        headers: {},
      },
      stubSocket = {
        destroy: () => {
          // Simulate Socket.destroy() method when call
          destroyCalled = true;
        },
      };
    const returnValue = checkMethodAndHeader(stubRequest, stubSocket);
    expect(returnValue).toBe(true);
    expect(destroyCalled).toBe(true);
  });

  it("should drop connections when upgrade header is different of `websocket`", () => {
    let destroyCalled = false,
      stubRequest = {
        method: "GET",
        headers: {
          upgrade: "anotherprotocol",
        },
      },
      stubSocket = {
        destroy: () => {
          // Simulate Socket.destroy() method when call
          destroyCalled = true;
        },
      };
    const returnValue = checkMethodAndHeader(stubRequest, stubSocket);
    expect(returnValue).toBe(true);
    expect(destroyCalled).toBe(true);
  });

  it("should return nothing when all is ok", () => {
    let destroyCalled = false,
      stubRequest = {
        method: "GET",
        headers: {
          upgrade: "websocket",
        },
      },
      stubSocket = {
        destroy: () => {
          // Simulate Socket.destroy() method when call
          destroyCalled = true;
        },
      };
    const returnValue = checkMethodAndHeader(stubRequest, stubSocket);
    expect(returnValue).toBe(undefined);
    expect(destroyCalled).toBe(false);
  });
});

describe("#XHeaders", () => {
  it("return if no forward request", () => {
    // @ts-ignore
    let returnValue = XHeaders({}, {}, {});
    expect(returnValue).toBe(undefined);
  });

  it("set the correct x-forwarded-* headers from req.connection", () => {
    let stubRequest = {
      connection: {
        remoteAddress: "192.168.1.2",
        remotePort: "8080",
      },
      headers: {
        host: "192.168.1.2:8080",
      } as Record<string, string>,
    };
    // @ts-ignore
    XHeaders(stubRequest, {}, { xfwd: true });
    expect(stubRequest.headers["x-forwarded-for"]).toBe("192.168.1.2");
    expect(stubRequest.headers["x-forwarded-port"]).toBe("8080");
    expect(stubRequest.headers["x-forwarded-proto"]).toBe("ws");
    expect(stubRequest.headers["x-forwarded-host"]).toBe("192.168.1.2:8080");
  });

  it("set the correct x-forwarded-* headers from req.socket", () => {
    let stubRequest = {
      socket: {
        remoteAddress: "192.168.1.3",
        remotePort: "8181",
      },
      connection: {
        pair: true,
      },
      headers: {
        host: "192.168.1.3:8181",
      } as Record<string, string>,
    };
    // @ts-ignore
    XHeaders(stubRequest, {}, { xfwd: true });
    expect(stubRequest.headers["x-forwarded-for"]).toBe("192.168.1.3");
    expect(stubRequest.headers["x-forwarded-port"]).toBe("8181");
    expect(stubRequest.headers["x-forwarded-proto"]).toBe("wss");
    expect(stubRequest.headers["x-forwarded-host"]).toBe("192.168.1.3:8181");
  });

  it("uses http for x-forwarded-proto when configured", () => {
    const stubRequest = {
      connection: {
        remoteAddress: "192.168.1.2",
        remotePort: "8080",
      },
      headers: {
        host: "192.168.1.2:8080",
      } as Record<string, string>,
    };
    // @ts-ignore
    XHeaders(stubRequest, {}, { xfwd: true, xfwdWsProtoAsHttp: true });
    expect(stubRequest.headers["x-forwarded-proto"]).toBe("http");
  });

  it("uses https for x-forwarded-proto on encrypted connections when configured", () => {
    const stubRequest = {
      socket: {
        remoteAddress: "192.168.1.3",
        remotePort: "8181",
      },
      connection: {
        pair: true,
      },
      headers: {
        host: "192.168.1.3:8181",
      } as Record<string, string>,
    };
    // @ts-ignore
    XHeaders(stubRequest, {}, { xfwd: true, xfwdWsProtoAsHttp: true });
    expect(stubRequest.headers["x-forwarded-proto"]).toBe("https");
  });

  it("preserves an existing x-forwarded-host header", () => {
    const stubRequest = {
      connection: {
        remoteAddress: "192.168.1.2",
        remotePort: "8080",
      },
      headers: {
        host: "origin.example:8080",
        "x-forwarded-host": "edge.example",
      } as Record<string, string>,
    };
    // @ts-ignore
    XHeaders(stubRequest, {}, { xfwd: true });
    expect(stubRequest.headers["x-forwarded-host"]).toBe("edge.example");
  });

  it("prefers :authority over host for x-forwarded-host", () => {
    const stubRequest = {
      connection: {
        remoteAddress: "192.168.1.2",
        remotePort: "8080",
      },
      headers: {
        ":authority": "http2.example:8443",
        host: "fallback.example:8080",
      } as Record<string, string>,
    };
    // @ts-ignore
    XHeaders(stubRequest, {}, { xfwd: true });
    expect(stubRequest.headers["x-forwarded-host"]).toBe("http2.example:8443");
  });
});
