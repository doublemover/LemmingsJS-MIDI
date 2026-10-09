# Level Editor Runtime Preview

## Overview

Editor preview uses classic engine rendering. Editor data is converted to classic runtime data and loaded into the engine, then the game timer is suspended.

## Conversion pipeline

1. `EditorLevel` -> classic `levelReader` data:
   - `WIDTH/HEIGHT` -> `Level` size.
   - `STYLE` -> `graphicSet1` (ground set ID).
   - Terrain/gadgets -> `LevelElement` list.
   - Skill counts -> classic skill array.
2. `GroundReader` loads terrain/object assets for the ground set.
3. `GroundRenderer` composes the ground image from terrain entries.
4. `Level` is initialized with objects, triggers, palettes, and steel ranges.

## Refresh strategy

- Preview reloads when editor data changes.
- Reloads are debounced to avoid thrashing during drag operations.
- The game timer is suspended after each preview refresh.
- Preview reloads preserve the current viewport unless loading/importing a level.

## Rendering overlays

- Selection outlines and tool previews are drawn on top of the level preview.
- The overlay system does not modify the ground image directly.

## Performance considerations

- Preview reloads are safe but avoid reloading on every mouse move.
- Debounced refresh allows smooth drag while preserving accurate preview updates.

## Source images and editor round trips

Palette previews and selection bounds use the same source-scale sampling as the ground renderer. Indexed and RGBA Frame sources retain their exact visible colors and occupancy; transparent pixels remain transparent in thumbnails. RGBA frame mutation versions and source-scale changes invalidate cached previews. Old thumbnail entries use a separate cache version.

Converting runtime terrain back to editor text now retains implemented horizontal flips. Terrain factories also preserve supplied rotation metadata, while rotation, piece resizing, one-way terrain eligibility and gadget transforms remain stored without runtime implementation. Classic LVL export still reports these unsupported properties; the source-format contract must be specified before those controls can be enabled.
