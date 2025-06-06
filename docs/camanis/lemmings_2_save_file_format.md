# Lemmings 2 - Savegame File Format

Source: <https://www.camanis.net/lemmings/files/docs/lemmings_2_save_file_format.txt>

## Layout

- **0x0000-0x00c7** – array of save slot names (8 entries, 25 bytes each)
- **0x00c7-0x0fd7** – array of save slot data (8 entries, 482 bytes each)

### Slot Data Structure

- **0x0000-0x01df** – per-tribe progress
  - 12 records (40 bytes each) ordered as listed in Appendix A
  - byte `0x00` – number of lemmings saved
  - byte `0x01` – unknown (unused?)
  - byte `0x02` – medal earned (see Appendix B)
  - byte `0x03` – unknown (unused?)
- **0x01e0-0x01e1** – last tribe played (little-endian)

### Appendix A – Tribe Order

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

### Appendix B – Medal Values

```
0x03 gold
0x02 silver
0x01 bronze
0x00 no medal achieved
```
