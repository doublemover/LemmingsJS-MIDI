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

Budget exhaustion returns `timeout` with `budget-exhausted`; unsupported
source types or mechanics return `unsupported`. Search exhaustion inside a
supported scope returns `unknown`, not `timeout`.

## Replay Authority

The runtime runner exposes a small adapter contract: step ticks, apply an action
script entry, snapshot current state, and summarize the replay. Synthetic
fixtures use the same adapter shape as real runtime runs so tests can exercise
deterministic replay without a browser.

## Current Scope

This checkpoint establishes local modules for runtime replay, state extraction,
geometry analysis, tactical fixtures, procgen certificates, and editor advisory
checks. The solver is bounded and advisory; editor/export workflows must not be
blocked by solver output.

Editor validation now surfaces solver advisory findings as warning-only issues
when a level or rendered editor preview exposes route geometry. Advisory
warnings carry stable `solver_advisory_*` codes for E2E diagnostics, but they do
not add quick fixes and must never block editing, saving, or export.
