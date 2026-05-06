# Level Editor UI Specification (Classic Subset)

This spec defines the standalone editor page UI and interaction model for the classic subset of NeoLemmix-compatible levels.

## Goals
- Provide a dedicated editor page with a focused layout and DOM-based tooling.
- Keep the workflow fast for classic terrain and object placement.
- Make validation visible and actionable with fix-it options.
- Preserve existing game preview rendering via the in-engine level loader.

## Non-goals
- Live keybinding editing.
- Arbitrary pixel terrain painting.
- Full NeoLemmix sections beyond the classic subset.

## Layout
- Standalone page at `editor.html`.
- Three-column layout:
  - Left: tool palette, piece palettes, brush/snap controls.
  - Center: game canvas preview + status strip.
  - Right: header fields, selection inspector, validation output.
- DOM overlay panels layered over the canvas using CSS grid; no canvas-rendered UI.

## Visual Style
- High-contrast, print-like UI with warm neutrals.
- Distinct header bar with the editor title and save/load controls.
- Panels use subtle grid/paper texture background and thin borders.
- Fonts: serif for headers, humanist sans for body.

## Header Bar
- Title: "Lemmings Editor".
- Level selectors (game type, group, level) for classic levels.
- Saved levels dropdown (localStorage) with Save/Export/Import buttons.
- Save prompts for a name before writing to localStorage.
- Playtest toggle that resumes gameplay without leaving the editor.
- Status chip showing: current style, selected tool, last action, playtest state.

## Tools Panel (Left)
- Tool buttons in a vertical stack:
  - Select
  - Terrain Stamp
  - Object
  - Trigger
  - MIDI Flag
  - Entrance
  - Exit
  - Steel
  - Brush
  - Eraser
- Entrance/Exit placement replaces the existing single entrance/exit.
- Toggle controls:
  - Snap to grid (checkbox)
  - Grid size (number)
  - Brush size (number)
  - Erase gadgets (checkbox)
- Tool buttons show active state and highlight on keyboard selection.

## Palettes Panel (Left)
- Tabbed list: Terrain / Objects / Triggers.
- Each entry displays:
  - Sprite preview thumbnail
  - ID
  - Name
  - Dimensions (WxH)
  - Optional flags (steel, trigger)
- Active selection highlight per tab.
- Search/filter input to narrow list (client-side only).

## Canvas Preview (Center)
- Uses existing game renderer for live preview.
- Panning disabled by default (editor uses drag for move).
- Zoom via mouse wheel (existing Stage behavior).
- Status strip shows mouse coordinates, grid, and selection summary.

## Inspector Panel (Right)
- Selection summary:
  - Type (terrain/gadget)
  - Piece name + id
  - Bounding box (from WIDTH/HEIGHT or asset sizes)
- Transform fields:
  - X, Y (number)
  - WIDTH, HEIGHT (number, optional)
  - Rotate (number, degrees, snapped to 0/90/180/270)
  - Flip H, Flip V (checkboxes)
- Terrain-only flags:
  - No Overwrite (checkbox)
  - Erase (checkbox)
  - One Way (checkbox)
- Gadget-only fields:
  - Pairing (number)
  - Skill (string)
  - Lemmings (number)
- Delete button removes the selection.

## Header Fields Panel (Right)
- Title
- Style
- Width, Height
- Lemmings
- Save Requirement
- Time Limit
- Spawn Interval (MAX_SPAWN_INTERVAL)
- Start X, Start Y

## Validation Panel (Right)
- Lists errors (red) and warnings (amber).
- Each issue can include a "Fix" button.
- Examples:
  - Missing entrance/exit
  - Save requirement > lemmings
  - Out-of-bounds terrain/gadgets
  - Invalid width/height/time limit

## Keyboard Shortcuts
- Tool bindings from `keybindings.json` (editor actions).
- Undo/redo/delete from the same config.
- Copy/paste/duplicate, nudge, and snap-to-grid actions are configurable.
- Display the active bindings in tooltips.

## Interaction Model
- Click to select; shift-click to multi-select; drag to move.
- Drag a marquee box (marching ants) to select multiple entries.
- Resize handles appear for single selection.
- Brush/eraser: click and drag to paint/erase terrain stamps along the drag path.
- Alt-drag duplicates the current selection before moving it.
- Right-click clears selection.
- Playtest toggle resumes gameplay; toggling off pauses and returns to editing.
- Inspector edits commit on change (not on every keystroke).
- Validation fixes apply in one history step.
- Preview refreshes preserve the viewport during edit operations.

## Accessibility
- All buttons and inputs are keyboard-focusable.
- Tool buttons are `<button>` elements with `aria-pressed`.
- Validation list uses semantic headings and badges.

## Errors & Warnings
- Errors should block export but not prevent saving to localStorage.
- Warnings should never block export.

## Future Extensions (Out of Scope)
- Full NeoLemmix terrain groups and pre-placed skillsets.
- Arbitrary terrain brush.
