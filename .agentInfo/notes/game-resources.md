# GameResources note

tags: resources, caching

`GameResources` centralizes asset loading. `getMainDat()` fetches `MAIN.DAT` only once using `FileProvider` and caches the resulting Promise. The buffer is wrapped in `FileContainer` so the code can pull out individual parts.

`GameResources` also exposes the `mechanics` object parsed from the configuration. These settings are copied to each `Level` via `LevelLoader`.

Sprite helpers call `getMainDat()` and pass specific parts to sprite classes, e.g. part 0 for lemming sprites and parts 2 & 6 for the skill panel. The cursor sprite is built from part 5 using `PaletteImage`.

`getLevel()` instantiates `LevelLoader`, which handles the detailed level fetch logic and returns a populated `Level` instance.

The holiday packs share some graphics files. For example the `xmas92` entry in
`config.json` reuses `VGAGR0.DAT` from `xmas91`. Copying that file or pointing
the config to `xmas91` avoids 404 errors when the loader requests missing
assets.

The cursor graphic from `MAIN.DAT` uses a 16×16 `PaletteImage`. A 17×17 size causes smearing at the edges.
