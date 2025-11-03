import { Agent } from 'undici';
import {
  type ErrorCallback,
  ProxyServer,
  type ProxyTarget,
  type ProxyTargetUrl,
  type ServerOptions,
} from './http-proxy/index';
export {
  ProxyServer,
  type ServerOptions,
  type ProxyTarget,
  type ProxyTargetUrl,
  type ErrorCallback,
};
export { numOpenSockets } from './http-proxy/passes/ws-incoming';

import type * as http from 'node:http';

/**
 * Creates the proxy server.
 *
 * Examples:
 *
 *    httpProxy.createProxyServer({ .. }, 8000)
 *    // => '{ web: [Function], ws: [Function] ... }'
 *
 * @param {Object} Options Config object passed to the proxy
 *
 * @return {Object} Proxy Proxy object with handlers for `ws` and `web` requests
 *
 * @api public
 */

function createProxyServer<TIncomingMessage extends typeof http.IncomingMessage = typeof http.IncomingMessage, TServerResponse extends typeof http.ServerResponse = typeof http.ServerResponse, TError = Error>(options: ServerOptions = {}): ProxyServer<TIncomingMessage, TServerResponse, TError> {
  // Check if we're in forced undici mode
  if (process.env.FORCE_FETCH_PATH === 'true' && options.fetch === undefined) {
    options = { ...options, fetch: { dispatcher: new Agent({ allowH2: true, connect: { rejectUnauthorized: true } }) as any } };
  }

  return new ProxyServer<TIncomingMessage, TServerResponse, TError>(options);
}

export {
  createProxyServer,
  createProxyServer as createServer,
  createProxyServer as createProxy,
};

/**
 * Export the proxy "Server" as the main export.
 */
export default ProxyServer;
