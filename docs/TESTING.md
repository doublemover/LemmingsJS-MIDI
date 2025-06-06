# Testing

Run `npm test` to execute the project's automated tests:

```bash
npm test
```

The command uses Mocha and is launched with Node's `--import` option so that `js/LogHandler.js` is loaded before the test runner. No special environment variables are needed. The suite creates a minimal `lemmings` object and writes temporary files under your operating system's temp directory.

## npm test workflow

Run `npm run check-undefined` manually before `npm test` to verify no uninitialized references remain in the build. GitHub Actions performs the same checks on **Node 20** during the CI job after running `npm run lint`.

To mirror the CI environment locally:

```bash
npm run lint
npm test
```
