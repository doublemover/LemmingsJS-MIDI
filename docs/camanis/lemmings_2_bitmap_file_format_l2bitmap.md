# Lemmings 2 Bitmap File Format (`l2bitmap`)

Source: [camanis.net](https://www.camanis.net/lemmings/files/docs/lemmings_2_bitmap_file_format_l2bitmap.txt)

Lemmings 2 stores various images in a compact bitmap layout. Some of the files are compressed with the `GCSM` signature and must be decompressed (e.g. with Mindless' `lem2zip`) before parsing. The format is similar to style tiles but the bitmap sizes vary and are not stored in the files. Palettes also come from separate `.iff` files.

## Bitmap Layout

Pixels are listed by column groups. First all pixels where `x % 4 == 0` are stored, then `x % 4 == 1`, etc. The pseudocode below illustrates the order:

```text
p = 0
for v = 0 to 3
    for y = 0 to (y_size - 1)
        for x = 0 to (x_size - 1) step 4
            pset((x + v, y), d[p])
            p += 1
        next
    next
next
```

`d` is a byte pointer to the current tile and `pset` writes a pixel.

## Contents

- **font.dat** – practice.iff (1), 102 bitmaps of 16×11
- **panel.dat** – practice.iff (1) subtract 0x80, sizes:
  - 1 bitmap of 32×30
  - 1 bitmap of 32×20
  - 59 bitmaps of 8×8
  - 1 bitmap of 16×9
  - non-bitmap L2SS data (see `l2ss.txt`)
- **pointer.dat** – practice.iff (1) subtract 0x80, 18 bitmaps of 16×16
- **rockwall.dat** – same as `frontend/screens/rockwall.dat`
- **vilscene.dat** – same as `introdat/bckgrnds/vilscene.dat`
- **frontend/screens/award.dat** – award.iff (1), 320×200
- **frontend/screens/end1-5.dat** – end.iff (1), 320×200
- **frontend/screens/map.dat** – map.iff (1), 320×200
- **frontend/screens/menu.dat** – menu.iff (1), 320×200
- **frontend/screens/rockwall.dat** – practice.iff (1), 320×200
- **introdat/bckgrnds/black.dat** – a single black screen, 320×200
- **introdat/bckgrnds/cosyroom.dat** – waking.iff (2), 320×200
- **introdat/bckgrnds/nightvil.dat** – intro.iff (2), 320×200
- **introdat/bckgrnds/vilscene.dat** – talis2.iff (2), 320×200

