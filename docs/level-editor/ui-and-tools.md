# Level Editor UI and Tools

## UI layout

- **Editor toolbar** (left of canvas): tool buttons and mode status.
- **Palette panel** (right of canvas): tabs for Terrain, Gadgets, Triggers.
- **Inspector panel**: properties for selected entry (position, flags, delete).
- **Saved levels**: the existing Saved dropdown stays available while editing.

## Tools

- **Select**: click to select; drag to move; Delete removes.
- **Terrain stamp**: place a single terrain piece at cursor.
- **Gadget stamp**: place a gadget (objects like entrance/exit/traps).
- **Trigger stamp**: place gadgets filtered to trigger-only objects.
- **Entrance**: places the entrance gadget.
- **Exit**: places the exit gadget.
- **Steel**: place a resizable steel rectangle (editor-only).
- **Brush**: stamp selected terrain piece along the drag path using the grid spacing.
- **Eraser**: delete terrain entries under the cursor; optionally deletes gadgets.
- **Playtest**: toggles gameplay on/off while staying in editor mode.

## Selection behavior

- Selected entry is outlined on the preview.
- Inspector reflects the selected entry’s properties.
- Resize is offered when the entry exposes `WIDTH/HEIGHT`.
- Copy/paste/duplicate operate on the current selection.

## Keyboard and mouse

- `Shift+`` toggles editor mode.
- Entering editor mode pauses the timer and disables gameplay input/panning; exiting restores the prior run state.
- Tool shortcuts are configurable via `keybindings.json`.
- Left click places or selects; drag moves selection.
- Right click cancels placement or clears selection.
- Alt-drag duplicates the active selection before moving it.
- Arrow keys nudge the selection; shift+arrows nudge by the grid size.
- Mouse wheel zoom and arrow-key panning still work in editor mode.

## Brush feasibility

Classic Lemmings levels are assembled from fixed terrain pieces. There is no generic paintable ground texture, so the brush tool is implemented as repeated stamps of a chosen terrain piece (grid-based), not per-pixel painting.
