# Level Editor Design Overview

## Goals
- Provide a fully featured in-game level editor for NeoLemmix `.nxlv`.
- Support save/load to localStorage and import/export `.nxlv` files.
- Offer comprehensive tools for terrain, gadgets, triggers, entrances, exits, steel, and selection edits.
- Keep editor logic deterministic and testable (100% coverage in `js/editor/**`).

## Non-goals (current)
- Full NeoLemmix gimmick support (zombies, water, clock terrain, etc.).
- NeoLemmix high-res style pack formats beyond classic assets.
- Custom pack building (NXP/NXMI writer) or asset import pipeline.

## Architecture

### Core data model
- `EditorLevel` holds headers, skillset, terrain/gadgets, terrain groups, and unknown sections.
- `NxlvParser` and `NxlvWriter` provide round-trip serialization.
- `StyleRegistry` stores style metadata, ground set IDs, and piece name lookup.

### Preview runtime
- `EditorLevelLoader` converts editor data into a classic `Level` for preview.
- Conversion uses classic `GroundReader` assets (`VGAGR*.DAT`, `GROUND*O.DAT`).
- Preview is rendered by the existing engine; editor mode suspends the timer unless playtest is toggled on.

### Editor controller
- Editor logic owns tool state, selection, history, and palette selection.
- Input is handled via stage display events in editor mode.
- Preview refreshes when editor data changes.

## Key editor subsystems
- **Tool system:** select, terrain stamp, gadget stamp, trigger stamp, entrance/exit, steel, brush, eraser.
- **Palette:** terrain/gadget/trigger lists with per-style asset metadata.
- **Inspector:** position/flags, delete, optional sizing, rotation snapped to 0/90/180/270.
- **History:** undo/redo with per-action snapshots.

## File IO
- LocalStorage entries:
  - `lemmings.editor.levels` (index)
  - `lemmings.editor.level.<id>` (NXLV text)
- Import/Export uses file picker + Blob download.

## Testing
- All `js/editor/**` logic is covered at 100% via `npm run coverage-editor`.
- UI wiring lives outside `js/editor/**` and stays minimal.
