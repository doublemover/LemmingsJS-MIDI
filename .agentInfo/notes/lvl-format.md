<<<<<<< tmp_merge/ours_.agentInfo_notes_lvl-format.md
=======
# LVL format highlights

tags: lvl-format, doc, todo

`docs/camanis/lemmings_lvl_file_format.md` mirrors the plain-text spec from Camanis describing the 2048-byte Windows `.lvl` layout.

Notable fields include:
- release rate at `0x0000`
- lemming count and rescue requirement (`0x0002`–`0x0005`)
- time limit (`0x0006`–`0x0007`)
- skill amounts for all eight skills (`0x0008`–`0x0017`)
- start screen X position (`0x0018`–`0x0019`)
- normal and extended graphic set indexes (`0x001A`–`0x001D`)
- a flag at `0x001E`–`0x001F` used for `isSuperLemming`
- tables for objects, terrain and steel at `0x0020`, `0x0120` and `0x0760`
- the 32-byte level name at `0x07E0`

TODOs:
- confirm handling of the extended graphic set
- expose any additional mechanics flags beyond `isSuperLemming`
>>>>>>> tmp_merge/theirs_.agentInfo_notes_lvl-format.md
