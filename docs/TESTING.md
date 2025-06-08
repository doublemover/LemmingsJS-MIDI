# Testing

Run `npm test` to execute the project's automated tests. Dedicated scripts run
common subsets of the suite:

```bash
npm test                # runs all tests
npm run test-core       # core game logic
npm run test-bench      # performance benchmarks
npm run test-workflow   # GitHub workflow helpers
npm run test-tools      # command line tools
```

Categories are described in `.agentInfo/notes/test-categories.md`.

The tests require no special environment variables. A minimal `lemmings` object
is created and temporary files are written under your operating system's temp
directory.

## npm test workflow

Run `npm run check-undefined` manually before `npm test` to verify no uninitialized references remain in the build. GitHub Actions performs the same checks on **Node 20** during the CI job after running `npm run lint`.

To mirror the CI environment locally:

```bash
npm run lint
npm test
```
