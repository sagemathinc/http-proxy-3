// test/setup.js

// so we can test https using our self-signed example cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

// Global test configuration for undici code path
// When FORCE_UNDICI_PATH=true, all proxy servers will use undici by default
// if (process.env.FORCE_FETCH_PATH
//  === "true") {
//   const { Agent, setGlobalDispatcher } = await import("undici");
//   // Enable HTTP/2 for all fetch operations
//   setGlobalDispatcher(new Agent({ allowH2: true }));
// }
