# vgaspecX.dat file format

To read a `vgaspecX.dat` file, first decompress it using the regular `.dat` format. This yields a single data section.

Next comes a second level of compression. The first 24 bytes specify the VGA palette used for the graphics (8 entries of 3 bytes each). These overwrite palette colors 8–15. Colors 0–7 remain fixed, although the game may duplicate color 8 into color 7.

Because half of the game palette changes, interactive objects in special graphics levels also change color. After the VGA palette are 16 bytes believed to be for EGA palettes. The usage of these bytes is uncertain.

The bitmap graphics use the second compression scheme. It works on bytes rather than bits and processes data forward. There are three encodings:

1. **Raw chunk** – a byte from `0x00` to `0x7F` giving the chunk length minus one, followed by that many raw bytes.
2. **Run‑length** – a byte from `0x81` to `0xFF` giving the run length minus one, followed by the repeated byte.
3. **End marker** – a lone `0x80` marks the end of a second‑level data section.

Example raw chunks:
```text
0x00 0xAB              -> 0xAB
0x02 0x12 0x34 0x56    -> 0x12 0x34 0x56
```

Example runs:
```text
0xFF 0x45 -> 0x45 0x45
0xC0 0xAB -> [65 copies of 0xAB]
```

Example section boundaries:
```text
0x00 0x81 0x05 0x80 0x81 0x80 0x81 0x80 0x81 0x80 0xFF 0x80 0x80 0xFD 0x00 0x80

0x00 0x81 -> 0x81
0x05 0x80 0x81 0x80 0x81 0x80 0x81 -> 0x80 0x81 0x80 0x81 0x80 0x81
0x80 -> end of first section
0xFF 0x80 -> 0x80 0x80
0x80 -> end of second section
0xFD 0x00 -> 0x00 0x00 0x00 0x00
0x80 -> end of third section
```

After decompression each `vgaspecX.dat` contains four 14,400‑byte sections representing a quarter of the 960×160 terrain bitmap. Each section stores a planar bitmap with three bitplanes. Bitplane order is 0, then 1, then 2.

Color numbers map to the game palette as:

```text
0 -> 0
1-7 -> 9-15
```

The terrain bitmap is likely centered in the level, though it might depend on the starting X position. Levels using special graphics may ignore the terrain section in the `.LVL` data.

The document notes possible mistakes in the palette byte counts. If the palette data size does not match, experiment with different lengths and report any findings.
