# Level Editor History and Undo/Redo

## Goals

- Provide robust undo/redo for editor actions.
- Keep history session-only (no persistence across reloads).
- Maintain deterministic snapshots for testability.

## Snapshot model

- History entries store serialized `.nxlv` text plus metadata.
- A snapshot is taken after each committed editor action.
- Undo/redo swaps the active editor level via parser/writer.

## Actions recorded

- Terrain/gadget placement
- Brush stamping batches
- Eraser deletions
- Move/resize operations
- Entrance/exit changes
- Header edits (level title/style/skills)

## Limits and coalescing

- History keeps configurable entry and byte limits. The editor UI uses bounded
  defaults (`maxEntries` and `maxBytes`) so long sessions cannot grow without a
  retention cap.
- Drag and brush operations commit one snapshot when the pointer interaction
  completes. Programmatic batch edits can use explicit transactions to produce
  one undo step.
- When configured, adjacent snapshots with the same label can coalesce within a
  short time window. History exposes `getStats()` for UI/debug telemetry.

## API

- `pushSnapshot(level, label)`
- `undo()` / `redo()`
- `canUndo()` / `canRedo()`
- `clear()`
- `getStats()`
- `beginTransaction(label)` / `endTransaction(label)` / `cancelTransaction()`
