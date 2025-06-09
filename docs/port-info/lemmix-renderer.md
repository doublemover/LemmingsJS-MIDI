# Lemmix Renderer Notes

This document summarizes how the original Lemmix game handles rendering of terrain and objects in `Game.Rendering.pas`. The information was compiled from a previous code review and focuses on the terrain and object drawing routines, pixel combination methods, and alpha mask usage.

## Pixel Combination Methods

The renderer defines several procedures used when combining source pixels with the destination world bitmap. These routines set specific bits in the high byte of each pixel to mark terrain or object data.

- **`CombineTerrainDefault`**
  - Overwrites the destination pixel with the source color and sets `ALPHA_TERRAIN`.
- **`CombineTerrainNoOverwrite`**
  - Writes the source pixel only if the destination does not already contain terrain.
- **`CombineTerrainErase`**
  - Clears the destination when the source pixel is nonzero, effectively erasing terrain.
- **`CombineObjectDefault`**
  - Similar to `CombineTerrainDefault` but sets `ALPHA_OBJECT` instead.
- **`CombineObjectNoOverwrite`**
  - Writes the source pixel only when the destination does not already contain object data.

`TPixelCombiner.TerrainDefault` is a simplified example that writes the color and sets the terrain alpha flag.

## Bitmap Preparation

Before drawing, bitmaps are configured with custom pixel combiners based on their drawing flags:

- **`PrepareTerrainBitmap`**
  - Chooses the terrain combining procedure depending on flags such as `tdf_Erase` and `tdf_NoOverwrite`.
- **`PrepareObjectBitmap`**
  - Chooses the object combining procedure based on object drawing flags like `odf_OnlyOnTerrain` or `odf_NoOverwrite`.

Both methods set the bitmap draw mode to `dmCustom` and assign the selected combiner as `OnPixelCombine`.

## Drawing Routines

- **`DrawTerrain`**
  - Loads the terrain bitmap, optionally flips it vertically (`tdf_Invert`), prepares it with `PrepareTerrainBitmap`, and draws it to the world.
- **`DrawObject`**
  - Similar to `DrawTerrain` but for objects, honoring flags for upside‑down rendering.
- **`EraseObject`**
  - Restores original pixels at the object’s location.
- **`Highlight`**
  - Marks pixels that match a mask value, allowing visualization of terrain or object areas.
- **`RenderWorld`**
  - Clears the world, draws all terrains, then draws objects in two passes (those restricted to terrain first). Extended graphics sets may use a prebuilt terrain bitmap here.

## Alpha Mask Bits

The renderer uses high byte flags to classify pixels:

- `ALPHA_TERRAIN` (`$01000000`)
- `ALPHA_OBJECT` (`$02000000`)
- `ALPHA_TRANSPARENTBLACK` (`$80000000`)

The color mask `$80FFFFFF` ensures these bits are preserved when combining pixels. Collision and redraw logic later inspects them to differentiate terrain and objects.

## Summary

`Game.Rendering.pas` orchestrates all terrain and object rendering in Lemmix. By using custom pixel combiners and alpha masks, it tracks which pixels belong to terrain or objects and ensures drawing respects flags like "only on terrain" or "erase". The world is built in two stages—first terrain, then objects—so that object rendering can depend on existing terrain data.
