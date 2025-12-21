# Continuous Integration

This project uses GitHub Actions to run tests on every push and pull request targeting the `master` branch.

The workflow is defined in [`.github/workflows/test.yml`](../.github/workflows/test.yml). Although the `package.json` requires Node 20 or newer, the workflow installs **Node 20**:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
```

The CI job performs the following steps:

1. `npm ci`
2. `npm run format`
3. `git diff --exit-code`
4. `npm run check-undefined`
5. `npm run lint`
6. `npm run depcheck`
7. `npm test`
8. `npm run coverage`

All tests must pass before code is merged.
