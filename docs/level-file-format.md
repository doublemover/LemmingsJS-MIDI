# Lemmings .LVL File Format

by rt

Document revision 0.0

Thanks to TalveSturges for the original alt.lemmings posting which got me started on decoding the .lvl format.

If you liked Lemmings you should give CLONES a try. Go to [www.tomkorp.com](http://www.tomkorp.com) for more information.

This document explains how to interpret the `.lvl` file used by the Windows version of Lemmings (levels saved directly in LemEdit). Values preceded by `0x` are hexadecimal. A `.lvl` file is 2048 bytes long (0x0000–0x07FF).

## Globals

| Bytes | Description |
| ----- | ----------- |
| 0x0000–0x0001 | Release Rate: 0x0000 is slowest, 0x00FA is fastest |
| 0x0002–0x0003 | Num of lemmings: maximum 0x0072. 0x0010 would be 16 lemmings. |
| 0x0004–0x0005 | Num to rescue: should be less than or equal to number of lemmings |
| 0x0006–0x0007 | Time Limit: max 0x00FF, 0x0001 to 0x0009 works best |
| 0x0008–0x0017 | Num of skills (2 bytes each, only lower byte used). Order is Climber, Floater, Bomber, Blocker, Builder, Basher, Miner, Digger |
| 0x0018–0x0019 | Start screen xpos: 0x0000 to 0x04F0 rounded to nearest multiple of 8. This determines the initial viewport when a level begins |
| 0x001A–0x001B | Normal Graphic Set: 0x0000 dirt, 0x0001 fire, 0x0002 squasher, 0x0003 pillar, 0x0004 crystal, 0x0005 brick, 0x0006 rock, 0x0007 snow, 0x0008 bubble |
| 0x001C–0x001D | Extended Graphic Set: apparently ignored in Windows version |
| 0x001E–0x001F | Unknown: doesn't seem to matter, use 0x0000 |

## Objects

**Bytes 0x0020–0x011F (8-byte blocks)**

- **x pos**: min 0xFFF8, max 0x0638. 0xFFF8 = -24, 0x0010 = 0, 0x0638 = 1576. Should be multiples of 8.
- **y pos**: min 0xFFD7, max 0x009F. 0xFFD7 = -41, 0x009F = 159. Any value allowed.
- **obj id**: 0x0000–0x000F. IDs depend on graphics set (0x0000 exit, 0x0001 start). See Appendix A.
- **modifier**: first byte 80 (no overwrite) or 40 (needs terrain) or 00 (always). Second byte 8F (upside-down) or 0F (normal).

Each 8-byte block from 0x0020 describes an interactive object. Maximum 32 objects. Fill unused bytes with 0x00 up to 0x0120.

## Terrain

**Bytes 0x0120–0x075F (4-byte blocks)**

- **x pos**: min 0x0000, max 0x063F. The high nibble encodes modifiers: 8 (no overwrite), 4 (upside-down), 2 (remove). Example: 0xC011 means draw at x=1, do not overwrite, upside-down.
- **y pos**: 9-bit value. 0xEF0 = -38, 0x518 = 159. The value bleeds into the next attribute.
- **terrain id**: 0x00–0x3F. Not all graphic sets have all 64 graphics.

Each 4-byte block represents a terrain object. Maximum 400 terrain objects. Fill unused bytes with 0xFF up to 0x0760.

## Steel Areas

**Bytes 0x0760–0x07DF (4-byte blocks)**

- **x pos**: 9-bit value. 0x000 = -16, 0xC78 = 1580. Each value represents 4 pixels and bleeds into the next attribute.
- **y pos**: range 0x00–0x27 (4-pixel steps).
- **area**: first nibble is the x-size, second nibble is the y-size in 4-pixel blocks. Example values: 0x00 = (4,4), 0x11 = (8,8), 0x7F = (32,64), 0x23 = (12,16).

Example steel record `00 9F 52 00` places steel at (-12,124) width 24 height 12.

Each block describes an indestructible steel area. The last byte is always 00. Fill unused bytes with 0x00 up to 0x07E0.

## Level Name

**Bytes 0x07E0–0x07FF**

A 32-byte ASCII string padded with spaces.

## Appendix A – Object IDs

Available objects for each graphics set.

### Graphics set 0

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = waving green flag
- `0x0003` = one-way block pointing left
- `0x0004` = one-way block pointing right
- `0x0005` = water
- `0x0006` = bear trap
- `0x0007` = exit decoration, flames
- `0x0008` = rock squishing trap
- `0x0009` = waving blue flag
- `0x000A` = 10 ton squishing trap
- `0x000B–0x000F` = invalid

### Graphics set 1

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = waving green flag
- `0x0003` = one-way block pointing left
- `0x0004` = one-way block pointing right
- `0x0005` = red lava
- `0x0006` = exit decoration, flames
- `0x0007` = fire pit trap
- `0x0008` = fire shooter trap from left
- `0x0009` = waving blue flag
- `0x000A` = fire shooter trap from right
- `0x000B–0x000F` = invalid

### Graphics set 2

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = waving green flag
- `0x0003` = one-way block pointing left
- `0x0004` = one-way block pointing right
- `0x0005` = green liquid
- `0x0006` = exit decoration, flames
- `0x0007` = waving blue flag
- `0x0008` = pillar squishing trap
- `0x0009` = spinning death trap
- `0x000A–0x000F` = invalid

### Graphics set 3

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = waving green flag
- `0x0003` = one-way block pointing left
- `0x0004` = one-way block pointing right
- `0x0005` = water
- `0x0006` = exit decoration, flames
- `0x0007` = waving blue flag
- `0x0008` = spinny rope trap
- `0x0009` = spikes from left trap
- `0x000A` = spikes from right trap
- `0x000B–0x000F` = invalid

### Graphics set 4

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = waving green flag
- `0x0003` = waving blue flag
- `0x0004` = one-way block pointing left
- `0x0005` = one-way block pointing right
- `0x0006` = sparkle water
- `0x0007` = slice trap
- `0x0008` = exit decoration, flames
- `0x0009` = electrode trap
- `0x000A` = zap trap
- `0x000B–0x000F` = invalid

### Graphics set 5

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = waving green flag
- `0x0003` = one-way block pointing left
- `0x0004` = one-way block pointing right
- `0x0005` = sandy water
- `0x0006` = hydraulic press trap
- `0x0007` = flatten wheel trap
- `0x0008` = waving blue flag
- `0x0009` = exit decoration, candy canes
- `0x000A–0x000F` = invalid

### Graphics set 6

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = waving green flag
- `0x0003` = one-way block pointing left
- `0x0004` = one-way block pointing right
- `0x0005` = wavy tentacles (water)
- `0x0006` = tentacle grab trap
- `0x0007` = exit decoration, green thing
- `0x0008` = licker from right trap
- `0x0009` = exit decoration, green thing
- `0x000A` = licker from right trap
- `0x000B` = waving blue flag
- `0x000C–0x000F` = invalid

### Graphics set 7

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = waving green flag
- `0x0003` = one-way block pointing left
- `0x0004` = one-way block pointing right
- `0x0005` = ice water
- `0x0006` = exit decoration, red flag
- `0x0007` = waving blue flag
- `0x0008` = icicle point trap
- `0x0009` = ice blast from left trap
- `0x000A–0x000F` = invalid

### Graphics set 8

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = waving green flag
- `0x0003` = one-way block pointing left
- `0x0004` = one-way block pointing right
- `0x0005` = bubble water
- `0x0006` = exit decoration, red thing
- `0x0007` = waving blue flag
- `0x0008` = zapper from left trap
- `0x0009` = sucker from top trap
- `0x000A` = gold thing??
- `0x000B–0x000F` = invalid

### Graphics set 9

- `0x0000` = exit
- `0x0001` = start
- `0x0002` = gift box
- `0x0003` = exit decoration, flames
- `0x0004` = bouncing snowman
- `0x0005` = twinkling xmas lights
- `0x0006` = fireplace - bottom
- `0x0007` = fireplace - top
- `0x0008` = santa-in-the-box bottom
- `0x0009` = santa-in-the-box top
- `0x000A–0x000F` = invalid
