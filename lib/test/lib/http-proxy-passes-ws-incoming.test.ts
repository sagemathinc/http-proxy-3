/*
pnpm test ./http-proxy-passes-ws-incoming.test.ts
*/

import {
  checkMethodAndHeader as checkMethodAndHeader0,
  XHeaders,
} from "../../http-proxy/passes/ws-incoming";

// disable typescript for this function
function checkMethodAndHeader(...args) {
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
      },
    };
    // @ts-ignore
    XHeaders(stubRequest, {}, { xfwd: true });
    expect(stubRequest.headers["x-forwarded-for"]).toBe("192.168.1.2");
    expect(stubRequest.headers["x-forwarded-port"]).toBe("8080");
    expect(stubRequest.headers["x-forwarded-proto"]).toBe("ws");
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
      },
    };
    // @ts-ignore
    XHeaders(stubRequest, {}, { xfwd: true });
    expect(stubRequest.headers["x-forwarded-for"]).toBe("192.168.1.3");
    expect(stubRequest.headers["x-forwarded-port"]).toBe("8181");
    expect(stubRequest.headers["x-forwarded-proto"]).toBe("wss");
  });
});
