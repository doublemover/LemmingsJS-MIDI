# Level Editor Implementation Plan (Classic Subset)

Goal: deliver a standalone editor page for classic packs with DOM overlay tools, validation, playtest toggle, and full per-edit history while preserving preview rendering.

## Status (0.0.3)
- Classic subset editor is implemented (standalone page, tool palette, selection/inspector, validation with fixes, undo/redo history, saved levels, export/import, playtest toggle, palette previews).
- Entrance/exit placement is capped at 4 each; steel rectangles are editable.
- Preview still follows classic rendering rules (rotation/flip beyond classic are not previewed).

## Scope
- In: classic headers, terrain/object placement, triggers, entrance/exit (cap 4), steel rectangles, brush/eraser, resize/rotate/flip metadata (rotations snapped to 0/90/180/270), validation with fix suggestions, saved levels (prompt for name), export/import (.nxlv + .lvl), playtest toggle.
- Out: full NeoLemmix sections (terrain groups, talismans, pre-text, etc.), live keybinding editing, advanced transforms beyond classic preview.

## Milestones
1) Standalone editor page + layout. (done)
2) Input wiring + tool palette (place/move/erase). (done)
3) Inspector for transforms + metadata edits. (done)
4) Validation + fix suggestions. (done)
5) Keybindings (editor tool actions). (done)
6) Docs/README updates + remaining gaps list. (done)

## Detailed Steps
- Create `editor.html` and `css/editor.css` with three-column layout and DOM overlay panels.
- Add `js/app/editorBoot.js` to initialize GameView, set editor mode, and wire UI.
- Implement `EditorValidator` with classic subset checks and fix functions, plus tests.
- Add editor tool actions to `keybindings.json` and `KeybindingRegistry` defaults.
- Implement editor keyboard handler (uses KeybindingRegistry) for tool switches and undo/redo/delete.
- Wire pointer input from Stage to EditorController for select/move/brush/eraser.
- Build palettes for terrain/object/trigger selection using `EditorAssetCache` (preload active groundset).
- Build inspector to edit X/Y/W/H, rotate, flip, and entry flags; commit per edit.
- Add validation panel with issue list + fix buttons; revalidate on changes.
- Ensure entrance/exit placement is enforced by EditorController and exposed as tools.
- Add saved levels dropdown + save/export/import to editor page, prompt for a save name.
- Add playtest toggle to resume/stop gameplay while staying in editor mode.
- Update docs with remaining non-classic features and editor workflow notes.

## Testing
- Add unit tests for `EditorValidator` (100% for js/editor).
- Extend editor controller tests if new branches are introduced.
- Manual smoke test: load blank level, place terrain, place entrance/exit, place trigger, move/resize/flip, export/import.
