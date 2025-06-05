# Tool scripts overview

tags: tools, cli

The `tools/` directory contains small command-line utilities for working with level packs and sprites.

- **exportAllPacks.js** – loops over packs defined in `config.json` and runs `exportAllSprites.js` for each. Each pack is exported into an `export_<pack>` folder. You can also pass pack paths via command line.
- **exportAllSprites.js** – exports skill panel, lemming and object sprites from a pack to PNG files. Usage: `node tools/exportAllSprites.js <pack dir> <out dir>`. Relies on `NodeFileProvider` to read data files from folders or archives.
- **packLevels.js** – packs a directory of 2048 byte level files into a single DAT. Usage: `node tools/packLevels.js <level dir> <out DAT>`.
- **renderCursorSizes.js** – outputs the cursor sprite rendered at all width/height pairs from 4×4 to 16×16. Usage: `node tools/renderCursorSizes.js [pack] [out dir]`.

Most export scripts instantiate `NodeFileProvider` so they can read level packs from plain directories or archives like `.zip`, `.tar.gz`, or `.rar`. Keep pack archives next to the repo and the provider will find files automatically.
