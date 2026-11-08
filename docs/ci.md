# Continuous Integration

GitHub Actions runs [Node.js CI](../.github/workflows/test.yml) for pushes and pull requests targeting `master`. Its validation lanes start independently:

| Lane | Work |
|---|---|
| `checks` | Provenance and source-bound SBOM, dependency audit, changed-line whitespace, undefined-call scan, lint, critical types, release readiness and dependency/client checks |
| `unit-coverage` | One complete Mocha/c8 run with the existing global coverage thresholds; uploads `coverage` |
| `browser-boundaries` | The desktop boundary suite |
| `workstation (1/8)` through `workstation (8/8)` | All workstation PR smoke cases divided by Playwright's file-level sharding; one browser worker per runner |
| `workstation-results` | Merge all cohort blob reports and qualify the exact complete source-bound smoke catalog and every required capability |
| `mcp-smoke` | An independently owned localhost HTTPS server, MCP smoke and browser benchmarks |
| Native codec matrix | Existing Windows and Ubuntu protocol qualification |
| `lifecycle-engines` | Existing Chromium/Firefox/WebKit lifecycle and measured audio-profile qualification |
| `test` | Stable required check: succeeds only when every validation lane, matrix and report qualification succeeds |

Browser files retain their existing internal execution order. Neither browser worker count nor desktop viewport policy changes. Each cohort has a separate runner, server, browser process and artifact namespace. It collects the complete source-hash snapshot before execution and verifies that source again afterward, including when tests fail. A failed cohort does not cancel the other cohorts.

The report job runs after failed cohorts too, so the combined result retains failures and attachments. It recollects the current complete selection, merges Playwright blob reports into `.tmp/workstation-results.json`, then runs the existing `check-browser-results.js --smoke` gate. Missing, duplicate, skipped required cases, changed source or absent required capabilities still fail qualification. The final `test` check also requires the original matrix result, so successful report generation cannot hide a failed cohort.

Cohort blob artifacts are named `workstation-blob-N`; their source snapshots are retained separately as `workstation-source-N`. Re-running a failed cohort replaces only its blob artifact for that workflow run; successful cohort artifacts remain available to the merge. Failure traces use cohort and attempt names and are retained for seven days. The combined source selection, JSON report and qualification remain in `workstation-browser-receipts`.

The pre-split green run spent 51.1 minutes on 325 workstation smoke cases followed by 15 minutes of Node coverage (about 72 minutes overall). Dry collection of all eight shards selects the same 325 cases exactly once. Using those measured test durations, browser cohorts project 2.4–10.1 minutes of test time; the unchanged full Node coverage lane is expected to set the new critical path. Actual elapsed time also includes runner queueing, installation and report merging.

The existing local `npm run coverage`, `npm run test-e2e:workstation:smoke` and full workstation commands retain their behavior. The trusted, source-pinned maintenance/full workflow remains separate.

For one local browser cohort:

```sh
node scripts/run-browser-boundaries.js --project=workstation --grep @boundary --workers=1 --shard=1/8 --reporter=line,blob
```

After collecting all eight cohort blob ZIPs into one directory:

```sh
npm run check:browser-categories
npx playwright merge-reports --reporter=json .tmp/workstation-blobs
node scripts/check-browser-results.js --smoke
```

Set `PLAYWRIGHT_JSON_OUTPUT_NAME=.tmp/workstation-results.json` for the merge command, as the workflow does. Playwright's [sharding and blob-report documentation](https://playwright.dev/docs/test-sharding) describes the supported merge format. Certs, server logs, coverage and browser artifacts remain local or ignored unless uploaded explicitly.
