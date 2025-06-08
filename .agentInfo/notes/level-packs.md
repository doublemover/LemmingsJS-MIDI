<<<<<<< tmp_merge/ours_.agentInfo_notes_level-packs.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_level-packs.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_level-packs.md
=======
# Level packs summary

tags: level-packs, resources, doc

`docs/levelpacks.md` describes the repository's level pack layout and how Node
tools consume these resources. Each pack corresponds to a folder or archive with
`LEVEL*.DAT` files plus graphics archives like `VGAGR*.DAT` and `GROUND*.DAT`.
`config.json` lists the packs so the game and tools know where to load assets.

The Node scripts rely on `NodeFileProvider` to read packs from regular
directories or from compressed archives (`.zip`, `.tar.gz`, `.tgz`, `.rar`).
NeoLemmix packs can also be loaded once unpacked to a folder because
`NodeFileProvider` works with plain files.

Tools such as `exportAllPacks.js`, `exportGroundImages.js` or `packLevels.js`
use this provider to export sprites, unpack DAT files or create new archives.
Keeping packs compressed is fine because the provider caches archive entries and
automatically resolves paths listed in `config.json`.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_level-packs.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_level-packs.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_level-packs.md
