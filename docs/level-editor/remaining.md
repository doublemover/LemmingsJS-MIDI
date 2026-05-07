# Remaining (Beyond Classic Subset)

This list tracks features not included in the classic subset editor scope.
See `docs/level-editor/neolemmix-expansion.md` for a fuller NeoLemmix parity roadmap.
The classic subset editor is implemented; items below remain out of scope.

## NeoLemmix Sections
- Terrain groups, order/visibility, and grouped terrain properties.
- Object groups / skillsets beyond classic.
- Pre-text, post-text, talismans, and unlock requirements.
- Advanced trigger metadata (custom area masks, rotation modes).

## Rendering/Preview
- In-preview transforms (rotate/flip) beyond classic renderer support.

## Editing Tools
- True pixel brush or freeform terrain editing.
- Multiple entrances/exits beyond the classic cap.

## Workflow
- Live keybinding editing UI.
- Level versioning and multi-file history.

## Validation
- Advanced rule validation (talismans, skill gating).

## Project and Pack Workflow Design

Project work should extend the current single-level editor without creating a
second roadmap file. The durable contract is:

- Local project storage owns editable project metadata, level ordering, the
  active level id, and per-level `.nxlv` text.
- Exported `.nxlv` owns one level and preserves comments or unknown sections
  that the editor does not understand.
- Classic `.lvl` export remains a lossy compatibility target and must keep
  validation warnings for classic caps, unsupported properties, and preserved
  NeoLemmix data.
- Pack bundles own `levels.nxmi`, `info.nxmi`, style references, level order,
  and a validation report summary for every included level.

Initial UI entry points are implemented as local project storage, project and
project-level selectors, save/add/duplicate/rename/delete level actions, a pack
JSON handoff export, and an installable editor pack archive export/import path.
Archive installs require `info.nxmi`, `levels.nxmi`, and every referenced level
file before saving a local project, so incomplete archives produce validation
reports instead of partial project writes.

## Pack-Level Validation

The validation report contract is implemented as JSON so editor UI, harnesses,
and future pack export code can share one shape. A report entry includes
severity, blocker/export-blocker flags, target, message, destructive-fix
metadata, and unsupported preserved-data markers. Pack-level checks currently
cover missing levels, duplicate ids/titles, missing styles, and missing
style-asset references when a style map is available.
