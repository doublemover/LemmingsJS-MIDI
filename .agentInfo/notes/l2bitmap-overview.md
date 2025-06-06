# L2Bitmap format overview

tags: l2bitmap, file-format, bitmap, doc

`docs/camanis/lemmings_2_bitmap_file_format_l2bitmap.md` describes the small `.l2bitmap` container used by Lemmings 2 for fonts and other images. It notes that many of these `.dat` files start with a `GCSM` compression header and must be decompressed with **lem2zip**. Pixels are stored as palette indices arranged in four-column groups (0,4,8 … 1,5,9 …) before reading by row. The document now includes a table listing each archive, its palette source and the bitmap sizes.
