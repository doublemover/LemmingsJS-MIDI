# GameResources note

tags: resources, caching

`GameResources` centralizes asset loading. `getMainDat()` fetches `MAIN.DAT` only once using `FileProvider` and caches the resulting Promise. The buffer is wrapped in `FileContainer` so the code can pull out individual parts.

`GameResources` also exposes the `mechanics` object parsed from the configuration. These settings are copied to each `Level` via `LevelLoader`.

Sprite helpers call `getMainDat()` and pass specific parts to sprite classes, e.g. part 0 for lemming sprites and parts 2 & 6 for the skill panel. The cursor sprite is built from part 5 using `PaletteImage`.

`getLevel()` instantiates `LevelLoader`, which handles the detailed level fetch logic and returns a populated `Level` instance.
