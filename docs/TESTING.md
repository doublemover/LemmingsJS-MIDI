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
npm run bench-long-session # long-session benchmark gate (smoke profile by default)
npm run bench-long-session-smoke # explicit long-session smoke profile
npm run bench-performance-soak # long perf soak run (explicit opt-in)
npm run bench-history-soak # long history soak run (explicit opt-in)
npm run bench-long-session-soak # long replay/memory/event-queue soak run
npm run test-workflow   # GitHub workflow helpers
npm run test-tools      # command line tools
npm run test-offline-tools # offline asset tooling
npm run test-editor     # editor-related tests
npm run test:changed    # infer the smallest safe Mocha subset from git changes
npm run coverage-editor # 100% coverage for editor modules
npm run test-mcp-smoke  # MCP stdio smoke test (requires start-https)
npm run typecheck:critical # targeted checkJs guard for runtime-critical modules
npm run release-readiness # release checklist gate (strict by default)
```
Categories map to the glob patterns defined in `scripts/runTests.js`.
`npm run test:changed` resolves its comparison base in this order: explicit
`--base=<ref>`, current branch upstream, `origin/HEAD`, then known default
branch names. Add `--print-selection` (or `--dry-run`) to print the resolved
base ref, changed files, inferred categories, and Mocha args without running
guards or tests.
The maintained subset scripts (`test-core`, `test-bench-unit`,
`test-workflow`, `test-tools`, `test-offline-tools`, and `test-editor`) all go
through `scripts/runTests.js`, so they share the same runtime-global guard,
critical typecheck guard, and runtime budget reporting as `npm test`.

Tests that require significant manual setup or large downloads belong in
[`excluded-tests.md`](excluded-tests.md). No tests are currently excluded.

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

`bench-history` is the replay-invariant guardrail for compression/rewind work:

- It runs random seek/replay probes and fails on replay-hash divergence
  (`HISTORY_REQUIRE_REPLAY_PARITY`, defaults to `true`).
- It fails when bounded history retention is not enabled
  (`HISTORY_REQUIRE_BOUNDED_RETENTION`, defaults to `true`).
- Non-smoke profiles also require cold compaction activity
  (`HISTORY_REQUIRE_COLD_COMPACTION`, defaults to `true` for `default`/`soak`).

`bench-hotpaths` now reports percentile and allocation diagnostics per section:

- `avgMs`, `p50Ms`, `p95Ms`, `p99Ms`, `worstMs`
- `allocBytesAvg`, `allocBytesP95`, `allocBytesWorst`

For render experiments, use canonical query flags in non-default runs and keep
rollback ready:

- `offscreenPresent=true`: requests the Canvas2D staging plus `drawImage`
  present-path experiment when supported.
- `workerOffscreen=true`: requests worker/offscreen path; runtime falls back
  automatically when unsupported.

Runtime diagnostics now expose capability matrix and rollout-flag snapshots
through `window.__E2E__.getDiagnostics()` / `window.__E2E__.getState()`:

- `capabilities.webMidi`, `capabilities.offscreenCanvas`,
  `capabilities.imageBitmap`, `capabilities.worker`.
- `capabilities.renderPaths` for deterministic fallback selection. Diagnostics
  use `presentPathSupported`/`drawimage_present`.
- `rolloutFlags` for staged rollout / emergency rollback state.

Rollout and rollback query toggles:

- `rollbackAll=1`: disables all high-risk rollout flags.
- `rollbackRenderPresent=1`: disables offscreen/worker present-path experiments.
- `rollbackHistoryCodec=1`: disables cold history compression/dedupe.

`bench-long-session` enforces thresholds for:

- replay-hash integrity
- heap growth and heap churn proxies
- sound-event queue ratio and queue-growth bounds
- history span growth and trigger-count drift

Release gates are defined in [`release-readiness.md`](release-readiness.md) and
validated by `npm run release-readiness`. Override strictness via
`LEMMINGS_RELEASE_READINESS_STRICT=false` when validating checklist structure
without requiring all items checked.

## Runtime profiles

Runtime boot/query presets use these profile IDs:

- `classic`
- `midi`
- `editor`
- `e2e`
- `perf`

Legacy `profile=gameplay` links are normalized to `classic`.

## Analytics controls

Privacy-first analytics is opt-in and local-only by default. See
[`analytics.md`](analytics.md) for consent defaults, event schema constraints,
local buffer export/import, optional managed beacon settings, and hard/runtime
kill switches.

## npm test workflow

Run `npm run check-undefined` before `npm test` to catch low-cost JS hygiene
regressions early. GitHub Actions also runs `git diff --check` against the
changed lines after `npm run format` to catch trailing-whitespace and EOF
blank-line issues without a custom baseline.

`npm test` now reports total runtime and supports optional guardrails for local
suite budgets:

- `LEMMINGS_TEST_ENFORCE_BUDGET=true`: fail when runtime budget is exceeded.
- `LEMMINGS_TEST_BUDGET_MS=<ms>`: override the default 180000ms budget.
- `npm run test:budget`: convenience wrapper with enforcement enabled.

To cover the main CI static/test gates locally:

```bash
npm run lint
git diff --check origin/master...HEAD
npm run check-undefined
npm test
```

## Playwright base URL overrides

Playwright defaults to `https://localhost:8080`. Override the origin with
`LEMMINGS_E2E_BASE_URL` when validating another same-machine or LAN URL:

