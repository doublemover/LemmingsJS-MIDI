# Continuous Integration

This project uses GitHub Actions to run tests on every push and pull request targeting the `master` branch.

The workflow is defined in [`.github/workflows/test.yml`](../.github/workflows/test.yml). Although the `package.json` requires Node 20 or newer, the workflow installs **Node 20**:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
```

After checking out the repository, each workflow refreshes the `tools/` folder
from `origin/master` so helper scripts are always up to date.

The CI job performs the following steps:

1. `npm install`
2. `npm run check-undefined`
3. `npm run lint`
4. `npm test`

All tests must pass before code is merged.

The repository also runs [`automerge-repo.yml`](../.github/workflows/automerge-repo.yml).
This job keeps `.repoMetrics/searchHistory` in sync with the history from
`master` whenever a pull request is opened or updated. It fetches the file from
`origin/master`, appends any missing lines and commits the change back to the PR
branch.

`automerge-repo.yml` performs a similar merge for `.repoMetrics/metrics.json`,
`.repoMetrics/usageCounts.json`, and `.agentInfo` files to reduce merge
conflicts.
