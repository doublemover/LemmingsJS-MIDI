# Level Editor Plan (NeoLemmix Target)

## Current status
- Foundation work is complete: `EditorLevel`, `NxlvParser`, `NxlvWriter`, and the style registry are implemented with 100% editor test coverage.
- Editor storage helpers (`EditorStorage`) are implemented with 100% editor test coverage.
- Editor runtime integration and UI are implemented (see `editor.html` and `js/app/editorUiController.js`).
- The remainder of this document is a historical roadmap and should be reviewed against the current editor feature set.

## Goals
- Add an in-game level editor that reads and writes NeoLemmix V12 `.nxlv`.
- Toggle edit mode with Shift+Backquote and return to gameplay with the same shortcut.
- Start with a blank level using the first available style and allow loading a level while the editor is open via the existing HTML selectors.
- Add a separate Saved dropdown for locally stored editor levels (localStorage + file import/export).
- Enable terrain and gadget placement, selection, move, delete, and resize where supported.
- Include a playtest toggle to run the preview without leaving the editor.

## Non-goals (initial)
- Full NeoLemmix gimmicks (zombies, rising water, etc.).
- Pack packaging, NXP exports, or full toolkit parity.
- High-resolution styles and alias resolution.

## Assumptions
- Default style is the first style in the editor style registry (alphabetical by key).
- Saved levels appear in a dedicated dropdown, separate from game type/group/level selectors.
- Runtime resolution remains 1600x160 in the short term.

## Research and discovery
1. NeoLemmix `.nxlv` subset and mapping
   - Use `docs/nl-file-format.md` section 8 as the subset.
   - Define how header keys map to existing `Level` fields.
   - Define how `STYLE` and `PIECE` map to classic terrain/object indices.
2. Asset feasibility for brush terrain
   - Export ground pieces with `tools/exportGroundImages.js` for each pack.
   - Identify whether any terrain pieces are tileable and suitable for brush stamps.
   - Decide on brush granularity (1px, 4px, 8px) based on assets and performance.
3. Style registry data source
   - Decide registry format and location (JS module or JSON).
   - Determine how to list terrain and gadget pieces, including display names and preview sources.

## Architecture

### Editor data model
- `EditorLevel` (new module) mirrors `.nxlv` fields and sections.
  - Header: title, author, version, id, style, music, size, start position.
  - Skillset: 8 classic skills.
  - Terrain list: style, piece, x, y, flags (erase/no-overwrite/one-way), flip, rotate.
  - Gadget list: style, piece, x, y, flip, rotate, optional pairing/skill.
  - Steel list: rectangles for classic steel mask and optional terrain group tagging.

### NXLV parsing and serialization
- `NxlvParser` reads `.nxlv` into `EditorLevel`.
- `NxlvWriter` serializes `EditorLevel` back to `.nxlv`.
- Preserve unknown keys and unsupported sections where possible.

### Runtime mapping
- Convert `EditorLevel` into runtime `Level` by:
  - Mapping style to `graphicSet1` and piece ids via style registry.
  - Converting terrain entries into `LevelElement` with `DrawProperties` flags.
  - Converting gadgets into object ids and triggers.
  - Applying steel rectangles for `Level.steelMask`.
- Maintain a reverse mapping for saving edits back to `.nxlv`.

### Editor mode state
- `GameView` gains an editor state machine:
  - `mode = play | edit`.
  - Shift+Backquote toggles mode.
  - Edit mode pauses the game and swaps input handling to editor tools.
- Edit mode initializes a blank `EditorLevel` using the default style.
- Selecting a level in HTML while editing loads it into the editor instead of playing it.

## UI and interaction

### Editor overlay
- Palette panel with tabs:
  - Terrain pieces
  - Gadgets
  - Triggers (gadget subset filtered by trigger types)
- Tool buttons:
  - Select
  - Terrain piece placement
  - Brush (if viable)
  - Eraser
  - Steel rectangle
  - Entrance and exit placement
- Properties panel for selected item:
  - Position fields, flip/rotate flags, delete, and size if supported.

### Input
- Shift+Backquote toggles edit/play.
- Left-click places or selects; drag moves selection.
- Delete key removes selected item.
- R rotates (if supported), F flips vertically (if supported).
- Optional snap to 4px or 8px grid for alignment with terrain pieces.
- Playtest toggle resumes gameplay while keeping editor UI visible.

### Saved levels dropdown
- Add a new HTML select `savedLevelSelect` and label.
- Populate with saved `.nxlv` entries from localStorage.
- Selecting a saved level loads it into the editor.
- Provide buttons for Save (localStorage), Export (download `.nxlv`), and Import (file input).

## Save and load
- LocalStorage keys:
  - `lemmings.editor.levels` for metadata list.
  - `lemmings.editor.level.<id>` for raw `.nxlv` text.
- File import:
  - Read `.nxlv`, parse to `EditorLevel`, and load into editor.
- File export:
  - Serialize `.nxlv` and download via Blob.

## Implementation phases

1. Foundation
   - Add style registry module and default style selection.
   - Implement `EditorLevel`, `NxlvParser`, and `NxlvWriter`.
2. Editor mode plumbing
   - Add edit mode state and toggle shortcut.
   - Block gameplay commands while editing.
   - Ensure existing selectors can reload levels into editor when editing.
3. UI scaffolding
   - Add editor overlay HTML/CSS and event wiring.
   - Add Saved dropdown and storage actions.
4. Placement MVP
   - Entrance/exit placement only.
   - Basic selection and delete.
5. Terrain and gadgets
   - Palette list and placement for terrain pieces.
   - Gadget placement and trigger previews.
   - Selection, drag, and delete support.
6. Brush and eraser (if viable)
   - Brush stamping of terrain pieces.
   - Eraser for terrain and optional gadget delete.
7. Steel and resize
   - Steel rectangles with resize handles.
   - Optional resizable gadgets if supported by style registry.
8. Polish and testing
   - Save/load round-trip tests for `.nxlv`.
   - Manual validation of runtime mapping and trigger behavior.

## Remaining execution plan (next steps)
- [ ] Add an editor mode controller in `js/game/GameView.js` and hook Shift+Backquote in `js/input/KeyboardShortcuts.js`.
- [ ] Implement `.nxlv` loading into `EditorLevel` and a renderer bridge that maps to `Level` for preview.
- [ ] Add the Saved dropdown and storage layer (localStorage + import/export UI) in `index.html` and `js/app/boot.js`.
- [ ] Build the editor overlay UI shell (palette tabs + tool buttons + inspector).
- [ ] Implement entrance/exit placement and selection/move/delete.
- [ ] Implement terrain piece placement, selection, and deletion.
- [ ] Implement gadget placement, trigger previews, and selection.
- [ ] Evaluate brush feasibility; if viable, add brush/eraser tools and terrain stamping.
- [ ] Implement steel rectangle editing and resizable gadget handling.
- [ ] Add end-to-end `.nxlv` round-trip tests for editor flows.

## Validation checklist
- Toggle edit mode without losing state.
- Blank level uses default style and renders correctly.
- Existing level selection updates the editor when editing.
- Saved dropdown lists localStorage entries and loads them correctly.
- `.nxlv` export/import round trips with no data loss for supported keys.
- Terrain placement updates ground mask, minimap, and triggers.

## Risks and gaps
- NeoLemmix styles are not currently present; a style registry is required.
- Horizontal flips and rotations are limited by classic DAT assets.
- Some NeoLemmix gadget behavior has no runtime equivalent and must be ignored.
- Editor must guard against classic limits (object count, terrain count, steel count).
