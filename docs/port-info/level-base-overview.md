# `Level.Base.pas` Overview

This document summarizes key structures and flags from the Pascal
implementation found in the Lemmix project (`src/Level.Base.pas`).

## Drawing Flags

Two sets of flags control special rendering behavior.

### Terrain Drawing Flags (`tdf_`)

| Flag            | Bit | Effect                                   |
|-----------------|-----|------------------------------------------|
| `tdf_Erase`     | 0   | Terrain acts as an eraser                 |
| `tdf_Invert`    | 1   | Invert terrain bitmap                     |
| `tdf_NoOverwrite` | 2 | Do not overwrite existing terrain pixels  |

### Object Drawing Flags (`odf_`)

| Flag                | Bit | Effect                                   |
|---------------------|-----|------------------------------------------|
| `odf_OnlyOnTerrain` | 0   | Draw only where terrain exists            |
| `odf_UpsideDown`    | 1   | Flip the object vertically                |
| `odf_NoOverwrite`   | 2   | Avoid overwriting existing pixels         |

## Records and Classes

### `TLevelInfo`

Stores the main level parameters.

- Release rate
- Lemming counts (total and required)
- Time limit
- Skill counts (Climber, Floater, Bomber, Blocker, Builder, Basher,
  Miner, Digger)
- Graphic set indexes (`GraphicSet` and `GraphicSetEx`)
- SuperLemming mode
- Screen starting position
- Level title

### `TTerrain`

Descends from `TIdentifiedPiece` and includes a `DrawingFlags` byte
using `tdf_` constants.

### `TInteractiveObject`

Also a `TIdentifiedPiece`. Its `DrawingFlags` byte uses the `odf_`
constants.

### `TSteel`

Represents a rectangular steel region. Stores `Width` and `Height`.

### `TLevel`

Container for an entire level.

- Holds a `TLevelInfo` instance
- Lists of terrains (`TTerrains`), interactive objects
  (`TInteractiveObjects`), and steel areas (`TSteels`)
- Constructor initializes these lists using helper methods
- Destructor frees them
- `ClearLevel` empties all lists

## Saving

`SaveToFile` opens a `TBufferedFileStream` and calls `SaveToStream`.
`SaveToStream` currently raises a "not implemented" exception and serves
as a placeholder for serialization logic.

