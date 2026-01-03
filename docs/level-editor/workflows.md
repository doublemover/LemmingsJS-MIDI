# Editor workflows

This page captures common editor flows and the expected UI behavior. It is
intentionally brief so it can stay current.

## Create and edit a level

1. Open `editor.html`.
2. Use the tool list to pick Terrain, Object, Trigger, Entrance, Exit, Steel,
   Brush, or Eraser.
3. Use the palette to pick a piece, then click or drag in the canvas.
4. Use the inspector to edit coordinates, dimensions, or flags.
5. Use Playtest to run the level without leaving the editor.

## Selection and transforms

- Click to select an entry; shift-click or marquee to multi-select.
- Drag to move selections; handles resize single selections.
- Use copy/paste/duplicate, and nudge with arrow keys (shift = grid size).

## Saved levels

- Save stores to localStorage and refreshes the Saved selector.
- Export `.nxlv` for NeoLemmix-style workflows.
- Import `.nxlv` or classic `.lvl` files to convert into editor levels.

## Validation

The Validation panel lists issues with quick-fix actions where possible. Fix
errors before exporting.
