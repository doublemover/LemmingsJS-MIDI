# E2E Editor State

Editor state is returned under `window.__E2E__.getState().editor`. This document
lists every field surfaced by the harness for editor mode.

Editor mutations for Playwright and MCP go through
`window.__E2E__.editorApply(ops, options)`. The operation contract is documented
in [`mcp/editor-apply.md`](mcp/editor-apply.md).

## Top-level editor fields
- `mode`: `true` when editor mode is active.
- `playtest`: editor playtest toggle (from GameView).
- `session`: editor session + level data.
- `controller`: editor controller state.
- `history`: editor history summary (see `getEditorHistoryEntry`).
- `ui`: UI controller state (if `EditorUiController` is present).
- `assets`: resolved style assets summary.
- `validation`: validation issues summary.
- `savedLevels`: local saved levels index.

## editor.session
- `title`: session title (from `EditorSession.getTitle()`).
- `level`: serialized `EditorLevel`.

### editor.session.level
- `header`: map of header keys to values.
- `headerOrder`: array of header keys in file order.
- `skillset`: map of skill names to counts.
- `terrains`: array of terrain entries.
- `gadgets`: array of gadget entries.
- `steel`: array of steel entries.
- `terrainGroups`: array of terrain group entries.
- `unknownSections`: array of unknown section objects.
- `unknownLines`: array of raw unknown lines.

### entry shape (terrains/gadgets/steel)
- `props`: key/value properties (X, Y, ROTATE, WIDTH, HEIGHT, PIECE, etc).
- `order`: property ordering captured from file.
- `unknownLines`: raw lines tied to this entry.

### terrainGroups shape
- `props`: group properties.
- `order`: property ordering.
- `terrains`: nested terrain entries (same entry shape as above).
- `unknownLines`: raw lines tied to the group.

### unknownSections shape
- `name`: section name.
- `lines`: raw text lines for the section.

## editor.controller
- `tool`: active tool (select/terrain/gadget/trigger/steel/brush/eraser/etc).
- `gridSize`, `snapEnabled`, `brushSize`, `eraseGadgets`.
- `selectedTerrainId`, `selectedGadgetId`, `selectedTriggerId`.
- `handleSize`.
- `selection`: `{ type, index }[]`.
- `selectionEntries`: resolved entries with `type`, `index`, `entry`.
- `selectionBounds`: bounds of the current selection.
- `marqueeBounds`: bounds of the current marquee.
- `drag`: current drag state (`label`, `entries`).
- `resize`: current resize state.
- `marquee`: marquee tracking state.
- `steelDraft`: steel draft tracking state.
- `strokeChanged`: `true` if current stroke modified the level.
- `lastBrushPos`: last brush position.
- `pasteOffset`: current paste offset.
- `pointerDown`, `pointerButton`.
- `previewDelay`.
- `clipboard`: clipboard contents (cloned entries).
- `stampCount`: internal brush stamp count.

## editor.history
- `cursor`: current history cursor.
- `count`: number of history entries.
- `entries`: array of `{ label, time, textLength }`.

### getEditorHistoryEntry(index)
Returns `{ index, label, time, text }` for a single history entry.

## editor.ui
Present only when `EditorUiController` exists (editor.html).
- `activeTab`: active palette tab (`terrain`, `gadgets`, `triggers`).
- `currentSavedId`: currently selected saved level id.
- `playtest`: playtest toggle from UI controller.
- `previewInFlight`, `previewQueued`.
- `cursorPos`: `{ x, y }` or null.
- `pointerDown`, `shiftKey`, `altKey`.
- `antsOffset`: marching ants offset for selection overlay.
- `selectionCount`: size of UI selection.
- `suppressHeader`, `suppressInspector`.
- `paletteSearch`: current palette search string.

## editor.assets
- `styleName`, `groundSet`, `entranceId`, `exitId`.
- `terrain`: array of `{ id, name, width, height, isSteel }`.
- `gadgets`: array of `{ id, name, width, height, triggerEffectId, triggerWidth, triggerHeight }`.
- `triggers`: subset of gadgets with `triggerEffectId != 0`.

## editor.validation
- `hasErrors`: true if any issue has severity `error`.
- `issues`: array of `{ severity, message, fixLabel, hasFix }`.

## editor.savedLevels
List of `{ id, name, updatedAt }` from localStorage.
