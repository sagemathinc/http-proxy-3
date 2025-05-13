import {
  removeChunked,
  setRedirectHostRewrite,
  setConnection,
  writeStatusCode,
  writeHeaders,
} from "../../dist/lib/http-proxy/passes/web-outgoing";
import * as url from "url";

const state: any = { headers: {} };

// NOTE: here url.parse("http://backend.com") uses the deprecated url.parse
// function, and we're testing that we still support it.
for (const target of ["http://backend.com", url.parse("http://backend.com")]) {
  describe("#setRedirectHostRewrite", () => {
    beforeEach(() => {
      state.req = {
        headers: {
          host: "ext-auto.com",
        },
      };
      state.proxyRes = {
        statusCode: 301,
        headers: {
          location: "http://backend.com/",
        },
      };
      state.options = {
        target,
      };
    });

    describe("rewrites location host with hostRewrite", () => {
      beforeEach(() => {
        state.options.hostRewrite = "ext-manual.com";
      });
      [201, 301, 302, 307, 308].forEach(function (code) {
        it("on " + code, () => {
          state.proxyRes.statusCode = code;
          setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
          expect(state.proxyRes.headers.location).toEqual(
            "http://ext-manual.com/",
          );
        });
      });

      it("not on 200", () => {
        state.proxyRes.statusCode = 200;
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual("http://backend.com/");
      });

      it("not when hostRewrite is unset", () => {
        delete state.options.hostRewrite;
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual("http://backend.com/");
      });

      it("takes precedence over autoRewrite", () => {
        state.options.autoRewrite = true;
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual(
          "http://ext-manual.com/",
        );
      });

      it("not when the redirected location does not match target host", () => {
        state.proxyRes.statusCode = 302;
        state.proxyRes.headers.location = "http://some-other/";
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual("http://some-other/");
      });

      it("not when the redirected location does not match target port", () => {
        state.proxyRes.statusCode = 302;
        state.proxyRes.headers.location = "http://backend.com:8080/";
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual(
          "http://backend.com:8080/",
        );
      });
    });

    describe("rewrites location host with autoRewrite", () => {
      beforeEach(() => {
        state.options.autoRewrite = true;
      });
      [201, 301, 302, 307, 308].forEach(function (code) {
        it("on " + code, () => {
          state.proxyRes.statusCode = code;
          setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
          expect(state.proxyRes.headers.location).toEqual(
            "http://ext-auto.com/",
          );
        });
      });

      it("not on 200", () => {
        state.proxyRes.statusCode = 200;
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual("http://backend.com/");
      });

      it("not when autoRewrite is unset", () => {
        delete state.options.autoRewrite;
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual("http://backend.com/");
      });

      it("not when the redirected location does not match target host", () => {
        state.proxyRes.statusCode = 302;
        state.proxyRes.headers.location = "http://some-other/";
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual("http://some-other/");
      });

      it("not when the redirected location does not match target port", () => {
        state.proxyRes.statusCode = 302;
        state.proxyRes.headers.location = "http://backend.com:8080/";
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual(
          "http://backend.com:8080/",
        );
      });
    });

    describe("rewrites location protocol with protocolRewrite", () => {
      beforeEach(() => {
        state.options.protocolRewrite = "https";
      });
      [201, 301, 302, 307, 308].forEach(function (code) {
        it("on " + code, () => {
          state.proxyRes.statusCode = code;
          setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
          expect(state.proxyRes.headers.location).toEqual(
            "https://backend.com/",
          );
        });
      });

      it("not on 200", () => {
        state.proxyRes.statusCode = 200;
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual("http://backend.com/");
      });

      it("not when protocolRewrite is unset", () => {
        delete state.options.protocolRewrite;
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual("http://backend.com/");
      });

      it("works together with hostRewrite", () => {
        state.options.hostRewrite = "ext-manual.com";
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual(
          "https://ext-manual.com/",
        );
      });

      it("works together with autoRewrite", () => {
        state.options.autoRewrite = true;
        setRedirectHostRewrite(state.req, {}, state.proxyRes, state.options);
        expect(state.proxyRes.headers.location).toEqual(
          "https://ext-auto.com/",
        );
      });
    });
  });
}

