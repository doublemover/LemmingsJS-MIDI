# Mocha test categories

tags: tests, doc

`npm test` accepts optional category names to limit which suites run.

- **core** – game engine and core utilities
- **tools** – scripts in the `tools/` directory
- **io** – file providers and filesystem helpers

Combine categories to run multiple groups:
`npm test tools io`
