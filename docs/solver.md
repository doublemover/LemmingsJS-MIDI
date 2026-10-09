# Solver Foundation

The solver is a deterministic local advisory platform. It can propose action
scripts, but the real runtime replay verifier is the authority for accepting a
solution.

## Result Contract

Every solver entrypoint returns:

- `resultType`: one of `solved`, `failed`, `unknown`, `timeout`, or
  `unsupported`.
- `summary`: deterministic one-line summary.
- `actions`: ordered action script entries when a candidate route exists.
- `explanations`: stable explanation codes with optional detail.
- `budgetUsage`: ticks, nodes, actions, and wall time consumed.
- `replaySummary`: verifier output, or `null` when replay did not run.
- `replayVerified`: `true` only when a `solved` result came through the replay
  verifier.
- `replayAuthority`: replay authority label such as `real-runtime`,
  `synthetic-runtime`, `non-authoritative-adapter`, or a local advisory verifier.
- `captures`: optional local `temp/` artifact references.

## Input Contract

Solver input includes a level source, fixed seed/options, skill subset, target
save count, max ticks, max nodes, max actions, max wall time, and mode:
`tactical`, `route`, or `full`.

## Action Script

Each action carries a skill type, target selector, tick or tick window,
preconditions, expected postconditions, and a rationale. Script replay must run
against the runtime verifier before the result can be `solved`.

Target selectors are intentionally semantic at this layer. A selector can refer
to the frontier lemming, a lemming id, a position window, or a fixture-defined
role. The replay adapter resolves that selector against runtime state at the
assignment tick.

## Budgets

All entrypoints normalize and enforce:

- `maxTicks`
- `maxNodes`
- `maxActions`
- `maxWallTimeMs`

Terrain snapshots and synthetic replay mask copies have a hard limit of
4,194,304 pixels, checked before terrain sampling or mask cloning. The optional
`maxSnapshotPixels` setting can lower this limit but cannot raise it. The full
endless procgen world requires a bounded finite source; explicit actor and goal
qualification for such an adapter remains open. Over-limit replay sources return
`unsupported` with `budget-exhausted` before stepping; direct constructors and
snapshot extraction throw a budget `RangeError`.

Budget exhaustion returns `timeout` with `budget-exhausted`; unsupported
source types or mechanics return `unsupported`. Search exhaustion inside a
supported scope returns `unknown`, not `timeout`.

## Replay Authority

The runtime runner exposes a small adapter contract: step ticks, apply an action
script entry, snapshot current state, and summarize the replay. Synthetic
fixtures use the same adapter shape as real runtime runs so tests can exercise
deterministic replay without a browser.

Only replay output with verifier `runtime-replay` sets `replayVerified`.
Non-synthetic adapters must be authoritative before a replay can become
`solved`; otherwise the result is `unknown` with `missing-runtime-adapter`.
Unmarked adapters are non-authoritative, including direct replay entrypoints.
A caller can explicitly assert authority with adapter
`isRuntimeAuthoritative: true` or source `authoritative: true`; an explicit
`false` vetoes either assertion. These declarations are caller assertions, not
independent runtime qualification. An initialized `Game` using the real
`GameTimer`, `LemmingManager` and `GameVictoryCondition` is recognized without
those declarations. Synthetic runner instances retain their separate model
authority; a facade's `kind: "synthetic"` label alone does not establish it.

Local tactical checks and procgen certificates may verify bounded local
challenges, but their authority is not full-level solvability.

## MCP Tools

The MCP solver surface is available after the local result schema is stabilized:

- `solver.snapshot`: extracts compact state hashes and counts without returning
  terrain masks.
- `solver.route`: builds a bounded reachability route skeleton. It returns
  `unknown` until timing search and runtime replay verify a candidate.
- `solver.replay`: runs action scripts through the same replay authority path
  used by local tests.

These tools return compact JSON for local development and automation. They do
not claim full level solvability unless the replay result is `solved`.

## Current Scope

This checkpoint establishes local modules for runtime replay, state extraction,
geometry analysis, tactical fixtures, procgen certificates, and editor advisory
checks. The solver is bounded and advisory; editor/export workflows must not be
blocked by solver output.

Editor validation now surfaces solver advisory findings as warning-only issues
when a level or rendered editor preview exposes route geometry. Advisory
warnings carry stable `solver_advisory_*` codes for E2E diagnostics, but they do
not add quick fixes and must never block editing, saving, or export.

The editor also exposes a manual **Check Solvability** command in the validation
panel. It refreshes the preview, runs the same bounded advisory pass, and reports
a compact ok/warning status for designers and E2E without changing validation or
export blocking behavior.

## Independent procedural physical goals

`ProcgenSolverAdapter` runs the actual shared action systems with assistance and new admissions disabled. It tracks 1-64 ordinary actors by stable ID against a finite physical arrival region; `goalKind: physical-region` and `exitRescues: false` keep this separate from authored exit rescue. Snapshots include real ground/steel, bounded source-object metadata and source/options identity. Protected terrain is checked once after replay, rather than scanned per tick.

`searchProcgenGoal(factory, options)` starts from fresh deterministic worlds and discovers action candidates from actual geometry and available skills, without a catalogue script or intended route input. Default limits are 32 nodes, 1,200 ticks per candidate, four actions, 32,768 total simulated ticks and one second of wall time; hard maxima are 64 nodes, 4,096 candidate ticks, eight actions, 262,144 total ticks and ten seconds. Search snapshots cap at 131,072 pixels and 512 source objects. A found plan must pass a fresh whole-crew replay; a bounded negative is unknown/timeout, never an unsolvability proof. Current candidates cover the four worker skills and the current frontier walker; this is not exhaustive multi-actor strategy search.

Optional `routeContracts` in the recipe book retain stable version/source provenance, measured entry/exit/containment geometry, one complete joint worker inventory, ordered timing rules, crew entry state, guards and failure cases. Exact pack/ground/art selection passes records to the source terrain as cold proposals. Existing synchronous/asynchronous certificate APIs use `options.procgenAdapterFactory` and `chunk.routeContract` to run independent qualification. Actual discovered action timing, every ordinary actor, zero loss, protected terrain and requested hazard/containment guards must match before the record becomes engine-qualified. Proposed research status and separate per-skill minima never establish qualification. The external research catalogue remains unavailable pending an authorized text handoff.