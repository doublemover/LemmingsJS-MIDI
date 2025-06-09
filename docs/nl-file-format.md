# NeoLemmix File-Format Reference

*A complete specification for loaders, editors and ports – updated 5 June 2025*

---

## 1 Overview

| Era                | File / Container                                     | Use-case                                           | Notes                                 |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| **V12 (current)**  | **`.nxlv`** – plain-text level + **directory packs** | All modern NeoLemmix and SuperLemmix content       | Human-readable, UTF-8, no compression |
| V1 → V11           | **4 KB “new-format” `.lvl`**                         | Legacy packs still shipped in some *.NXP* archives | Binary header + section blocks        |
| DOS / early Lemmix | **2 KB / 10 KB `.lvl`**                              | Historical only                                    | Superseded but still accepted by NL   |
| Packs ≤ V10        | **`.NXP` Flexi archive**                             | Bundles levels, graphics, music                    | Convert with **NXPConvert**           |

---

## 2 Text‐Based Levels (`.nxlv`, V12+)

### 2.1 Syntax rules

```
KEYWORD value          # One space only
$SECTION               # Begin group
  KEY value
$END                   # End group
# Lines starting with # are comments
```

\*Decimals or `x<hex>` numerals accepted; filenames are case-sensitive on *nix.* ([neolemmix.com][1])

### 2.2 Header keys (order-insensitive)

| Key                                                                      | Description |
| ------------------------------------------------------------------------ | ----------- |
| `TITLE`, `AUTHOR`, `VERSION`, `ID`                                       |             |
| `THEME` – default menu style                                             |             |
| `MUSIC` – file name, `?n`, list `a;b;c`, or `!` prefix for random choice |             |
| `LEMMINGS`, `SAVE_REQUIREMENT`, `TIME_LIMIT s/INFINITE`                  |             |
| `MAX_SPAWN_INTERVAL`, `SPAWN_INTERVAL_LOCKED`                            |             |
| `WIDTH`, `HEIGHT`, `START_X`, `START_Y`, `BACKGROUND`                    |             |

### 2.3 Main sections

