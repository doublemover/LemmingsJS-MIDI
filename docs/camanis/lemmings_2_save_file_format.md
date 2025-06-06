
# Lemmings 2 - Savegame File Format

This document originates from [camanis.net](https://www.camanis.net/lemmings/files/docs/lemmings_2_save_file_format.txt). It describes how DOS Lemmings 2 records progress.

## Structure

- `0x0000-0x00c7`: names for eight save slots (25 bytes each)
- `0x00c7-0x0fd7`: array of save slot data (eight entries of 482 bytes each)

### Slot Data Layout

- `0x0000-0x01df`: progress for each tribe
  - 12 records (40 bytes each) ordered as in Appendix A
  - byte `0x00`: number of lemmings saved
  - byte `0x01`: unknown (unused?)
  - byte `0x02`: medal earned (see Appendix B)
  - byte `0x03`: unknown (unused?)
- `0x01e0-0x01e1`: last tribe played (little endian)

### Appendix A: Tribe Order

```

```text
Lemmings 2 - savegame file format

0x0000-0x00c7: array of savestate names, 8 entries of 25 bytes each
0x00c7-0x0fd7: array of savestate data, 8 entries of 482 bytes each
	8 entries (482 bytes each):
	0x0000-0x01df: array of savegame data for each tribe (order as indicated in Appendix A)
		12 entries (40 bytes each):
		0x00: amount of lemmings saved
		0x01: unknown (empty? - apparently no effect)
		0x02: medal earned (see Appendix B)
		0x03: unknown (empty? - apparently no effect)
	0x01e0-0x01e1: last tribe played (little endian)

Appendix A: tribe order

0x00 Classic
0x01 Beach
0x02 Cavelems
0x03 Circus
0x04 Egyptian
0x05 Highland
0x06 Medieval
0x07 Outdoor
0x08 Polar
0x09 Shadow
0x0a Space
0x0b Sports

```

### Appendix B: Medal Values

```
=======

Appendix B: medal value table

0x03 gold
0x02 silver
0x01 bronze
0x00 no medal achieved
```
