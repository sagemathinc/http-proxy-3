module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFiles: ["./test/setup.js"],
  testMatch: ["**/?(*.)+(spec|test).ts?(x)"],
};
