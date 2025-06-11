# Graphics32 Integration

This note summarises how the original Pascal **Lemmix** project embeds the [Graphics32](https://github.com/graphics32/graphics32) library and why it was chosen.

## Why Graphics32?

Graphics32 provides fast 32‑bit pixel access and drawing primitives that outperform the classic `TCanvas` classes. The renderer relies on efficient per‑pixel operations to blend terrain and object bitmaps and to store extra information in each pixel's alpha channel. Using Graphics32 simplifies these tasks and keeps the code portable between Delphi versions.

## Submodule setup

The Lemmix source tree includes the library as a Git submodule named `graphics32`. The checked‑in commit (`b154583e`) adapts `GR32_Compiler.inc` for the project's compiler settings. No other files from the library appear modified.

To build the Pascal version you must initialise the submodule:

```bash
git submodule update --init
```

Delphi's search path is set to include the `graphics32` directory via `Lemmix.dproj`:

```xml
<DCC_UnitSearchPath>Graphics32;$(DCC_UnitSearchPath)</DCC_UnitSearchPath>
```

## Rendering behaviour

Lemmix stores custom flags in the high bits of each `TColor32` pixel. `Game.Rendering.pas` prepares each bitmap with `dmCustom` draw mode and assigns an `OnPixelCombine` handler so that drawing terrain or objects sets these bits appropriately:

```pascal
Bmp.DrawMode := dmCustom;
Bmp.OnPixelCombine := CombineTerrainDefault; // or variant
```

Terrain pixels receive `ALPHA_TERRAIN` and object pixels get `ALPHA_OBJECT`. `Dos.Bitmaps.pas` uses Graphics32's `TByteMap` to convert planar bitmaps into color indexes:

```pascal
{...} We use the Graphics32 TByteMap for that.
```

Object collision maps are also stored as `TByteMap`, written by `InitializeObjectMap` in `Game.pas`.

## Custom build steps

Aside from the submodule checkout there are no extra build steps for Graphics32. The normal project compilation links against the library directly. Resource archives are compiled separately via `Data/BuildResources.bat`.

