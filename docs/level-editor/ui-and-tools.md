# Level Editor UI and Tools

See `docs/level-editor/workflows.md` for end-to-end editing flows.

## UI layout

- **Editor toolbar** (left of canvas): tool buttons and mode status.
- **Palette panel** (left side, below tools): tabs for Terrain, Objects, and
  Triggers, with List/Grid view modes and Ctrl+wheel grid-density changes in
  grid view.
- **Inspector panel** (right side): properties for selected entry (position,
  flags, ordering, alignment/distribution, piece replacement, randomized
  replacement, transform scale, and delete).
- **Saved levels**: the existing Saved dropdown stays available while editing.

## Tools

- **Select**: click to select; drag to move; Delete removes.
- **Terrain stamp**: place a single terrain piece at cursor.
- **Gadget stamp**: place a gadget (objects like entrance/exit/traps).
- **Trigger stamp**: place gadgets filtered to trigger-only objects.
- **MIDI Flag**: place the MIDI flag gadget used by MIDI-trigger workflows.
- **Entrance**: places the entrance gadget.
- **Exit**: places the exit gadget.
- **Steel**: place a resizable steel rectangle (editor-only).
- **Brush**: stamp selected terrain piece along the drag path using the grid spacing.
- **Eraser**: delete terrain entries under the cursor; optionally deletes gadgets.
- **Playtest**: toggles gameplay on/off while staying in editor mode.

## Selection behavior

- Selected entry is outlined on the preview.
- Inspector reflects the selected entry’s properties.
- Resize is currently offered for steel rectangles; terrain/gadget dimensions
  come from asset metadata unless a specific entry type supports sizing.
- Copy/paste/duplicate operate on the current selection.

## Keyboard and mouse

- `Shift+`` toggles editor mode.
- Entering editor mode pauses the timer and disables gameplay input/panning; exiting restores the prior run state.
- Tool shortcuts are configurable via `keybindings.json`.
- Tool buttons show shortcut tooltips from the active keybindings.
- Left click places or selects; drag moves selection.
- Right click cancels placement or clears selection.
- Alt-drag duplicates the active selection before moving it.
- Arrow keys nudge the selection; shift+arrows nudge by the grid size.
- Mouse wheel zoom remains available. Arrow keys nudge selections while editing.
- Preview reloads preserve the current viewport during edit operations.

## Brush feasibility

Classic Lemmings levels are assembled from fixed terrain pieces. There is no generic paintable ground texture, so the brush tool is implemented as repeated stamps of a chosen terrain piece (grid-based), not per-pixel painting.
