# Lemmings 2 Bitmap File Format (`l2bitmap`)

This document summarizes the standalone bitmap container used by Lemmings 2. The format stores fonts, mouse pointers and full-screen images that are loaded outside of the regular style files. Many of these `.dat` archives are compressed with the `GCSM` header described in the main compression document.

## Decompression

Files beginning with the four-byte `GCSM` signature must be decompressed before any bitmap data can be read. Mindless' **lem2zip** utility handles these archives. See [compression-format.md](../compression-format.md) for the exact algorithm.

## Bitmap Layout

Each bitmap is a sequence of palette indices rather than raw RGB values. Pixels are arranged in four interleaved columns: all bytes for column `x = 0 mod 4` come first, followed by the bytes for `x = 1 mod 4`, then `x = 2 mod 4` and finally `x = 3 mod 4`. For every column group the rows are stored from top to bottom. The following pseudocode from Mindless shows the mapping:

```
p = 0
for v = 0..3
  for y = 0..(height-1)
    for x = 0..(width-1 step 4)
      setPixel(x + v, y, data[p])
      p += 1
```

## Contents

The known bitmap archives and their palettes are:

| File | Palette source (ID) | Bitmap count / size | Notes |
| ---- | ------------------ | ------------------- | ----- |
| `font.dat` | `practice.iff` (ID 1) | 102 bitmaps of 16×11 | |
| `panel.dat` | `practice.iff` (ID 1), subtract 0x80 | 1×32×30, 1×32×20, 59×8×8, 1×16×9 | Includes non-bitmap `L2SS` data |
| `pointer.dat` | `practice.iff` (ID 1), subtract 0x80 | 18 bitmaps of 16×16 | |
| `rockwall.dat` | same as `frontend/screens/rockwall.dat` | 320×200 | |
| `vilscene.dat` | same as `introdat/bckgrnds/vilscene.dat` | 320×200 | |
| `frontend/screens/award.dat` | `award.iff` (ID 1) | 320×200 | |
| `frontend/screens/end1-5.dat` | `end.iff` (ID 1) | 320×200 | |
| `frontend/screens/map.dat` | `map.iff` (ID 1) | 320×200 | |
| `frontend/screens/menu.dat` | `menu.iff` (ID 1) | 320×200 | |
| `frontend/screens/rockwall.dat` | `practice.iff` (ID 1) | 320×200 | |
| `introdat/bckgrnds/black.dat` | (solid black) | 320×200 | |
| `introdat/bckgrnds/cosyroom.dat` | `waking.iff` (ID 2) | 320×200 | |
| `introdat/bckgrnds/nightvil.dat` | `intro.iff` (ID 2) | 320×200 | |
| `introdat/bckgrnds/vilscene.dat` | `talis2.iff` (ID 2) | 320×200 | |

