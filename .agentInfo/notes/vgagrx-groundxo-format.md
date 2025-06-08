<<<<<<< tmp_merge/ours_.agentInfo_notes_vgagrx-groundxo-format.md
=======
# VGAGR/GROUND format note

tags: vgagrx, groundxo, planar-bitmaps

The `docs/camanis/lemmings_vgagrx_dat_groundxo_dat_file_format.md` reference explains how terrain and object
bitmaps are stored in the `VGAGR?.DAT` archives and described by
`GROUND?O.DAT`.  Each bitmap uses **4-bit planar** data: four monochrome planes
are laid out next to each other.  The first plane holds the low bit of every
pixel, the second the next higher bit and so on, effectively encoding one
16‑color bitmap.  Planes appear in little‑endian order so the first adds `1` to
a color index, the next adds `2`, then `4`, then `8`.  Masks are stored
separately as 1‑bit bitmaps and, for terrain images, the final color plane
usually duplicates the mask.

`GroundReader` already decodes these planar images via `PaletteImage.processImage()`.
However the loader still reads the mask plane from a separate offset rather than
reusing the fourth plane for terrain.  The reference hints at extra bitmaps in
`VGAGR?.DAT` which are currently ignored by the code.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_vgagrx-groundxo-format.md
