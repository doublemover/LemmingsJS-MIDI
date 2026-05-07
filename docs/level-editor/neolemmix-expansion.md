# NeoLemmix Expansion Notes (Beyond Classic Subset)

This document captures the additional NeoLemmix features required for full parity, pulled from `docs/nl-file-format.md` and related references.
Status: no NeoLemmix expansion features are implemented yet; this is a backlog.

## Core `.nxlv` sections to add
- `$LEMMING`: pre-placed lemmings with flags (zombie, climber, floater, etc.).
- `$TALISMAN`: goal rules with save requirements, skill limits, time limits, etc.
- `$PRETEXT` / `$POSTTEXT`: story text blocks with hotkey macros.
- `$TERRAINGROUP`: group metadata for visibility, order, and steel-only groups.
- Expanded `$GADGET` fields: custom trigger boxes, resize modes, rotation variants.

## Header and metadata
- `AUTHOR`, `VERSION`, `ID`, `THEME`, `MUSIC`, `BACKGROUND`.
- Additional pack metadata and visibility via `levels.nxmi` and `info.nxmi`.

## Style and asset variants
- Hi-res folders (`style-hr`) and fallback upscaling rules (`upscaling.nxmi`).
- Alias mapping via `alias.nxmi` for piece name migrations.
- Extended object definitions (trigger boxes, sound slots) and terrain flags.

## Validation upgrades
- Talisman constraints (skill caps, save requirements, time).
- Pack-level checks (missing levels in `levels.nxmi`, hidden levels).
- Trigger metadata validation (custom areas, rotation modes).

## Editor UI additions
- Terrain/object group editor with ordering, visibility, and steel grouping.
- Talisman editor with goal previews.
- Pre/Post text editor with macro previews.
- Lemming placement panel with state flags.

## Runtime preview gaps
- Custom trigger areas and rotation modes not supported by classic renderer.
- Gimmicks (zombies, water, clock terrain, etc.) need engine support to preview.

## Phased implementation plan

1. Parser and writer preservation:
   - Parse and round-trip `$LEMMING`, `$TALISMAN`, `$PRETEXT`, `$POSTTEXT`,
     `$TERRAINGROUP`, expanded `$GADGET` fields, `levels.nxmi`, and
     `info.nxmi`.
   - Acceptance: unknown values survive save/export, unsupported sections are
     visible in validation, and classic subset export warnings remain explicit.

2. Data model hard cutover:
   - Add typed model fields for placed lemmings, terrain groups, talismans,
     text blocks, custom trigger boxes, style metadata, and pack metadata.
   - Acceptance: editor state has one canonical owner for each feature; no
     compatibility aliases or duplicate editable paths are introduced.

3. UI editing slices:
   - Add focused panels for terrain-group order/visibility, talisman goals,
     pre/post text, lemming placement flags, custom trigger boxes, and pack
     metadata.
   - Acceptance: unsupported runtime-preview behavior is shown as warning-only
     state beside the relevant controls.

4. Validation and pack tooling:
   - Extend validation reports from classic caps into NeoLemmix metadata,
     cross-level references, missing style aliases, talisman constraints, and
     pack ordering.
   - Acceptance: pack export can emit a single report covering level-level and
     pack-level issues without claiming solver-backed solvability.

5. Runtime preview parity:
   - Implement only the preview/runtime mechanics needed to make the UI truthful:
     placed lemmings, custom trigger areas, rotation variants, zombies/water
     where supported by engine work, and style variant resolution.
   - Acceptance: features without runtime parity stay editable only when the UI
     clearly marks them as preserved/unpreviewed data.

Classic-subset behavior remains the stable baseline throughout these phases.
Expansion work should add explicit unsupported-state warnings before enabling
editing for any feature the runtime cannot preview truthfully.
