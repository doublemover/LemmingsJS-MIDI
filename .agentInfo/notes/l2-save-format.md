# L2 savegame format

tags: l2, savegame, doc, todo

`docs/camanis/lemmings_2_save_file_format.md` explains the DOS savegame layout. A file begins with an array of eight slot names (25 bytes each) followed by eight matching data blocks (482 bytes each).

Each slot stores progress for all twelve tribes:
- 12 records keep the number rescued, two unknown bytes and the medal earned.
- A final 16-bit field notes the last tribe played.

TODO: implement a loader and writer for these files; figure out the meaning of the two unknown bytes in each tribe record.
