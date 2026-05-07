# Release Readiness Checklist

This checklist is validated by `npm run release-readiness`.
All required sections must exist and remain fully checked before release.

## Compatibility
- [x] MCP semantic tool surfaces (`game`, `editor`, `interact`) verified against `docs/mcp/protocol-v2.md` and `docs/mcp/README.md`.
- [x] Runtime/browser fallbacks validated for WebMIDI, OffscreenCanvas, ImageBitmap, and worker/offscreen render paths.

## Migration
- [x] MCP tool naming is hard-cut to shipped underscore names only.
- [x] Persisted storage migrations were replayed on existing local data for editor and MIDI settings.

## Performance
- [x] Bench smoke gates pass (`npm run bench-smoke`) with no threshold regressions.
- [x] Long-session gate logic is validated in CI tests (`test/bench-long-session.test.js`) and soak script is available for staged runs (`npm run bench-long-session-soak`).

## Accessibility
- [x] MIDI expressive controls keep keyboard navigation, labels, and focus behavior across desktop and mobile layouts.
- [x] MIDI mapping and audition controls expose deterministic automation hooks for E2E coverage.

## Runtime Controls
- [x] Runtime query controls were exercised (`rollbackAll`, `rollbackRenderPresent`, `rollbackHistoryCodec`).
- [x] MCP surface gating is controlled only by `LEMMINGS_MCP_SURFACES`.
