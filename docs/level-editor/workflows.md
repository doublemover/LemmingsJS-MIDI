# Editor workflows

This page captures common editor flows and the expected UI behavior. It is
intentionally brief so it can stay current.

## Create and edit a level

1. Open `editor.html`.
2. Use the tool list to pick Terrain, Object, Trigger, Entrance, Exit, Steel,
   Brush, or Eraser.
3. Use the palette to pick a piece, or reselect a recent piece from the palette
   strip, then click or drag in the canvas.
4. Use the inspector to edit coordinates, dimensions, or flags.
5. Use Playtest to run the level without leaving the editor.

## Selection and transforms

- Click to select an entry; shift-click or marquee to multi-select.
- Drag to move selections; handles resize single steel selections.
- Use copy/paste/duplicate, and nudge with arrow keys (shift = grid size).
- Use ordering, align/distribute, replace piece, randomize pieces with optional
  seed/same-size matching, and transform scale for bulk selection edits.

## Saved levels and files

- New Level creates a blank editor level.
- Save stores to localStorage and refreshes the Saved selector.
- The dirty chip shows Saved/Unsaved state for the current editor session.
- Export and Import handle `.nxlv` editor levels.
- Export LVL and Import LVL handle classic `.lvl` files.
- Terrain `ONE_WAY` flags are preserved by `.nxlv` import/export only. Classic
  `.lvl` export/import drops terrain `ONE_WAY`; classic one-way behavior must be
  modeled as arrow/object gadgets separately.

## Project and pack workflow

- Project stores a local multi-level editor project in
  `lemmings.editor.projects` / `lemmings.editor.project.*`.
- The compact Project menu opens project and project-level selectors plus pack
  actions without taking space from the palette/canvas workflow.
- New Project captures the current level as the first project level.
- Save Level updates the active project level; Add Level captures the current
  level as a new project level.
- Duplicate, Rename, and Delete operate on the active project level.
- Export Pack downloads a JSON bundle containing `info.nxmi`, `levels.nxmi`,
  per-level `.nxlv` text, per-level validation reports, and a pack consistency
  report. The JSON is an editor handoff bundle, not a zip installer.

## Validation

The Validation panel lists issues with quick-fix actions where possible. Fix
errors before exporting.

## Visual checks

Use `npm run capture:e2e:editor` for a disposable desktop capture. The capture
setup stages a selected terrain entry, a saved-level option, validation issues,
and playtest mode, then records the shell, canvas, palette, inspector, file
controls, selection actions, validation list, playtest status, header rectangle,
and viewport. The PNGs are written under ignored `temp/e2e-captures/` and can be
attached manually to issues or review notes.

For non-desktop checks, run the capture CLI directly with `--viewport=tablet` or
`--viewport=mobile`.
