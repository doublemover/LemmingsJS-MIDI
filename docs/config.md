# Configuration Reference

`config.json` defines the level packs that the game can load. Each entry contains several required fields and an optional `mechanics` object. Defaults for the mechanics flags are defined in `js/packMechanics.js` and merged with the pack entries when the game starts.

## Fields

- `name` – Human readable pack name used in menus.
- `path` – Folder containing the pack resources.
- `gametype` – Key from `GameTypes` identifying the pack.
- `level.filePrefix` – Prefix for level filenames such as `LEVEL` or `DLVEL`.
- `level.groups` – Ordered list of rank names within the pack.
- `level.order` – Array of arrays listing level numbers for each rank.
- `level.useOddTable` – Set to `true` when the pack uses an ODDTABLE resource.
- `mechanics` *(optional)* – Object of gameplay flags that override or extend the defaults.

`packMechanics.js` supplies defaults like `classicBuilder` or `bomberAssist` for each pack. `ConfigReader` merges these defaults with the `mechanics` object from `config.json` so game code only needs to consult a single merged `mechanics` field.
