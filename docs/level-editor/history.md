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

- History keeps a configurable number of snapshots; the editor UI sets this to a very large cap for full-session history.
- Drag operations coalesce into a single snapshot when the drag completes.

## API

- `pushSnapshot(level, label)`
- `undo()` / `redo()`
- `canUndo()` / `canRedo()`
- `clear()`
