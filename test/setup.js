// test/setup.js

// checked for in some code to behave differently while running unit tests.
process.env.TEST_MODE = true;

// so we can test https using our self-signed example cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
