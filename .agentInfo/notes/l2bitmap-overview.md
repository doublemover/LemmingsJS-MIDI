# L2Bitmap overview

tags: l2bitmap, doc

`docs/camanis/lemmings_2_bitmap_file_format_l2bitmap.md` summarizes the bitmap layout used by many Lemmings 2 files. Images are stored in an unusual column-based order and rely on external palettes from `.iff` files. Some data chunks are compressed with a `GCSM` header and need `lem2zip` for decompression. The doc lists palette sources and dimensions for each `.dat` file.

### TODOs

- Write a parser that reads the column-major format and applies the chosen palette.
- Support automatic `GCSM` decompression when loading `.dat` resources.
- Add tests verifying that decoded images match the reference PNGs from camanis.net.
