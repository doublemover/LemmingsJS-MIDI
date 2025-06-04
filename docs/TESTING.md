# Testing

Run `npm test` to execute the project's automated tests:

```bash
npm test
```

The command uses Mocha and is launched with Node's `--import` option so that `js/LogHandler.js` is loaded before the test runner. No special environment variables are needed. The suite creates a minimal `lemmings` object and writes temporary files under your operating system's temp directory.
