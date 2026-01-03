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
