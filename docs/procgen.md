# Procgen (Endless) Specification

This page describes the standalone `procgen.html` runtime: an endless,
full-viewport Lemmings run with procedural terrain streaming, no HUD/minimap,
and no MIDI UI.

## Scope
- Use `OHNO` resources with classic styles loaded through the normal pack
  pipeline.
- Run full-viewport canvas mode with hidden GUI/cursor and endless spawning.
- Stream terrain/decor/hazards to the right while keeping camera follow smooth.
- Keep long-run memory bounded for tracking structures used by procgen AI.

## Runtime constants
- Game type: `OHNO`.
- Level width: `65535`.
- Level height: `DEFAULT_LEVEL_HEIGHT`.
- Release rate: `50`, release count: `50`, save requirement: `0`.
- Time limit: `INFINITE`.
- Ground height: `4`.
- Initial ground width: `280`.
- Camera follow smoothing: frame-time-based interpolation.

## Bootstrap flow
- Build an `EditorLevel`, set procgen headers, and place one entrance gadget.
- Convert via `loadEditorLevel`, then load into `Game` through `GameFactory`.
- Set `view.endless = true` so release never stops.
- Pick a style compatible with the active pack path and cache the last choice in
  `localStorage` when available.

## Terrain and AI behavior
- Maintain `groundEndX`; extend terrain whenever lead progress nears the
  extension threshold.
- Prefer terrain piece stamping (`ProcgenTerrainStamper`) over per-pixel writes.
- Use environment scans (gap/wall/hazard) plus budgeted AI assist skills.
- Track unassigned gaps and assign builders as lemmings approach.
- Periodically prune stale per-lemming tracking/cooldown state for long runs.

## Production hardening notes
- Hazard scans use a rebuilt hazard index instead of per-scan trigger-set
  allocation.
- Gap backlog pruning runs even with no active lemmings to avoid stale growth.
- Terrain stamping reuses cached destination typed-array views per level buffer.
- Asset-piece selection avoids temporary filtered arrays in hot paths.

## Validation
- `e2e/procgen.spec.js` verifies readiness, endless spawn progression, and
  camera advance.
- Unit tests in `test/procgen-controller.test.js`,
  `test/procgen-terrain-stamper.test.js`, and
  `test/procgen-asset-manager.test.js` cover stability/perf-sensitive behavior.
