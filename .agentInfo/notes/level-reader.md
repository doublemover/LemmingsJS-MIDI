<<<<<<< tmp_merge/ours_.agentInfo_notes_level-reader.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_level-reader.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_level-reader.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_level-reader.md
=======
# LevelReader

tags: level-parsing

`js/LevelReader.js` consumes a 2048 byte `.DAT` level file. The first 0x20 bytes contain the release rate, lemming counts, time limit and skill amounts followed by the start X position and graphics set indices. The remainder of the file is split into several tables:

- **Objects (0x0020..0x011F)** – 32 records of 8 bytes. Each entry provides an X/Y coordinate, object id and flag word. Flags are decoded into `DrawProperties` (flip, no-overwrite, only-overwrite). Empty records have all zero flags.
- **Terrain (0x0120..0x075F)** – 400 records of 4 bytes. A packed 32‑bit value stores X, Y, id and flags. Flags control erase mode, upside‑down drawing and the overwrite behavior. Y coordinates are signed.
- **Steel areas (0x0760..0x07DF)** – 32 entries describing rectangular steel zones. Two bytes pack X and Y in 8‑pixel steps, the third encodes width/height in 4‑pixel blocks. LevelReader adjusts the origin based on whether the level came from LemEdit.
- **Level name (0x07E0..0x07FF)** – ASCII string padded with zeros.

These structures populate the `objects`, `terrains` and `steel` arrays on the resulting LevelReader instance.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_level-reader.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_level-reader.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_level-reader.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_level-reader.md