| Section                      | Mandatory keys                | Extras                                                                                                               |                                        |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **`$SKILLSET`**              | \`SKILL n                     | INFINITE\` each                                                                                                      | 17 skills; *Cloner* cannot be infinite |
| **`$GADGET`**                | `STYLE`, `PIECE`, `X`, `Y`    | `ROTATE`, `FLIP_HORIZONTAL/VERTICAL`, `LEMMINGS`, `PAIRING`, `SKILL`, resizable `WIDTH/HEIGHT`, trigger custom boxes |                                        |
| **`$TERRAIN`**               | identical to gadget           | Flags `ONE_WAY`, `ERASE`, `NO_OVERWRITE`                                                                             |                                        |
| **`$LEMMING`**               | `X`, `Y`                      | `ZOMBIE`, `CLIMBER`, etc.                                                                                            |                                        |
| **`$TALISMAN`**              | `TITLE`, `ID`, `COLOR`        | Goals: `SAVE_REQUIREMENT`, skill limits, `TIME_LIMIT`, etc.                                                          |                                        |
| **`$PRETEXT` / `$POSTTEXT`** | `LINE`                        | Supports `[HOTKEY:Jump]` macros                                                                                      |                                        |
| **`$TERRAINGROUP`**          | Wraps many `$TERRAIN` entries | Must be all-steel *or* non-steel                                                                                     |                                        |

> **Visibility rule:** only files and sub-groups named in *the nearest* `levels.nxmi` are shown in-game; missing entries are hidden but still shipped.

---

## 3 Binary Levels (4 KB “new-format” `.lvl`)

### 3.1 Header (offset 0x00–0x8F)

| Off  | Size | Purpose                                                         |
| ---- | ---- | --------------------------------------------------------------- |
| 0x00 | 1    | **0x04** – identifies 4 KB type                                 |
| 0x01 | 1    | Music (0, 253–255 = special)                                    |
| 0x03 | 2    | *Lemming count*                                                 |
| 0x05 | 2    | *Save requirement*                                              |
| 0x07 | 2    | Time (sec); >5999 = ∞                                           |
| 0x08 | 1    | Release rate (1–99)                                             |
| 0x09 | 1    | **Options flags** (Autosteel, oddtabling, one-way inversion, …) |
| 0x0A | 1    | Resolution (8 = 320×160)                                        |
| 0x0C | 2    | Screen-start X (low 16 bits)                                    |
| 0x0E | 2    | Screen-start Y (low 16 bits)                                    |
| 0x10 | 16   | Skill counts *(Walker … Cloner)*                                |
| 0x23 | 4    | **Gimmick bit-field** (full map below!)                         |
| 0x25 | 1    | Skill-availability bits                                         |
| 0x27 | 2    | Redirect rank/ID (oddtable, bait-&-switch, secrets)             |
| 0x2B | 4    | Level width (px)                                                |
| 0x2F | 4    | Level height (px)                                               |
| 0x33 | 4    | VGASPEC X                                                       |
| 0x37 | 4    | VGASPEC Y                                                       |
| 0x40 | 16   | Author                                                          |
| 0x50 | 32   | Title                                                           |
| 0x70 | 16   | Style name                                                      |
| 0x80 | 16   | VGASPEC name                                                    |

### 3.2 Data block markers

| Marker   | Meaning                | Fixed size            |
| -------- | ---------------------- | --------------------- |
| **0x01** | *Object* entry         | 20 bytes              |
| **0x02** | *Terrain* entry        | 12 bytes              |
| **0x03** | *Steel / One-way area* | 17 bytes              |
| **0x04** | *Window-order list*    | n× `uint16` + 0xFFFF  |
| **0x05** | *Sub-header*           | 0x20 bytes (optional) |
| **0x00** | End-of-file            | –                     |

### 3.3 Complete gimmick-flag map (bits 0–31) ([neolemmix.com][1])

| Bit | Gimmick                | Effect                               |
| --: | ---------------------- | ------------------------------------ |
|   0 | **SuperLemming**       | Permanent Runner speed               |
|   1 | **Frenzy**             | 20 sec global timer + frenzy music   |
|   2 | Reverse Skill Counts   | Counts down instead of up            |
|   3 | **Karoshi**            | You *must* kill the quota            |
|   4 | Unalterable Terrain    | Terrain cannot be modified           |
|   5 | Skill Count Overflow   | Negative skill counts wrap           |
|   6 | **No Gravity**         | Lemmings float when not on terrain   |
|   7 | Hardworkers            | Skills execute twice as slowly       |
|   8 | Backwards Walkers      | Left ↔ Right                         |
|   9 | Lazy Lemmings          | ¼ speed                              |
|  10 | Exhaustion             | Walkers randomly pause               |
|  11 | Non-Fatal Bombers      | Bombers survive                      |
|  12 | Invincible Lemmings    | Ignore all hazards                   |
|  13 | One-Skill-Per-Lemming  | Each lemming may get one skill total |
|  14 | **Steel Inversion**    | Non-steel acts as steel & vice-versa |
|  15 | Solid Bottom           | Invisible floor                      |
|  16 | Non-Permanent Skills   | Climbers, floaters, etc. wear off    |
|  17 | Disobedience           | Ignore commands 33 % of the time     |
|  18 | **Nuclear Bombers**    | All bombers explode together         |
|  19 | Turnaround on Assign   | Walker turns before using skill      |
|  20 | Countdown Other Skills | Skill timers visible everywhere      |
|  21 | Assign to All          | Any skill → every lemming            |
|  22 | **Horizontal Wrap**    | Off-screen exits loop                |
|  23 | **Vertical Wrap**      | Top ↔ bottom                         |
|  24 | **Rising Water** \*\*  | Flood layer + death on contact       |
|  25 | **Clock** \*\*         | Terrain appears/disappears by time   |
|  26 | **Zombies** \*\*       | Infectious undead                    |
|  27 | Classic Zombies        | Old zombie physics quirks            |
|  28 | Deadly Level Sides     | Touching edges = death               |
|  29 | (reserved)             |                                      |
|  30 | **Cheapo Mode**        | Alters physics toward Cheapo         |
|  31 | **Bait & Switch** \*\* | Loads a replacement level            |

*\* Requires supporting data (water height, clock terrain list, redirect level, etc.)*

---

## 4 Graphic Styles & High-Resolution Assets

### 4.1 DAT layout (new format)

| Section marker | Contains                                                                              |
| -------------- | ------------------------------------------------------------------------------------- |
| `0xFF02`       | 48-byte style header (classic / modern palette, explosion colors, default background) |
| `0xFF03`       | *Object definition*: ID, trigger boxes (±8 rects), L-value, S-value, sound slot       |
| `0xFF04`       | *Terrain piece*: ID, flags (`STEEL`, `FORCE_ONE_WAY`, etc.), native size              |
| `0xFF00`       | End-of-file                                                                           |

Images referenced by the tables are stored **uncompressed** PNG blocks at byte offsets specified in the records. A global RLE wrapper may surround the entire DAT (see § 5).
The PNGs may use full 32‑bit color with transparency. Classic 16‑color images
remain valid and can coexist with their true‑color replacements.

### 4.2 High-Resolution folders (`style-hr`)

* For any piece `foo.png` in *styles/xyz/* you may add `foo.png` (double resolution) in *styles/xyz-hr/*.
* NeoLemmix automatically selects -hr when the **hi-res checkbox** is active; otherwise it falls back to SD without scaling artifacts.
* The upscaling policy for *missing* hi-res pieces is defined in **`upscaling.nxmi`**:

```text
METHOD nearest   # nearest | linear | hq2x | xBRZ
FACTOR 2         # must be integer
```

### 4.3 `alias.nxmi`

Remaps legacy piece names to modern ones – useful when consolidating large graphic-set overhauls without breaking old levels.

```text
OLD bridge1   NEW bridge_planks
OLD deco_egg  NEW easter_egg
# Comment lines start with #
```

---

## 5 DAT Compression Header

Before any compressed payload (old *and* new format):

| Byte(s) | Meaning                                     |
| ------- | ------------------------------------------- |
| 0       | Bits-in-first-byte                          |
| 1       | XOR checksum                                |
| 2–5     | **Decompressed size** (big-endian `uint32`) |
| 6–9     | **Compressed size** (big-endian `uint32`)   |

Payload uses the original DOS Lemmings RLE/PackBits hybrid. ([neolemmix.com][1])

---

## 6 Pack Organisation Files

All live inside the pack’s top-level (or any sub-group) and use the same `<KEY> <VALUE>` grammar.

### 6.1 `levels.nxmi`

Declares hierarchy and display order.

```text
BASE                 # marks this folder as a *pack* boundary
$GROUP Fun
  LEVEL 01_JustDig.nxlv
  LEVEL 02_LetUsOut.nxlv