```powershell
npm run test-e2e -- e2e/service-worker.spec.js
$env:LEMMINGS_E2E_BASE_URL = "https://127.0.0.1:8080"
npm run test-e2e -- e2e/service-worker.spec.js
Remove-Item Env:\LEMMINGS_E2E_BASE_URL
```

The service-worker smoke asserts same-origin scope instead of literal localhost,
so the same spec should pass for localhost and non-localhost origins served by
the configured HTTPS server.

## Visual capture smoke

Disposable local screenshots are documented in
[`playwright-tests.md`](playwright-tests.md). Start `npm run start-https` first
when invoking the capture CLI directly:

```bash
npm run capture:e2e:midi
npm run capture:e2e:editor
npm run capture:e2e:procgen
npm run capture:e2e:game-hud
```

Output stays under ignored `temp/e2e-captures/`.

## Milestone checkpoint evidence

Milestone work should leave a short, reproducible evidence note before issue
closeout. Keep working artifacts under ignored `temp/` and commit only the code,
tests, and durable docs needed by the feature.

Use this compact format for each lane or issue group:

```text
Issues:
Commands:
Temp artifacts:
GitHub closeout:
Skipped checks:
Unrelated failures:
Follow-up risks:
```

The Capture matrix below is the standard milestone map for the current
editor, procgen, solver, MIDI, and validation work. Run the narrow lane checks
while a lane is in progress, then run the standard gate before final closeout.

| Area | Issues | Capture matrix | Required checkpoint commands | Disposable evidence |
| --- | --- | --- | --- | --- |
| MIDI polish | #957 | `midi-transport`, `midi-source-browser`, `midi-track-workspace`, `midi-clip-library`, `midi-inspector`, `midi-learn`, `midi-record`, `midi-output-status`; desktop/tablet/mobile when layout changes | `npm run test-e2e -- e2e/midi-ui.spec.js`; `npm run capture:e2e:midi -- --viewport=desktop --json`; `npm run capture:e2e:midi -- --viewport=tablet --json`; `npm run capture:e2e:midi -- --viewport=mobile --json` | `temp/e2e-captures/`, `temp/midi-lane-*.md` |
| Editor productization | #954 | states `shell`, `canvas-palette-inspector`, `validation`, `save-import-export`, `playtest`; desktop required, tablet/mobile when controls change | `npm run test-editor`; `npm run test-e2e:harness`; `npm run capture:e2e:editor -- --viewport=desktop --json` | `temp/e2e-captures/`, `temp/editor-lane-*.md` |
| Procgen productization | #955 | states `overview`, `frontier`, `newest-pieces`; desktop required for seed review, targeted mobile only for shell/layout changes | `npm run test-e2e -- e2e/procgen.spec.js`; `npm run capture:e2e:procgen -- --viewport=desktop --json`; `npm run bench-procgen-soak`; `npm run test-bench-unit` | `temp/e2e-captures/`, `temp/procgen-lane-*.md` |
| Solver platform | #956 | no standalone screenshot gate until a UI/editor advisory surface changes; capture editor advisory or solver failure surfaces only when they are user-visible | `npm test`; focused `test/solver*.test.js`; `npm run test-e2e:harness` when runtime adapters or editor advisory flows change; MCP checks after solver tools change | `temp/solver-lane-*.md`, optional `temp/solver-failures/` |
| Validation and closeout | #953 | capture docs and runner drift are checked by tests; do not create committed galleries or manifests | `npm run format`; `npm run check-undefined`; `npm run lint`; `npm run typecheck:critical`; `npm test`; `npm run test-bench-unit` | `temp/milestone-integration-*.md` |

GitHub issue closeout comments should cite the commands that actually ran, any
relevant ignored artifact paths, and any skipped checks with the concrete
reason. Do not close an issue on visual captures alone when behavior changed;
pair captures with a deterministic unit, harness, or E2E check where available.
Keep capture output disposable: do not create committed galleries or manifests.
Use `npm run release-readiness` only when the release checklist or release gate
scripts change; it is not the issue closeout checklist.
