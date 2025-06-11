# DOS Resource Handling

This note explains how the original **Lemmix** engine loaded graphics and level data from the DOS `.DAT` files. It summarizes the key Pascal units and points to the JavaScript equivalents used in this port.

## Relevant Pascal units

- `Dos.Compression.pas` – decompression and helper classes.
- `Dos.Structures.pas` – structures for level records and ground metadata.
- `Dos.MainDat.pas` – wrapper for extracting sprites from `MAIN.DAT`.
- `Dos.Bitmaps.pas` – routines to read planar bitmaps and VGASPEC files.

## Compression header

Every section inside a DOS `.DAT` file begins with a 10‑byte header. The fields are defined in `TCompressionHeaderRec`:

```pascal
TCompressionHeaderRec = packed record
  BitCnt            : Byte;
  Checksum          : Byte;
  Unused1           : Word;
  DecompressedSize  : Word;
  Unused2           : Word;
  CompressedSize    : Word;
end;
```

Values are stored big‑endian and must be byte‑swapped on load. `CompressedSize` includes the header itself. The decompressor reads backwards using the initial bit count in `BitCnt`.

| Field | Size (bytes) | Notes |
|-------|--------------|------|
| `BitCnt` | 1 | Bits left in the first byte |
| `Checksum` | 1 | XOR of the compressed stream |
| `DecompressedSize` | 2 | Size after decompression (big‑endian) |
| `CompressedSize` | 2 | Total bytes including the 10‑byte header (big‑endian) |

`Dos.Compression.pas` implements `TDosDatDecompressor` which reads these headers and fills `TDosDatSection` objects. The algorithm copies raw bytes or repeated references depending on the op‑codes. JavaScript mirrors this behaviour in `UnpackFilePart` and `BitReader`.

## Section lists

`TDosDatSectionList` keeps multiple `TDosDatSection` entries in memory. `TDosDatDecompressor.LoadSectionList` reads all sections from a stream and optionally decompresses them immediately. In the port `FileContainer` performs the same role and parses each section using `UnpackFilePart`.

```javascript
// js/FileContainer.js
part.initialBufferLen = fileReader.readByte();
part.checksum = fileReader.readByte();
part.decompressedSize = fileReader.readWord();
...
```

## Level structures

`Dos.Structures.pas` defines the 2048‑byte level format used by classic `.LVL` files. Important constants are:

```pascal
const
  LVL_MAXOBJECTCOUNT  = 32;
  LVL_MAXTERRAINCOUNT = 400;
  LVL_MAXSTEELCOUNT   = 32;
```

A simplified view of `TLVLRec` is shown below (all words are big‑endian):

```pascal
TLVLRec = packed record
  ReleaseRate   : Word;
  LemmingsCount : Word;
  RescueCount   : Word;
  TimeLimit     : Word;
  ClimberCount  : Word;
  FloaterCount  : Word;
  BomberCount   : Word;
  BlockerCount  : Word;
  BuilderCount  : Word;
  BasherCount   : Word;
  MinerCount    : Word;
  DiggerCount   : Word;
  ScreenPosition: Word;
  GraphicSet    : Word;
  GraphicSetEx  : Word;
  Reserved      : Word; // $FFFF for SuperLemming
  Objects       : array[0..31] of TLVLObject;
  Terrain       : array[0..399] of TLVLTerrain;
  Steel         : array[0..31] of TLVLSteel;
  LevelName     : TLVLTitle;
end;
```

These records are parsed by `LevelReader.js` which translates them to modern objects. Big‑endian fields are swapped using `BinaryReader.readWord()`.

Ground metadata for `GROUNDxO.DAT` is stored in `TDosMetaObject` and `TDosMetaTerrain` arrays. Palettes are eight or sixteen entries of 6‑bit color values which are scaled to 8‑bit in `DosVgaPalette8ToLemmixPalette`.

## MAIN.DAT extraction

`TMainDatExtractor` wraps a `TDosDatDecompressor` and exposes helpers like `ExtractLogo` and `ExtractBrownBackGround`. It lazily decompresses a section when accessed. The JavaScript class `GameResources` performs similar extraction using `FileContainer.getPart()` and `PaletteImage` helpers.

## Planar bitmaps and VGASPEC

`TDosPlanarBitmap` converts planar images to a byte map and ultimately to a `TBitmap32`. The JavaScript loader uses `PaletteImage` to decode planar data into a `Frame` object. `VGASpecReader.js` handles the special ground images with an RLE‑like format and reads palettes the same way.

## Porting considerations

- **Endian handling**: DOS files store many values big‑endian. Both Pascal and JavaScript swap bytes when reading.
- **Checksum**: the decompressor verifies a simple XOR checksum. The JS implementation logs a mismatch instead of throwing.
- **Palette scaling**: 6‑bit VGA colors are multiplied by four to reach the 0‑255 range.
- **Data layout**: structures such as `TLVLRec` use packed records; when porting ensure alignment does not introduce padding.

Overall the port mirrors the original structure: compressed sections parsed into parts, planar graphics expanded, and level metadata converted into game objects.