$END
$GROUP Tricky
  INCLUDE ../Shared/Tricky/levels.nxmi   # recursive include
$END
```

*Unlisted levels or folders remain hidden.*

### 6.2 `info.nxmi`

Pack metadata and title-screen scroller:

```text
TITLE Lemmings Redux
AUTHOR Community
VERSION 2021-07-15
$SCROLLER
  LINE Built with love <3
  LINE Thanks to DMA Design
$END
```

Optional graphic overrides (`logo.png`, `background.png`, `skill_panels.png`) placed alongside override the defaults for *all* descendants unless a deeper folder provides replacements.

### 6.3 `music.nxmi`

Default rotation and weighting:

```text
RANDOM           # shuffle whole list
TRACK orig_dirt
TRACK orig_rock;ohno_rock   # play first available
TRACK !custom1;custom2      # choose randomly from this line
```

If a level specifies `MUSIC ?n` it indexes into the *resolved* rotation list after processing `RANDOM` and `!` lines.

---

## 7 Legacy Flexi `.NXP` Archives (V1–V10)

*Simple file table:* `uint32 count` + repeated `<Name[28], Offset, Size>` (little-endian), followed by raw payloads. Convert with **NXPConvert** to obtain a directory pack with `.nxlv`, styles and music extracted. ([neolemmix.com][2])

---

### End of specification

*(Compiled and verified 5 June 2025. Source references: namida’s format pages and NeoLemmix documentation.*)

[1]: https://www.neolemmix.com/old/f_levelvar.html "namida's Lemmings Page"
[2]: https://www.neolemmix.com/old/f_system.html "namida's Lemmings Page"
