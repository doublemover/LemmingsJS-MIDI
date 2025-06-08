<<<<<<< tmp_merge/ours_.agentInfo_notes_l2bitmap-overview.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_l2bitmap-overview.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_l2bitmap-overview.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_l2bitmap-overview.md
=======
# L2Bitmap format overview

tags: l2bitmap, file-format, bitmap, doc

`docs/camanis/lemmings_2_bitmap_file_format_l2bitmap.md` describes the small `.l2bitmap` container used by Lemmings 2 for fonts and other images. It notes that many of these `.dat` files start with a `GCSM` compression header and must be decompressed with **lem2zip**. Pixels are stored as palette indices arranged in four-column groups (0,4,8 … 1,5,9 …) before reading by row. The document now includes a table listing each archive, its palette source and the bitmap sizes.

# L2Bitmap overview

tags: l2bitmap, doc

`docs/camanis/lemmings_2_bitmap_file_format_l2bitmap.md` summarizes the bitmap layout used by many Lemmings 2 files. Images are stored in an unusual column-based order and rely on external palettes from `.iff` files. Some data chunks are compressed with a `GCSM` header and need `lem2zip` for decompression. The doc lists palette sources and dimensions for each `.dat` file.

### TODOs

- Write a parser that reads the column-major format and applies the chosen palette.
- Support automatic `GCSM` decompression when loading `.dat` resources.
- Add tests verifying that decoded images match the reference PNGs from camanis.net.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_l2bitmap-overview.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_l2bitmap-overview.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_l2bitmap-overview.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_l2bitmap-overview.md