describe("#setConnection", () => {
  it("set the right connection with 1.0 - `close`", () => {
    const proxyRes = { headers: {} };
    setConnection(
      {
        httpVersion: "1.0",
        headers: {
          connection: null,
        },
      },
      {},
      proxyRes,
    );

    expect(proxyRes.headers["connection"]).toEqual("close");
  });

  it("set the right connection with 1.0 - req.connection", () => {
    const proxyRes = { headers: {} };
    setConnection(
      {
        httpVersion: "1.0",
        headers: {
          connection: "hey",
        },
      },
      {},
      proxyRes,
    );

    expect(proxyRes.headers["connection"]).toEqual("hey");
  });

  it("set the right connection - req.connection", () => {
    const proxyRes = { headers: {} };
    setConnection(
      {
        httpVersion: null,
        headers: {
          connection: "hola",
        },
      },
      {},
      proxyRes,
    );

    expect(proxyRes.headers["connection"]).toEqual("hola");
  });

  it("set the right connection - `keep-alive`", () => {
    const proxyRes = { headers: {} };
    setConnection(
      {
        httpVersion: null,
        headers: {
          connection: null,
        },
      },
      {},
      proxyRes,
    );

    expect(proxyRes.headers["connection"]).toEqual("keep-alive");
  });

  it("don`t set connection with 2.0 if exist", () => {
    const proxyRes = { headers: {} };
    setConnection(
      {
        httpVersion: "2.0",
        headers: {
          connection: "namstey",
        },
      },
      {},
      proxyRes,
    );

    expect(proxyRes.headers["connection"]).toEqual(undefined);
  });

  it("don`t set connection with 2.0 if doesn`t exist", () => {
    const proxyRes = { headers: {} };
    setConnection(
      {
        httpVersion: "2.0",
        headers: {},
      },
      {},
      proxyRes,
    );

    expect(proxyRes.headers["connection"]).toEqual(undefined);
  });
});

describe("#writeStatusCode", () => {
  it("should write status code", () => {
    const res = {
      writeHead: function (n) {
        expect(n).toEqual(200);
      },
    };

    writeStatusCode({}, res, { statusCode: 200 });
  });
});

