# Lemmings 2 - Uncompressed Level File Format

This document originates from [camanis.net](https://www.camanis.net/lemmings/files/docs/lemmings_2_level_file_format.txt).
It describes the binary layout used by Lemmings 2 level files.

## Header (12 bytes)
- `0x0000-0x0003`: `"FORM"`
- `0x0004-0x0007`: file size minus 8 (big endian)
- `0x0008-0x000b`: `"L2LV"` (file type)

Four sections follow:

- **L2LH** – general level data
- **L2MH** – map header describing the tile arrangement
- **L2MP** – terrain tile list
- **L2BO** – object list

## L2LH – General Data
- `0x0010-0x0013`: section length (big endian)
- `0x0014-0x002b`: level name
- `0x002c-0x003b`: skill IDs (2 bytes each, little endian)
- `0x003c-0x0043`: skill counts (1 byte each)
- `0x0044`: time minutes
- `0x0045`: unknown
- `0x0046`: time seconds
- `0x0047`: unknown
- `0x0048-0x0049`: style (Appendix B, little endian)
- `0x004a-0x004b`: X start position
- `0x004c-0x004d`: Y start position
- `0x004e-0x004f`: X cut-off from left
- `0x0050-0x0051`: Y cut-off from top
- `0x0052-0x0053`: X extension to right
- `0x0054-0x0055`: Y extension to bottom
- `0x0056-0x0057`: allowed deaths before gold
- `0x0058-0x0059`: release rate (signed little endian)
- `0x005a-0x005d`: unused

## L2MH – Map Header
- `0x0062-0x0065`: section length (big endian)
- `0x0066-0x0067`: style affecting the level (little endian)
- `0x0068-0x0069`: tiles per line (little endian)
  - `0x00` – 80 tiles/line
  - `0x01` – 64 tiles/line
  - `0x02` – 50 tiles/line
  - `0x03` – 40 tiles/line
  - `0x04` – 32 tiles/line
  - `0x05` – 24 tiles/line
  - `0x06` – 20 tiles/line
- `0x006a-0x006b`: unknown

## L2MP – Terrain Map
- `0x0070-0x0073`: section length (big endian)
- `0x0074-0x1f39`: 1971 terrain entries (4 bytes each)
  - bytes `0x00-0x01`: modifier (`0x4000` background, `0x0000` foreground)
  - bytes `0x02-0x03`: terrain piece ID (big endian)

## L2BO – Objects
- `0x1f44-0x1f47`: section length (big endian)
- `0x1f48-0x21c7`: 64 object entries (10 bytes each)
  - `0x00-0x01`: object ID (little endian)
  - `0x02-0x03`: X position (little endian)
  - `0x04-0x05`: Y position (little endian)
  - `0x06-0x07`: horizontal count (steel) or chain blocks (cannon)
  - `0x08-0x09`: vertical count (steel) or chain length (swing)

## Appendices
### Appendix A – Skill IDs
- `0x00` – no skill
- `0x01-0x32` – skills as used in training
- `0x33` – blocker

### Appendix B – Style Values
0x00 Classic, 0x01 Beach, 0x02 Cavelems, 0x03 Circus, 0x04 Egyptian,
0x05 Highland, 0x06 Medieval, 0x07 Outdoor, 0x08 Polar,
0x09 Shadow, 0x0a Space, 0x0b Sports

### Appendix C – Field Layout
- Width: see `0x0068-0x0069`
- Height must not exceed `1600 / width`
- Two unused rows above and below the map
- One unused column left and right
- Remainder tiles may pad the end of the file
- The field may be cut off using bytes `0x004a-0x004d`

