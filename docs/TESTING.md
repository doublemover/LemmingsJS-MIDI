# Testing

Run `npm test` to execute the project's automated tests. Dedicated scripts run
common subsets of the suite:

```bash
npm test                # runs all tests
npm run test-core       # core game logic
npm run test-bench      # bench-related unit/integration tests (Mocha only)
npm run test-bench-smoke # browser benchmark smoke gate (Playwright + E2E harness)
npm run bench-smoke     # fast benchmark smoke gate (short dev-loop default)
npm run bench-performance # standalone perf bench (smoke profile by default)
npm run bench-performance-smoke # explicit perf smoke profile
npm run bench-history   # history stress bench (smoke profile by default)
npm run bench-history-smoke # explicit history smoke profile
npm run bench-performance-soak # long perf soak run (explicit opt-in)
npm run bench-history-soak # long history soak run (explicit opt-in)
npm run test-workflow   # GitHub workflow helpers
npm run test-tools      # command line tools
npm run test-offline-tools # offline asset tooling
npm run test-editor     # editor-related tests
npm run coverage-editor # 100% coverage for editor modules
npm run test-mcp-smoke  # MCP stdio smoke test (requires start-https)
```
Categories map to the glob patterns defined in `scripts/runTests.js`.

Tests that require significant manual setup or large downloads are documented in
[`excluded-tests.md`](excluded-tests.md). They are skipped in continuous
integration.

The tests require no special environment variables. A minimal `lemmings` object
is created and temporary files are written under your operating system's temp
directory.

## Benchmark profiles

Benchmark scripts default to short smoke settings so local perf checks stay
within a quick dev-loop budget. Use explicit soak mode for long runs:

```bash
npm run bench-performance -- --soak
npm run bench-history -- --soak
npm run bench-smoke -- --soak
```

`test-bench` and `bench-*` intentionally have different semantics:

- `test-bench`: runs deterministic Mocha tests under `test/*bench*.test.js`.
- `bench-*`: runs live browser benchmarks (requires local HTTPS server and
  browser automation support).

## npm test workflow

Run `npm run check-undefined` manually before `npm test` to verify no uninitialized references remain in the build. GitHub Actions performs the same checks on **Node 20** during the CI job after running `npm run lint`.

To mirror the CI environment locally:

```bash
npm run lint
npm test
```