describe("#writeHeaders", () => {
  beforeEach(() => {
    state.proxyRes = {
      headers: {
        hey: "hello",
        how: "are you?",
        "set-cookie": [
          "hello; domain=my.domain; path=/",
          "there; domain=my.domain; path=/",
        ],
      },
    };
    state.rawProxyRes = {
      headers: {
        hey: "hello",
        how: "are you?",
        "set-cookie": [
          "hello; domain=my.domain; path=/",
          "there; domain=my.domain; path=/",
        ],
      },
      rawHeaders: [
        "Hey",
        "hello",
        "How",
        "are you?",
        "Set-Cookie",
        "hello; domain=my.domain; path=/",
        "Set-Cookie",
        "there; domain=my.domain; path=/",
      ],
    };
    state.res = {
      setHeader: (k, v) => {
        // https://nodejs.org/api/http.html#http_message_headers
        // Header names are lower-cased
        state.res.headers[k.toLowerCase()] = v;
      },
      headers: {},
    };
  });

  it("writes headers", () => {
    const options = {};
    writeHeaders({}, state.res, state.proxyRes, options);

    expect(state.res.headers.hey).toEqual("hello");
    expect(state.res.headers.how).toEqual("are you?");

    expect(state.res.headers).toHaveProperty("set-cookie");
    expect(state.res.headers["set-cookie"]).toBeInstanceOf(Array);
    expect(state.res.headers["set-cookie"].length).toEqual(2);
  });

  it("writes raw headers", () => {
    const options = {};
    writeHeaders({}, state.res, state.rawProxyRes, options);

    expect(state.res.headers.hey).toEqual("hello");
    expect(state.res.headers.how).toEqual("are you?");

    expect(state.res.headers).toHaveProperty("set-cookie");
    expect(state.res.headers["set-cookie"]).toBeInstanceOf(Array);
    expect(state.res.headers["set-cookie"].length).toEqual(2);
  });

  it("rewrites path", () => {
    const options = {
      cookiePathRewrite: "/dummyPath",
    };

    writeHeaders({}, state.res, state.proxyRes, options);

    expect(state.res.headers["set-cookie"]).toContain(
      "hello; domain=my.domain; path=/dummyPath",
    );
  });

  it("does not rewrite path", () => {
    const options = {};

    writeHeaders({}, state.res, state.proxyRes, options);

    expect(state.res.headers["set-cookie"]).toContain(
      "hello; domain=my.domain; path=/",
    );
  });

  it("removes path", () => {
    const options = {
      cookiePathRewrite: "",
    };

    writeHeaders({}, state.res, state.proxyRes, options);

    expect(state.res.headers["set-cookie"]).toContain(
      "hello; domain=my.domain",
    );
  });

  it("does not rewrite domain", () => {
    const options = {};

    writeHeaders({}, state.res, state.proxyRes, options);

    expect(state.res.headers["set-cookie"]).toContain(
      "hello; domain=my.domain; path=/",
    );
  });

  it("rewrites domain", () => {
    const options = {
      cookieDomainRewrite: "my.new.domain",
    };

    writeHeaders({}, state.res, state.proxyRes, options);

    expect(state.res.headers["set-cookie"]).toContain(
      "hello; domain=my.new.domain; path=/",
    );
  });

  it("removes domain", () => {
    const options = {
      cookieDomainRewrite: "",
    };

    writeHeaders({}, state.res, state.proxyRes, options);

    expect(state.res.headers["set-cookie"]).toContain("hello; path=/");
  });

  it("rewrites headers with advanced configuration", () => {
    const options = {
      cookieDomainRewrite: {
        "*": "",
        "my.old.domain": "my.new.domain",
        "my.special.domain": "my.special.domain",
      },
    };
    state.proxyRes.headers["set-cookie"] = [
      "hello-on-my.domain; domain=my.domain; path=/",
      "hello-on-my.old.domain; domain=my.old.domain; path=/",
      "hello-on-my.special.domain; domain=my.special.domain; path=/",
    ];
    writeHeaders({}, state.res, state.proxyRes, options);

    expect(state.res.headers["set-cookie"]).toContain(
      "hello-on-my.domain; path=/",
    );
    expect(state.res.headers["set-cookie"]).toContain(
      "hello-on-my.old.domain; domain=my.new.domain; path=/",
    );
    expect(state.res.headers["set-cookie"]).toContain(
      "hello-on-my.special.domain; domain=my.special.domain; path=/",
    );
  });

  it("rewrites raw headers with advanced configuration", () => {
    const options = {
      cookieDomainRewrite: {
        "*": "",
        "my.old.domain": "my.new.domain",
        "my.special.domain": "my.special.domain",
      },
    };
    state.rawProxyRes.headers["set-cookie"] = [
      "hello-on-my.domain; domain=my.domain; path=/",
      "hello-on-my.old.domain; domain=my.old.domain; path=/",
      "hello-on-my.special.domain; domain=my.special.domain; path=/",
    ];
    state.rawProxyRes.rawHeaders = state.rawProxyRes.rawHeaders.concat([
      "Set-Cookie",
      "hello-on-my.domain; domain=my.domain; path=/",
      "Set-Cookie",
      "hello-on-my.old.domain; domain=my.old.domain; path=/",
      "Set-Cookie",
      "hello-on-my.special.domain; domain=my.special.domain; path=/",
    ]);
    writeHeaders({}, state.res, state.rawProxyRes, options);

    expect(state.res.headers["set-cookie"]).toContain(
      "hello-on-my.domain; path=/",
    );
    expect(state.res.headers["set-cookie"]).toContain(
      "hello-on-my.old.domain; domain=my.new.domain; path=/",
    );
    expect(state.res.headers["set-cookie"]).toContain(
      "hello-on-my.special.domain; domain=my.special.domain; path=/",
    );
  });
});

describe("#removeChunked", () => {
  const proxyRes = {
    headers: {
      "transfer-encoding": "hello",
    },
  };

  removeChunked({ httpVersion: "1.0" }, {}, proxyRes);

  expect(proxyRes.headers["transfer-encoding"]).toEqual(undefined);
});
