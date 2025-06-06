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
0x03 gold
0x02 silver
0x01 bronze
0x00 no medal achieved
```
