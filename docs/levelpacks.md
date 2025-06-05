# Level Pack Structure

This project can load NeoLemmix-style level packs. Packs can either be provided as a **.nxp** archive
produced by the official Pack Toolkit or as a plain folder structure. The folder layout mirrors what
the Toolkit generates.

```
levels/
  PackName/
    info.nxmi        # title, author, scroller text
    logo.png         # icon shown on the title screen
    music.nxmi       # global music order
    postview.nxmi    # result messages
    levels.nxmi      # lists ranks and their folders
    talisman.nxmi    # optional talisman definitions
    <rank>/
      levels.nxmi    # order of level files for the rank
      <level>.nxlv   # individual level files
      rank_graphic.png      # optional rank badge shown on level select
    music/           # optional custom music files (.ogg, .it, .mod, etc.)
    styles/          # optional custom graphic set folders
    menu graphics    # optional files like sign_play.png, skill_panels.png, etc.
```

### Grouping Levels

`levels.nxmi` inside the pack folder defines each rank with `NAME` and `FOLDER` fields:

```
$GROUP
  NAME Fun
  FOLDER Fun
$END
```

Each rank folder then has its own `levels.nxmi` listing `LEVEL` entries that point to `.nxlv` files.
The engine reads these files in order to present the levels.

### Optional Files

* **talisman.nxmi** &ndash; achievements for completing levels with special conditions.
* **logo.png / background.png** &ndash; images shown on the pack menu.
* **sign_*.png, skill_panels.png** &ndash; custom menu graphics.
* **music/** and **styles/** folders &ndash; include custom music tracks and graphic sets referenced by the pack.

### Archive Formats

Packs may be distributed as:

* `.nxp` &ndash; a single archive created by the Pack Toolkit.
* A plain folder (or zip) using the layout above.

