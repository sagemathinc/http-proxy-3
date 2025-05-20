# Testing Nodes

## Ports

A note about ports. These tests use a large number of ports and are run in
parallel. There will sometimes be failures sometimes due to a port conflict
between different tests being run at the same time.

Use `pnpm test --runInBand` to avoid this by running the tests in serial. This
is good for CI and release testing. Just use `pnpm test` for dev, since it's
much faster.

## Reverse Proxy test

There are a few unit tests that involve a reverse proxy of google.com. These will often fail due to Google rejecting these robotic requests, so they are not run unless you
set this environment variable:

```sh
TEST_EXTERNAL_REVERSE_PROXY=yes
```

I run these manually before making a release, but not as part of CI. Use 

```sh
pnpm test-all
```

to include these tests and also pnpm audit.

## fetch

We use

```
import fetch from "node-fetch";
```

in the unit tests instead of the fetch builtin to nodejs, since in node 18 the builtin fetch leaves an open handling hanging the test suite.

An exception is blacklist-headers.test.ts, where we can't even run the test using node-fetch, since it blocks it.

In particular, it is not acceptable for the test suite to exit with: _"A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them."_

## WARNINGS

These warnings in the test suite are expected, because we're testing ssl using self signed certs:

```
(node:52812) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections and HTTPS requests insecure by disabling certificate verification.
(Use `node --trace-warnings ...` to show where the warning was created)
```

