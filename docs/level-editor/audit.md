# Level Editor Productization Audit

Date: 2026-05-06

## Scope Decision

This checkpoint productizes the editor as a classic-subset editor. It may import
and preserve `.nxlv` data that is outside the classic subset, but it does not
claim NeoLemmix feature parity. Unsupported or lossy operations must be visible
before export, quick-fix, playtest, or import acceptance can surprise a user.

## Docs vs Code

| Area | Documented | Current implementation | Gap |
| --- | --- | --- | --- |
| Standalone editor | `editor.html` with canvas, palette, inspector, validation, local save, import/export | Implemented through `EditorUiController`, editor session, controller, and E2E harness | Product status and warnings need to state classic-subset limits directly in the UI |
| `.nxlv` import/export | Structured editor model with comments and unknown sections preserved | Parser/writer preserves top-level unknown lines, section-local unknown lines, unknown sections, and terrain groups | Round-trip coverage must prove semantic preservation for comments, unknown sections, and grouped terrain |
| Classic `.lvl` import/export | Supported as classic workflow | Implemented via `LevelReader`, `LevelWriter`, and classic conversion helpers | Export is intentionally lossy; the UI and validation need explicit warnings before users rely on it |
| Validation | Errors/warnings with quick fixes | Implemented in `EditorValidator` and rendered in the validation panel | Destructive fixes need clear labels/metadata so users can distinguish repair from data-dropping cleanup |
| Playtest | Toggle playtest without leaving editor | Implemented through editor preview/runtime path | Capture coverage should show both edit and playtest states |
| NeoLemmix expansion | Documented as out of scope | Parser preserves some unsupported data but runtime preview remains classic | Unsupported sections/properties must be visible warnings, not silent preservation claims |

## Implemented vs Claimed

Implemented and suitable for productized classic-subset use:

- Create blank levels and edit headers, skill counts, terrain, gadgets, steel,
  MIDI flags, and entrance/exit gadgets.
- Select, multi-select, marquee-select, move, nudge, duplicate, copy/paste,
  reorder, align/distribute, replace, randomize, and delete entries.
- Save and load editor levels from local storage.
- Export/import `.nxlv` editor levels.
- Import/export classic `.lvl` through the classic runtime representation.
- Validate common structural issues and apply quick fixes.
- Playtest the editor level through the game runtime.
- Expose editor state and operations through `window.__E2E__` for Playwright and
  MCP tooling.

Not implemented or not claimed in this checkpoint:

- Full NeoLemmix section semantics for `$TERRAINGROUP`, `$TALISMAN`,
  `$PRETEXT`, `$POSTTEXT`, multiple entrances/exits beyond classic limits,
  custom trigger boxes, or style metadata.
- Classic `.lvl` preservation of editor-only terrain flags such as `ONE_WAY`,
  editor-only transforms, comments, unknown sections, or grouped terrain.
- Solver-backed export blocking.
- Real archive/install tooling for exported editor pack bundles. The editor can
  store local projects, export the JSON handoff bundle with `info.nxmi`,
  `levels.nxmi`, level `.nxlv` text, and validation reports, and now export or
  install an editor pack archive with manifest validation before local storage
  writes.

## Workflow Coverage Map

| Workflow | Current coverage | Required checkpoint coverage |
| --- | --- | --- |
| Create playable level | Unit and harness coverage exists for editor state, tools, entrance/exit, round-trip workflow | Keep semantic create/validate/playtest/save/export/import test green |
| Import `.nxlv` with unknown data | Parser/writer tests cover parts of preservation | Add explicit semantic round-trip for comments, unknown sections, terrain groups, and unsupported data warnings |
| Classic `.lvl` import/export | Harness coverage exports/imports a classic level | Add lossy-export contract tests and cap validation before export |
| Import failures | UI file handlers report read/parse failures into status and validation | Keep visible failure coverage green |
| Validation quick fixes | Unit coverage exists for validation and fix callbacks | Mark destructive fixes and expose that status to UI/E2E |
| Visual states | Editor capture target exists | Split capture states for shell, palette/inspector, validation, file controls, and playtest |
| Project workflow | Local project storage, pack JSON export, and pack archive install exist | Keep archive install validation aligned with future pack metadata fields |

## UX Issues

1. Classic-subset boundaries are too implicit. Users can import a richer `.nxlv`
   and see a playable preview without understanding which data is preserved but
   unsupported by preview/export.
2. Classic `.lvl` export is available next to `.nxlv` export, but its lossy
   nature is not prominent enough.
3. Validation quick fixes can remove or clamp data. The UI needs to label those
   actions as destructive when they drop unsupported properties or entries.
4. Import failures should land in the same status/validation surface as normal
   editor issues, not only browser alerts or console errors.
5. Multi-selection is powerful but status text should keep reflecting batch
   scope and avoid implying single-entry edits when multiple entries are active.

## Correctness And Data-Integrity Risks

1. Unknown `.nxlv` sections are preserved by the parser/writer, but regressions
   would be easy without a focused semantic test.
2. Terrain groups are preserved in the editor model and serialized back, but the
   classic preview/runtime path does not implement full group behavior.
3. Classic `.lvl` export cannot carry comments, unknown sections, terrain
   groups, `ONE_WAY` terrain flags, or unsupported transforms.
4. Classic runtime caps need validation before export: title length, object
   count, terrain count, steel count, level size, entrance/exit limits, and
   unsupported props.
5. Object/gadget round-trip tests should compare meaningful fields, not merely
   assert that import succeeds.

## Prioritized Fixes

P0:

- Add visible classic-subset warnings for unknown sections, terrain groups,
  unsupported NeoLemmix data, destructive fixes, and classic `.lvl` export.
- Add semantic `.nxlv` and classic lossy round-trip tests.
- Add classic export cap validation.
- Fix import error reporting so bad `.nxlv` and `.lvl` files update editor
  status/validation.

P1:

- Expand editor E2E coverage for visible warnings, import failures, and
  semantic import/export acceptance.
- Split editor capture targets by workflow state and keep outputs under
  ignored `temp/`.

P2:

- Add a small multi-selection batch edit affordance only where the controller
  already supports safe bulk operations.
- Use audit captures to decide whether palette favorites or stronger recent
  item affordances are worth the next editor milestone.
