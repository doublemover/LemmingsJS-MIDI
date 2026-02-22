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

## Runtime Startup Profiles

The browser runtime also supports URL startup profiles:

- `profile=gameplay` (default): normal gameplay startup behavior.
- `profile=editor`: boots gameplay once, then enters editor mode and loads the selected level into the editor.
- `profile=perf`: enables perf-focused runtime defaults (`performanceAPI=true` and `perfOverlay=true`).

Short alias: `pr=<gameplay|editor|perf>`.

## Bench Profiles

`scripts/bench-performance.js` supports benchmark profiles:

- `--profile=default`: sequence benchmark with perf instrumentation.
- `--profile=stress`: high-entity stress run (`bench2` path).
- `--profile=reverse`: sustained reverse-playback stress run.

Overrides (`--mode`, `--duration`, `--sample`, `--entrances`) still apply per run.
