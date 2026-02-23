# Release Readiness Checklist

This checklist is validated by `npm run release-readiness`.
All required sections must exist and remain fully checked before enabling risky rollout defaults.

## Compatibility
- [x] MCP semantic tool surfaces (`game`, `editor`, `interact`) verified against `docs/mcp/protocol-v2.md` and `docs/mcp/README.md`.
- [x] Runtime/browser fallbacks validated for WebMIDI, OffscreenCanvas, ImageBitmap, and worker/offscreen render paths.

## Migration
- [x] Legacy aliases and migration notes are documented for MCP and MIDI UI state where compatibility windows still apply.
- [x] Persisted storage migrations were replayed on existing local data for editor and MIDI settings.

## Performance
- [x] Bench smoke gates pass (`npm run bench-smoke`) with no threshold regressions.
- [x] Long-session gate logic is validated in CI tests (`test/bench-long-session.test.js`) and soak script is available for staged runs (`npm run bench-long-session-soak`).

## Accessibility
- [x] MIDI expressive controls keep keyboard navigation, labels, and focus parity with legacy controls.
- [x] Rollback toggles for MIDI expressive UI are tested so accessible fallback controls remain available.

## Rollback Rehearsal
- [x] Runtime query rollback toggles were exercised (`rollbackAll`, `rollbackRenderPresent`, `rollbackHistoryCodec`, `rollbackMidiUi`).
- [x] MCP rollout environment toggles were rehearsed (`LEMMINGS_ROLLOUT_MCP_SURFACE_SPLIT`, `LEMMINGS_ROLLOUT_MCP_LEGACY_ALIASES`, `LEMMINGS_ROLLOUT_MCP_DOTTED_FALLBACK`).
