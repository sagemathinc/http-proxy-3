/*
pnpm test ./http-proxy-common.test.ts
*/

import {
  setupOutgoing as setupOutgoing0,
  setupSocket,
} from "../../http-proxy/common";
import net from 'net';

// wrap setupOutgoing so types aren't checked, since a lot of the tests here
// involve partial objects that typescript doesn't view as correct, e.g., {url:'foo...'}
// for a Request.
function setupOutgoing(...args: any[]) {
  setupOutgoing0(args[0], args[1], args[2], args[3]);
}

describe("#setupOutgoing", () => {
  it("should setup the correct headers", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        agent: "?",
        target: {
          host: "hey",
          hostname: "how",
          socketPath: "are",
          port: 3000,
        },
        headers: { fizz: "bang", overwritten: true },
        localAddress: "local.address",
        auth: "username:pass",
      },
      {
        method: "i",
        url: "/am",
        headers: { pro: "xy", overwritten: false },
      },
    );

    expect(outgoing.host).toEqual("hey");
    expect(outgoing.hostname).toEqual("how");
    expect(outgoing.socketPath).toEqual("are");
    expect(outgoing.port).toEqual(3000);
    expect(outgoing.agent).toEqual("?");

    expect(outgoing.method).toEqual("i");
    // I think this was wrong in node-http-proxy (where it was 'am'), since hte url path must
    // always start with a /
    // https://stackoverflow.com/questions/27638278/do-http-paths-have-to-start-with-a-slash
    // I noticed this since we're using new URL instead of
    // the deprecated insecure "require('url').parse".
    expect(outgoing.path).toEqual("/am");

    expect(outgoing.headers.pro).toEqual("xy");
    expect(outgoing.headers.fizz).toEqual("bang");
    expect(outgoing.headers.overwritten).toEqual(true);
    expect(outgoing.localAddress).toEqual("local.address");
    expect(outgoing.auth).toEqual("username:pass");
  });

  it("should not override agentless upgrade header", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        agent: undefined,
        target: {
          host: "hey",
          hostname: "how",
          socketPath: "are",
          port: "you",
        },
        headers: { connection: "upgrade" },
      },
      {
        method: "i",
        url: "/am",
        headers: { pro: "xy", overwritten: false },
      },
    );
    expect(outgoing.headers.connection).toEqual("upgrade");
  });

  it("should not override agentless connection: contains upgrade", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        agent: undefined,
        target: {
          host: "hey",
          hostname: "how",
          socketPath: "are",
          port: "you",
        },
        headers: { connection: "keep-alive, upgrade" }, // this is what Firefox sets
      },
      {
        method: "i",
        url: "/am",
        headers: { pro: "xy", overwritten: false },
      },
    );
    expect(outgoing.headers.connection).toEqual("keep-alive, upgrade");
  });

  it("should override agentless connection: contains improper upgrade", () => {
    // sanity check on upgrade regex
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        agent: undefined,
        target: {
          host: "hey",
          hostname: "how",
          socketPath: "are",
          port: "you",
        },
        headers: { connection: "keep-alive, not upgrade" },
      },
      {
        method: "i",
        url: "/am",
        headers: { pro: "xy", overwritten: false },
      },
    );
    expect(outgoing.headers.connection).toEqual("close");
  });

  it("should override agentless non-upgrade header to close", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        agent: undefined,
        target: {
          host: "hey",
          hostname: "how",
          socketPath: "are",
          port: "you",
        },
        headers: { connection: "xyz" },
      },
      {
        method: "i",
        url: "/am",
        headers: { pro: "xy", overwritten: false },
      },
    );
    expect(outgoing.headers.connection).toEqual("close");
  });

  it("should set the agent to false if none is given", () => {
    const outgoing: any = {};
    setupOutgoing(outgoing, { target: new URL("http://localhost") }, { url: "/" });
    expect(outgoing.agent).toEqual(false);
  });

  it("set the port according to the protocol", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        agent: "?",
        target: {
          host: "how",
          hostname: "are",
          socketPath: "you",
          protocol: "https:",
        },
      },
      {
        method: "i",
        url: "/am",
        headers: { pro: "xy" },
      },
    );

    expect(outgoing.host).toEqual("how");
    expect(outgoing.hostname).toEqual("are");
    expect(outgoing.socketPath).toEqual("you");
    expect(outgoing.agent).toEqual("?");

    expect(outgoing.method).toEqual("i");
    expect(outgoing.path).toEqual("/am");
    expect(outgoing.headers.pro).toEqual("xy");

    expect(outgoing.port).toEqual(443);
  });

  it("should keep the original target path in the outgoing path", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      { target: { pathname: "/some-path" } },
      { url: "/am" },
    );

    expect(outgoing.path).toEqual("/some-path/am");
  });

  it("should keep the original forward path in the outgoing path", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        target: {},
        forward: {
          pathname: "some-path",
        },
      },
      {
        url: "/am",
      },
      "forward",
    );

    expect(outgoing.path).toEqual("/some-path/am");
  });

  it("should properly detect https/wss protocol without the colon", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        target: {
          protocol: "https",
          host: "whatever.com",
        },
      },
      { url: "/" },
    );

    expect(outgoing.port).toEqual(443);
  });

  it("should not prepend the target path to the outgoing path with prependPath = false", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        target: { pathname: "hellothere" },
        prependPath: false,
      },
      { url: "/hi" },
    );

    expect(outgoing.path).toEqual("/hi");
  });

  it("should properly join paths", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        target: { pathname: "/forward" },
      },
      { url: "/static/path" },
    );

    expect(outgoing.path).toEqual("/forward/static/path");
  });

  it("should not modify the query string", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        target: { pathname: "/forward" },
      },
      { url: "/?foo=bar//&target=http://foobar.com/?a=1%26b=2&other=2" },
    );

    expect(outgoing.path).toEqual(
      "/forward/?foo=bar//&target=http://foobar.com/?a=1%26b=2&other=2",
    );
  });

  it("target path has query string", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        target: { pathname: "/forward?f=1" },
      },
      { url: "/src?s=1" },
    );

    expect(outgoing.path).toEqual("/forward/src?f=1&s=1");
  });

  //
  // This is the proper failing test case for the common.join problem
  //
  it("should correctly format the toProxy URL", () => {
    const outgoing: any = {};
    const google = "https://google.com";
    setupOutgoing(
      outgoing,
      {
        target: new URL("http://sometarget.com:80", "http://dummy.org"),
        toProxy: true,
      },
      { url: google },
    );

    expect(outgoing.path).toEqual("/" + google);
  });

  it("should not replace : to :\\ when no https word before", () => {
    const outgoing: any = {};
    const google = "https://google.com:/join/join.js";
    setupOutgoing(
      outgoing,
      {
        target: new URL("http://sometarget.com:80", "http://dummy.org"),
        toProxy: true,
      },
      { url: google },
    );

    expect(outgoing.path).toEqual("/" + google);
  });

  it("should not replace : to :\\ when no http word before", () => {
    const outgoing: any = {};
    const google = "http://google.com:/join/join.js";
    setupOutgoing(
      outgoing,
      {
        target: new URL("http://sometarget.com:80", "http://dummy.org"),
        toProxy: true,
      },
      { url: google },
    );

    expect(outgoing.path).toEqual("/" + google);
  });

  describe("when using ignorePath", () => {
    it("should ignore the path of the `req.url` passed in but use the target path", () => {
      const outgoing: any = {};
      const myEndpoint = "https://whatever.com/some/crazy/path/whoooo";
      setupOutgoing(
        outgoing,
        {
          target: new URL(myEndpoint, "http://dummy.org"),
          ignorePath: true,
        },
        { url: "/more/crazy/pathness" },
      );

      expect(outgoing.path).toEqual("/some/crazy/path/whoooo");
    });

    it("and prependPath: false, it should ignore path of target and incoming request", () => {
      const outgoing: any = {};
      const myEndpoint = "https://whatever.com/some/crazy/path/whoooo";
      setupOutgoing(
        outgoing,
        {
          target: new URL(myEndpoint, "http://dummy.org"),
          ignorePath: true,
          prependPath: false,
        },
        { url: "/more/crazy/pathness" },
      );

      expect(outgoing.path).toEqual("/");
    });
  });

  describe("when using changeOrigin", () => {
    it("should correctly set the port to the host when it is a non-standard port using new URL", () => {
      const outgoing: any = {};
      const myEndpoint = "https://myCouch.com:6984";
      setupOutgoing(
        outgoing,
        {
          target: new URL(myEndpoint, "http://dummy.org"),
          changeOrigin: true,
        },
        { url: "/" },
      );

      expect(outgoing.headers.host).toEqual("mycouch.com:6984");
    });

    it("should correctly set the port to the host when it is a non-standard port when setting host and port manually (which ignores port)", () => {
      const outgoing: any = {};
      setupOutgoing(
        outgoing,
        {
          target: {
            protocol: "https:",
            host: "mycouch.com",
            port: 6984,
          },
          changeOrigin: true,
        },
        { url: "/" },
      );
      expect(outgoing.headers.host).toEqual("mycouch.com:6984");
    });
  });

  it("should pass through https client parameters", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        agent: "?",
        target: {
          host: "how",
          hostname: "are",
          socketPath: "you",
          protocol: "https:",
          pfx: "my-pfx",
          key: "my-key",
          passphrase: "my-passphrase",
          cert: "my-cert",
          ca: "my-ca",
          ciphers: "my-ciphers",
          secureProtocol: "my-secure-protocol",
        },
      },
      {
        method: "i",
        url: "/am",
      },
    );

    expect(outgoing.pfx).toEqual("my-pfx");
    expect(outgoing.key).toEqual("my-key");
    expect(outgoing.passphrase).toEqual("my-passphrase");
    expect(outgoing.cert).toEqual("my-cert");
    expect(outgoing.ca).toEqual("my-ca");
    expect(outgoing.ciphers).toEqual("my-ciphers");
    expect(outgoing.secureProtocol).toEqual("my-secure-protocol");
  });

  it("should handle overriding the `method` of the http request", () => {
    const outgoing: any = {};
    setupOutgoing(
      outgoing,
      {
        target: new URL("https://whooooo.com", "http://dummy.org"),
        method: "POST",
      },
      { method: "GET", url: "" },
    );

    expect(outgoing.method).toEqual("POST");
  });

  it("should not pass null as last arg to #urlJoin", () => {
    const outgoing: any = {};
    setupOutgoing(outgoing, { target: { pathname: "" } }, { url: "" });

    expect(outgoing.path).toEqual("/");
  });
});

describe("#setupSocket", () => {
  it("should setup a socket", () => {
    const socketConfig = {
        timeout: null as null | number,
        nodelay: false as boolean | undefined,
        keepalive: false as boolean | undefined,
      },
      stubSocket = {
        setTimeout: (num: number) => {
          socketConfig.timeout = num;
          return stubSocket;
        },
        setNoDelay: (bol: boolean) => {
          socketConfig.nodelay = bol;
          return stubSocket;
        },
        setKeepAlive: (bol: boolean) => {
          socketConfig.keepalive = bol;
          return stubSocket;
        },
      } satisfies Pick<net.Socket, 'setTimeout' | 'setNoDelay' | 'setKeepAlive'> as net.Socket;
    setupSocket(stubSocket);
    expect(socketConfig.timeout).toEqual(0);
    expect(socketConfig.nodelay).toEqual(true);
    expect(socketConfig.keepalive).toEqual(true);
  });
});
