# Lemmings 3 level format note

tags: level-format, l3, doc

`docs/camanis/lemmings_3_level_file_format.md` documents the tiny header used by Lemmings 3. Each field is a little-endian word except where noted. Levels reference two `.OBS` files for permanent and temporary objects and include a few extra parameters such as **extra lemmings** and **number of enemies**.

Compared to the Lemmings 2 (`L2LV`) format:

- L2 stores data in IFF-style sections (`L2LH`, `L2MH`, `L2MP`, `L2BO`) with big-endian sizes, while L3 uses a flat header followed by object tables.
- L2 embeds all terrain and objects in one file; L3 splits destroyable and permanent objects into separate `.OBS` files.
- L2 object entries are 10 bytes with parameters for steel blocks or chains; L3 objects only need id and coordinates.
- L3 adds a lemming style separate from the level style plus a release delay and enemy count.

Features potentially worth porting include the extra‑lemming count and release delay fields for richer level scripting, and enemy objects if support is added later.
