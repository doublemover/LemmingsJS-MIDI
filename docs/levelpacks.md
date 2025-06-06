# Level pack folder layout

This document summarizes the typical folder structure used for NeoLemmix-style level packs. Each pack lives in its own directory so that Node tools can read the resources directly from disk or from a matching archive.

## Directory overview

- `levels/` – contains subfolders for each rank (e.g. `rank1/`, `rank2/`). Each level is stored as a `.lvl` file.
- `music/` – optional music tracks in formats like OGG, IT, MOD or WAV.
- `styles/` – custom graphic set data such as `.dat` or `VGASPEC` files.
- `sprites/` – optional lemming sprite sheets and `scheme.nxmi` files.
- `replays/` – replay files (`.nxrp`) saved from completed levels.
- `files/` – extra data such as menu art or additional configuration files.
- `SYSTEM.DAT`, `TALISMAN.DAT` – configuration and talisman definitions used by NeoLemmix.

A pack might omit some of these folders. Node tools rely on `NodeFileProvider` to load files from either a directory or an archive with the same layout.
