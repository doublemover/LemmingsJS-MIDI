# Lemmix Resource Packaging

This note explains how the original Pascal version packages game assets into `.RES` files and how the JavaScript port loads the same resources without a compile step.

## Pascal build process

Lemmix stores all graphics, sound effects and style files under a `Data` directory. Each subfolder contains a ZIP archive and a matching `.rc` file referencing it as `RCDATA`:

```rc
CURSORS RCDATA "Cursors.zip"
```

`BuildResources.bat` runs `brcc32.exe` on each `.rc` file to produce `.RES` files:

```bat
brcc32.exe -fo .\Misc.RES .\Misc\Misc.rc
brcc32.exe -fo .\Cursors.RES .\Cursors\Cursors.rc
...
```

`lem_resources.inc` includes these resources so the Delphi compiler links them directly into the executable:

```pascal
{$resource '.\Data\Misc.RES'}
{$resource '.\Data\Cursors.RES'}
{$resource '.\Data\Orig.RES'}
```

## JavaScript approach

This repository keeps the original data files unpacked inside folders such as `lemmings/` and `xmas91/`. Instead of `.RES` files the engine loads assets at runtime using `NodeFileProvider`, which can read from directories or archives (`.zip`, `.tar.gz`, `.rar`). Packs are listed in `config.json` and follow the layout described in [docs/levelpacks.md](../levelpacks.md).

No compilation is required—assets remain editable, and tools under `tools/` operate on the raw DAT files. When running in Node, `NodeFileProvider` locates files on disk or inside archives.

## Custom assets

To add custom music or graphics, create a new pack folder and place files under `music/`, `styles/`, `sprites/` and other subdirectories. You can keep the folder zipped (e.g. `myPack.zip`) and `NodeFileProvider` will still locate the contents. Update `config.json` with the pack path so the game can load it.

Music tracks may be OGG, IT, MOD, XM or WAV. Graphic sets use the same DAT or VGASPEC formats as NeoLemmix. Because resources are not baked into `.RES` files you can swap them without rebuilding.

