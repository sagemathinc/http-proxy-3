A note about ports. These tests use a large number of ports and are run in
parallel. There will sometimes be failures sometimes due to a port conflict
between different tests being run at the same time.

Use `pnpm test --runInBand` to avoid this by running the tests in serial. This
is good for CI and release testing. Just use `pnpm test` for dev, since it's
much faster.

Another issue is that sometimes tests that proxy google.com will get rejected by Google due to anti-abuse by them. If you set the environment variable GITHUB_ACTIONS then those tests are not run.
