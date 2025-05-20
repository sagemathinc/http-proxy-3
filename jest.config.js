module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFiles: ["./lib/test/setup.js"],
  testMatch: ["**/?(*.)+(spec|test).ts?(x)"],
};
