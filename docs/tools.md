# Tools

This document describes the Node.js scripts found in the `tools` directory. These utilities help export,
patch and package game assets.  Sprite exports now write **32‑bit PNGs** with
alpha channels. If a pack includes a `styles/<set>-hr/` folder the tools
automatically pick these double-resolution images.  Standard-resolution sprites
remain available for older packs.

All scripts accept paths to level packs. A pack can be a folder or an archive
(`.zip`, `.tar`, `.tar.gz`, `.tgz`, or `.rar`). The `NodeFileProvider` class lets
the tools read from these sources without extracting them first.

## exportAllPacks.js

```
node tools/exportAllPacks.js [pack1 pack2 ...]
```

Exports panel, lemming and ground sprites for each pack. If no pack names are
provided it reads `config.json` to determine pack paths. Assets are saved in
`exports/export_<pack>` directories.

## exportAllSprites.js

```
node tools/exportAllSprites.js [packPath] [outDir]
```

Exports the skill panel, lemming animations and ground object sprites for a
single pack. `packPath` defaults to the first entry in `config.json`. Output goes
to `outDir` (`exports/<pack>_all` by default).

## exportPanelSprite.js

```
node tools/exportPanelSprite.js [packPath] [outDir]
```

Saves the skill panel background as `panelSprite.png`.

## exportLemmingsSprites.js

```
node tools/exportLemmingsSprites.js [packPath] [outDir]
```

Exports every lemming animation as individual PNGs plus sprite sheets. The files
are placed in `outDir` (`exports/<pack>_sprites` by default).

## exportGroundImages.js

```
node tools/exportGroundImages.js [packPath] [groundIndex] [outDir]
```

Writes terrain and object images from one ground set to PNGs. `groundIndex`
selects the `GROUND?O.DAT` and `VGAGR?.DAT` pair.

## listSprites.js

```
node tools/listSprites.js [packPath] [--out file]
```

Lists sprite names, dimensions and frame counts. Use `--out` to write the list
to a file instead of stdout.

## patchSprites.js

```
node tools/patchSprites.js [--sheet-orientation=horizontal|vertical] <target DAT> <png dir> <out DAT>
```

Replaces sprites in an existing DAT archive with PNG data. Multiple frames can
be supplied as a sprite sheet when `--sheet-orientation` matches the sheet
layout.  The patched DAT supports **true‑color** PNGs, so edits may include
alpha transparency and any palette.  High-resolution sprites simply use larger
PNG files and follow the same naming conventions.

## packLevels.js

```
node tools/packLevels.js <level dir> <out DAT>
```

Compresses a directory of 2048 byte `.lvl` files into a single DAT file. Useful
for building custom level packs.

## archiveDir.js

```
node -e "import('./tools/archiveDir.js').then(m => m.archiveDir('dir', 'zip'))"
```

Utility function to create `.zip`, `.tar.gz` or `.rar` archives from a folder.

## cleanExports.js

```
node tools/cleanExports.js
```

Removes all `export_*` directories created by the other scripts.

---

Exported assets now live under the `exports/` directory. The game can load levels
directly from packed archives, so you may keep your level packs compressed while
still running these tools.  See [`highres-migration.md`](highres-migration.md)
for guidelines on upgrading packs to the new sprite format.
