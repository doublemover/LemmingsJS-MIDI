# L2Bitmap C++ program

`docs/camanis/lemmings_2_bitmap_file_format_l2bitmap.cpp.md` is a reference C++ utility for extracting bitmaps from Lemmings 2 data files. It reads palette sections from an external IFF file or `.dat` graphics file, then writes the sprites into a TGA image. The tool defines flags for handling IFF sections, TRIBES format variants and palette offsets. `readSections()` scans the palette file for chunks, `readPalette()` loads color values and `dumpTarga()` outputs a 24‑bit TGA.

The JavaScript side (`js/`) only implements a simple `PaletteImage` and ground renderer for NeoLemmix levels. There is no code for parsing Lemmings 2 bitmap containers or saving TGA files. This C++ example therefore documents features that are not currently in the JS implementation.
