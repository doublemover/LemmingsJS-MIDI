<<<<<<< tmp_merge/ours_.agentInfo_notes_l2-level-format.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_l2-level-format.md
=======
# Lemmings 2 level file format

tags: l2-level-format, doc, level-format

`docs/camanis/lemmings_2_level_file_format.md` contains the full dump of the uncompressed format used by Lemmings 2. A level starts with a RIFF style header (`FORM` / `L2LV`) followed by four sections:

- **L2LH** – general data including the level name, skill IDs and counts, time limit, screen positions and cut‑off values, style and release rate.
- **L2MH** – map header describing the tiles per row and a second style value that actually influences graphics.
- **L2MP** – terrain entries, each four bytes long with a background/foreground flag and tile id.
- **L2BO** – object records containing id, position and extra counts for steel pieces or chains.

Our current `LevelReader` only understands the original Lemmings `.DAT` layout (see `js/LevelReader.js`). It lacks fields such as style identifiers, screen cut‑offs, allowed deaths before gold, and the extra object counts present in the L2 format. It also does not parse skill ID tables or the map header section.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_l2-level-format.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_l2-level-format.md
