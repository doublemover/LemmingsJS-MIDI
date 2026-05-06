# Architecture Internals

This document is implementation-first guidance for the three subsystems that
currently carry most runtime complexity: renderer, time travel/history, and MCP.

## Renderer internals (`js/render/*`, `js/game/GameView.js`)

### Pipeline and ownership
- `Frame`: low-level RGBA + mask container used by decoded terrain/object frames.
- `DisplayImage`: mutable world image buffer for a layer (game or HUD). Writes
  happen here (`drawFrame`, rects, overlays), not in `Stage`.
- `Stage`: presentation/compositing layer. It owns the visible canvas and copies
  `DisplayImage` buffers into offscreen canvases, then onto the stage canvas.

### Hot-path rules
- Keep rendering Canvas2D-only.
- Prefer typed-array writes (`Uint32Array`) in `DisplayImage`/`Frame` paths.
- Use dirty-region updates (`markDirtyRect` / `consumeDirtyRects`) so
  offscreen `putImageData` work is scoped to changed regions.
- Avoid per-frame transient allocations:
  - xBRZ/HQX resized variants are cached per frame/version/target size.
  - stage context state writes (`globalAlpha`, `fillStyle`) are coalesced.

### Safe extension points
- Add new debug/perf overlays in `Stage.drawPerfOverlay`.
- Add new sprite draw modes by extending `DisplayImage._blit` and reusing
  `scaleNearest`/`scaleXbrz`/`scaleHqx` helpers.
- If you mutate a `Frame`, preserve `_version` invalidation semantics so cached
  scaled variants cannot go stale.

## Time travel internals (`js/game/HistoryStore.js`, `js/game/TimeTravelController.js`)

### Storage model
- History is snapshot + delta based.
- Deltas are grouped into fixed-size blocks to lower metadata overhead and speed
  seeks over long sessions.
- Cold blocks can be canonically encoded, deduplicated by hash, and optionally
  compressed.
- Idle ranges are tokenized as no-op spans to reduce repetitive growth.

### Determinism guardrails
- Replay integrity is verified through replay hashes over tick ranges.
- Compression and block thaw/rehydration paths must preserve delta semantics.
- Any new mutable game state must be represented in snapshot/delta extraction,
  otherwise rewind/seek divergence is likely.

### Practical change workflow
- Update `HistoryStore` extraction/apply logic first.
- Add or update `test/history-store.test.js` and
  `test/time-travel-controller.test.js`.
- Validate long-run memory behavior with `npm run bench-history`.

## MCP internals (`mcp/*`, `js/app/e2eHarness.js`)

### Surface split
- Tool registration is split by surface modules:
  - `mcp/tools/game.js`
  - `mcp/tools/editor.js`
  - `mcp/tools/interact.js`
- Shared session/resource/watch infrastructure remains centralized.
- Runtime routing is strict by enabled surfaces
  (`LEMMINGS_MCP_SURFACES`) to prevent cross-surface leakage.

### Contract and evolution
- Tool names are short-first; only shipped underscore names are accepted.
- Harness methods are the source of runtime behavior for tool handlers.
- When adding a tool:
  1. add harness capability,
  2. add tool schema + handler,
  3. add smoke/client tests,
  4. update docs/examples to shipped names only.

### Stability checks
- Compatibility checks: `npm run check-mcp-clients`
- Smoke checks: `npm run test-mcp-smoke`

## Startup profiles and mode boundaries

Runtime profiles (`gameplay`, `editor`, `perf`) exist to avoid paying for
subsystems that are not needed in a given mode. Keep new mode-sensitive
features profile-aware in `js/app/boot.js` and `js/game/GameView.js`.
