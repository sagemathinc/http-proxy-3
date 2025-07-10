import {
  ProxyServer,
  type ServerOptions,
  type ProxyTarget,
  type ProxyTargetUrl,
  type ErrorCallback,
} from './http-proxy/index';
export {
  ProxyServer,
  type ServerOptions,
  type ProxyTarget,
  type ProxyTargetUrl,
  type ErrorCallback,
};
export { numOpenSockets } from './http-proxy/passes/ws-incoming';

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

function createProxyServer(options: ServerOptions = {}): ProxyServer {
  return new ProxyServer(options);
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
