<<<<<<< tmp_merge/ours_.agentInfo_notes_l2ss-overview.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_l2ss-overview.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_l2ss-overview.md
=======
# L2SS sprite format overview

tags: l2ss, sprite-chunks, doc

`docs/camanis/lemmings_2_sprite_file_format_l2ss.md` explains the sprite container used by Lemmings 2. The file is IFF-based and splits data into these sections:
- **L2SS**: frame graphics with four pixel layers.
- **L2SF**: frame positions referencing L2SS entries.
- **L2SA**: lists of frame offsets for animations.
- **L2SI**: pointers to the animation lists.
- **L2PD**/**L2PI**: palettes and palette pointers.
- **L2TM**/**L2TI**: text data and pointers.

Appendix A describes how each pixel layer encodes runs of color indices. The document notes stripped/raw/VLEMMS variants, which this project does not yet parse. The effect of opcode `H>=8; H!=e; L>=8` remains unknown.

>>>>>>> tmp_merge/theirs_.agentInfo_notes_l2ss-overview.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_l2ss-overview.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_l2ss-overview.md
