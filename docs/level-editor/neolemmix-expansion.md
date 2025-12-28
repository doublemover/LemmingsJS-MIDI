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

## Suggested phasing
1. Parser/writer expansion for the new sections.
2. Editor data model additions + UI panels.
3. Validation + pack metadata tooling.
4. Runtime preview parity work.
