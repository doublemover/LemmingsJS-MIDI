# NeoLemmix Pack Toolkit overview

This document summarizes the capabilities of the **NeoLemmix Pack Toolkit** ("Flexi Toolkit") and how the output folders map to this repository.

The Toolkit bundles custom levels and resources into a distributable pack playable on the NeoLemmix engine.  Packs are built in a project directory that mirrors the final layout.

## Key features

- **Levels and ranks** – add `.lvl` files and organize them into up to 15 ranks. Preview and postview texts can be attached per level.
- **Custom graphics** – include graphic set `.DAT` files or download sets from the web. Special VGASPEC files are supported.
- **Music rotation** – import tracks in formats like OGG, IT, MOD, XM, MP3 or WAV and configure the play order. Large files are typically distributed separately.
- **Menu art** – customize title logos, background, rank signs, skill panel images, fonts and icons. Images use 32‑bit PNGs; optional mask files apply palette recoloring.
- **Lemming sprites** – supply new sprite sheets and accompanying `scheme.nxmi` files as custom data files.
- **Talismans** – define optional achievements per level with bronze, silver or gold tiers.
- **Replay manager** – maintain replays for each level and export them in bulk.
- **Issue checker** – verify that graphic sets, music and level formats are correct.
- **Build NXP** – save the project and choose “Build NXP” to create a single package for distribution.

Advanced tutorials describe how to modify files directly. The Toolkit saves
`SYSTEM.DAT`, `TALISMAN.DAT`, level files in a `levels/` folder, replays in `replays/`, custom images as PNGs and arbitrary files under `files/`.

## Relation to this repository

Each level pack directory in the repo (`lemmings/`, `lemmings_ohNo/`, `xmas91/`, `xmas92/`, `holiday93/`, `holiday94/`) contains files extracted from its original game or pack archive. The folders follow the general NeoLemmix layout described in [docs/levelpacks.md](docs/levelpacks.md) so the Node tools can load them via `NodeFileProvider`. `config.json` lists the packs and their level orders.

Custom graphics, music and sprites may be replaced in these folders if you
wish to experiment with your own pack built from NeoLemmix assets.
