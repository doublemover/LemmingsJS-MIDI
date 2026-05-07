# Classic-Subset Editor Contract

The editor is productized as a classic-subset editor in this checkpoint. It can
load richer `.nxlv` files, but the editable and playable contract is the classic
runtime subset.

## `.nxlv`

- `.nxlv` is the preferred editor format.
- Header fields, classic skill counts, terrain entries, gadget entries, steel
  rectangles, comments, unknown lines, unknown sections, and terrain-group data
  are preserved when parsing and writing the editor model.
- Preserved does not mean previewed or editable. Unsupported sections remain
  data-preservation payloads until NeoLemmix expansion work implements their
  runtime and UI semantics.
- Importing unsupported sections must produce a warning in the editor surface.

## Classic `.lvl`

- Classic `.lvl` import/export is for DOS/classic-compatible level data.
- Export to `.lvl` is lossy by design. It cannot preserve comments, unknown
  sections, terrain groups, editor-only terrain flags, custom NeoLemmix
  sections, or unsupported transforms.
- Classic export should run validation first and warn about classic caps before
  bytes are written.
- Classic import produces a clean editor model from the runtime-readable data;
  any data absent from the classic format is not recoverable.

## Validation And Quick Fixes

- Errors identify conditions that make a level invalid for the editor's current
  export/playtest path.
- Warnings identify lossy, unsupported, or risky conditions that still allow
  editing.
- Quick fixes that clamp, delete, strip, or synthesize data must be visible as
  data-changing actions. They should not be described as harmless cleanup when
  they can drop unsupported properties or entries.

## NeoLemmix Data

The following NeoLemmix-oriented data is preserved where the current parser can
round-trip it, but is not implemented as editor/runtime behavior in this pass:

- `$TERRAINGROUP` semantics beyond preservation.
- `$TALISMAN`, `$PRETEXT`, `$POSTTEXT`, pack metadata, and unlock rules.
- Multiple entrances/exits beyond classic limits.
- Custom trigger boxes and non-classic gadget semantics.
- Advanced style metadata and non-classic skill definitions.

Future NeoLemmix expansion should add parser/model/runtime/UI support before
removing these warnings.
