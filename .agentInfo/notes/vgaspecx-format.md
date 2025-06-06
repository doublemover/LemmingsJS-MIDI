# vgaspecX.dat format

tags: vgaspecx, compression, palette, doc, todo

`docs/camanis/lemmings_vgaspecx_dat_file_format.md` explains the special graphics packs used by some DOS levels. A `vgaspecX.dat` file decompresses into a single block, then a second byte‑level scheme splits that block into four planar bitmaps.

Key points:

* First 24 bytes hold 8 VGA palette entries applied to colors 8–15.
* The next 16 bytes likely store EGA palette data but the details are unclear.
* Second‑level compression uses raw chunks, runs and a `0x80` end marker.
* After decompression there are four 14,400‑byte sections (one quarter of a 960×160 image) stored as 3‑bpp planes.
* Colors map as `0 -> 0` and `1-7 -> 9-15`.

TODO:

* Verify how the 16 EGA bytes are used.
* Check whether terrain placement depends on the level's starting X position.
