# L2 savegame format

tags: l2, savegame, doc

`docs/camanis/lemmings_2_save_file_format.md` details the layout of the DOS Lemmings 2 save file. It stores eight slots, each named with 25 bytes followed by 482 bytes of data. Each slot holds 12 tribe records in order Classic through Sports, containing the number saved, two unknown bytes and a medal value. A final field notes the last tribe played.

TODO: add loader and writer to persist progress; investigate the two unknown fields.
