# Config files overview

tags: config, mechanics, doc

`config.json` lists available level packs and key fields like `level.filePrefix`, `level.groups` and `level.order`. Each pack may also include a `mechanics` object. `packMechanics.js` provides defaults for these mechanic flags which `ConfigReader` merges with the pack entries. See [docs/config.md](../docs/config.md) for a full description.
