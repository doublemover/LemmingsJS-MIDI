# Lemmings 2 save format

tags: l2-save, doc, todo

The Camanis document `docs/camanis/lemmings_2_save_file_format.md` describes the DOS savegame layout. Each save file holds **eight slots**. Every slot has a 25-byte name followed by 482 bytes of data. The data starts with an array of 12 tribe records (40 bytes each) ordered as listed in Appendix A. Each record stores the number of lemmings rescued, two unknown bytes and the medal earned (Appendix B). After the tribe records comes a 2-byte little-endian index of the last tribe played.

There is currently no code in this repository to read or write these save files. Implementing L2 save support and understanding the unknown fields is left as future work.
