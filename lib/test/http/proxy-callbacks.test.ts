/*
Test the new onProxyReq and onProxyRes callbacks for undici code path

pnpm test proxy-callbacks.test.ts
*/

import * as http from "node:http";
import * as httpProxy from "../..";
import getPort from "../get-port";
import fetch from "node-fetch";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent } from "undici";


describe("Undici callback functions (onBeforeRequest and onAfterResponse)", () => {
    let ports: Record<'target' | 'proxy', number>;
    const servers: Record<string, any> = {};

    beforeAll(async () => {
        ports = { target: await getPort(), proxy: await getPort() };
    });

    afterAll(async () => {
        Object.values(servers).map((x) => x?.close());
    });

    it("Create the target HTTP server", async () => {
        servers.target = http
            .createServer((req, res) => {
                res.writeHead(200, {
                    "Content-Type": "text/plain",
                    "X-Target-Header": "from-target"
                });
                res.write(`Request received: ${req.method} ${req.url}\n`);
                res.write(`Headers: ${JSON.stringify(req.headers, null, 2)}\n`);
                res.end();
            })
            .listen(ports.target);
    });

    it("Test onBeforeRequest and onAfterResponse callbacks", async () => {
        let onBeforeRequestCalled = false;
        let onAfterResponseCalled = false;
        let capturedResponse: Response = {} as Response;

        const proxy = httpProxy.createServer({
            target: `http://localhost:${ports.target}`,
            fetch: {
                dispatcher: new Agent({
                    allowH2: true
                }) as any, // Enable undici code path
                onBeforeRequest: async (requestOptions, _req, _res, _options) => {
                    onBeforeRequestCalled = true;
                    // Modify the outgoing request
                    requestOptions.headers = {
                        ...requestOptions.headers,
                        'X-Proxy-Added': 'callback-added-header',
                        'X-Original-Method': _req.method || 'unknown'
                    };
                },
                onAfterResponse: async (response, _req, _res, _options) => {
                    onAfterResponseCalled = true;
                    capturedResponse = response;
                    console.log(`Response received: ${response.status}`);
                }
            }
        }); servers.proxy = proxy.listen(ports.proxy);

        // Make a request through the proxy
        const response = await fetch(`http://localhost:${ports.proxy}/test`);
        const text = await response.text();

        // Check that the response is successful
        expect(response.status).toBe(200);
        expect(text).toContain("Request received: GET /test");

        // Check that our added header made it to the target
        expect(text).toContain("x-proxy-added");
        expect(text).toContain("callback-added-header");

        // Check that callbacks were called
        expect(onBeforeRequestCalled).toBe(true);
        expect(onAfterResponseCalled).toBe(true);

        // Check that we received the full response object
        expect(capturedResponse).toHaveProperty('status');
        expect((capturedResponse).status).toBe(200);
        expect(capturedResponse).toHaveProperty('headers');
        expect((capturedResponse).headers.get('x-target-header')).toBe('from-target');
    });
});