# Continuous Integration

This project uses GitHub Actions to run tests on every push and pull request targeting the `master` branch.

The workflow is defined in [`.github/workflows/test.yml`](../.github/workflows/test.yml). Although the `package.json` requires Node 16 or newer, the workflow installs **Node 18**:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 18
```

The CI job performs the following steps:

1. `npm install`
2. `npm run lint`
3. `npm test`

All tests must pass before code is merged.
