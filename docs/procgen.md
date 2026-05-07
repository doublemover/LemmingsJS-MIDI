# Procgen Level-Piece Streaming Specification

This page describes the standalone `procgen.html` runtime: an endless,
full-viewport Lemmings run with procedural terrain streaming, no HUD/minimap,
and no MIDI UI.

## Scope
- Pick exactly one compatible visual style/theme for a seeded run, then keep the
  run visually coherent with that style's real terrain/decor pieces.
- Run full-viewport canvas mode with hidden GUI/cursor and endless spawning.
- Stream level pieces to the right while keeping camera follow smooth.
- Track progression from the live rightmost viable lemming frontier, not from
  lemming id or selected-lemming state.
- Use minimal assists for generated local challenges without turning procgen
  into constant AI control.
- Keep long-run memory bounded for generated chunks, frontier tracking, and
  assist decisions.

## Runtime constants
- Game type: `OHNO`.
- Level width: `65535`.
- Level height: `DEFAULT_LEVEL_HEIGHT`.
- Release rate: `50`, release count: `50`, save requirement: `0`.
- Time limit: `INFINITE`.
- Ground height: `4`.
- Initial ground width: `280`.
- Camera follow smoothing: frame-time-based interpolation.
- Seeded randomness: `?seed=<value>` controls deterministic style selection,
  terrain placement, lookahead variation, and assist decisions.

## Bootstrap flow
- Build an `EditorLevel`, set procgen headers, and place one entrance gadget.
- Convert via `loadEditorLevel`, then load into `Game` through `GameFactory`.
- Set `view.endless = true` so release never stops.
- Pick one style compatible with the active pack path. The selected style is the
  run's theme and is exposed in debug/E2E state.
- Resolve a procgen seed from `?seed=...` (fallback: stored value or timestamp),
  derive independent RNG streams for style and terrain/AI, and persist the
  active seed for replayability.

## Theme and piece streaming
- Terrain comes from the selected theme's actual asset catalog:
  - ground-capable terrain pieces for the walkable route.
  - sparse decorative terrain pieces away from the active route.
  - simple obstacle shapes only when they are compatible with the route and the
    current assist budget.
- Piece placement maintains a stable baseline path with bounded rises, dips,
  small gaps, small barriers, and safe landing surfaces.
- Decoration must stay readable: avoid dense clusters around the active route,
  overlapping decorative clutter, and pieces that obscure the next challenge.
- Generated chunk tracking is bounded. Keep recent chunks/pieces for debugging,
  but prune old entries once they are far behind the frontier.

## Frontier and lookahead
- The frontier is the rightmost viable live lemming position.
- A viable lemming is active, not removed/disabled/dead/exploded, has finite
  coordinates, and is not stale-stuck behind the active route.
- If the previous frontier dies, turns around, or gets stuck, recompute from the
  current live set instead of following its id.
- Selected lemming changes do not affect frontier calculation.
- The generator extends terrain when the distance from frontier to generated end
  drops below a safe threshold. Threshold variation is allowed, but it must stay
  inside fixed min/max bounds and never allow lemmings to reach an ungenerated
  edge.

## Minimal assist behavior
- Assist decisions are local and budgeted.
- Small gaps should prefer the minimum useful builder action.
- Small barriers should prefer bash/dig/mine only when a local scan indicates a
  real obstruction.
- Safe drops should avoid spending a skill; intentional risky drops can assign a
  floater before splat range.
- Traversable terrain should produce a no-op decision and no skill spend.
- Repeated failed attempts on the same lemming/challenge should be cooled down.
- Generated local gaps emit bounded challenge certificates. The local tactical
  solver verifies those certificates synchronously during generation; rejected
  gaps are simplified or replaced with extended terrain according to the solver
  fallback decision.
- Dynamic non-gap assists also emit compact local challenge certificates for
  barrier clearing and unsafe falls. These certificates record synchronous
  accept/extend/replace/simplify decisions for debug and review, but they do
  not mark a run solved; runtime replay remains the only full-route authority.

## Production hardening notes
- Hazard scans use a rebuilt hazard index instead of per-scan trigger-set
  allocation.
- Gap backlog pruning runs even with no active lemmings to avoid stale growth.
- Terrain stamping reuses cached destination typed-array views per level buffer.
- Asset-piece selection avoids temporary filtered arrays in hot paths.
- Debug lists for recent chunks, generated pieces, assist decisions, and
  per-lemming trackers are fixed-size rings or pruned arrays.

## Debug and E2E state

`window.__E2E__.getState().procgen` is the stable procgen debug surface. It
should remain compact and JSON-safe:

- `selectedTheme`: style/theme selected for this run.
- `seed`: normalized procgen seed.
- `generatedEndX`: current generated terrain extent.
- `frontier`: rightmost viable lemming summary with `x`, `y`, `id`, `reason`,
  and `tick`.
- `lookahead`: current lookahead distance, threshold, and distance to generated
  end.
- `recentChunks`: bounded list of recent generated route chunks.
- `recentCertificates`: bounded list of recent local challenge certificate
  decisions, including source, result type, fallback action, and assist reason
  when applicable.
- E2E/debug URLs can force deterministic certificate coverage with
  `gapChance`, `gapMinWidth`, `gapMaxWidth`, `recentCertificateLimit`, and
  `procgenCertificateVerification` query parameters.
- `recentPieces`: bounded list of recent stamped pieces, including style/theme.
- `recentAssists`: bounded list of recent assist decisions and no-op scans.
- `trackingSizes`: sizes of cooldown, stuck, gap, chunk, piece, and assist
  tracking structures.

This state is for tests and local debugging. It is not a save format.

## Validation
- `e2e/procgen.spec.js` verifies readiness, endless spawn progression, and
  camera advance. Productization coverage also verifies one selected theme,
  frontier/generated-end debug state, and bounded tracking summaries.
- Unit tests in `test/procgen-controller.test.js`,
  `test/procgen-terrain-stamper.test.js`, and
  `test/procgen-asset-manager.test.js` cover stability/perf-sensitive behavior.
- `npm run capture:e2e:procgen` captures the procgen viewport, canvas/runtime
  rects, the frontier area, and newest generated pieces into ignored
  `temp/e2e-captures/` for visual inspection.

## Productization status

This checkpoint productizes themed piece streaming, frontier-driven lookahead,
minimal assists, and local certificate checks for generated gaps, non-gap
barriers, and unsafe falls. The checks are bounded and local: terrain generation
can simplify or replace local chunks, dynamic assists only record their local
decision, and the runtime replay verifier remains authoritative for complete
solutions.
