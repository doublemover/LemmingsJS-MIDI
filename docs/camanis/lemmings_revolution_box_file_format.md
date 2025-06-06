# Lemmings Revolution BOX File Format

*Source: [camanis.net](https://www.camanis.net/lemmings/files/docs/lemmings_revolution_box_file_format.txt)*

This document mirrors the original TXT reference describing how data files are stored in the `*.BOX` archive shipped with **Lemmings Revolution** for PC.

---

## Format Overview

```
[NOTE: per Intel convention, all integers are little-endian, meaning that
 a 4-byte hexadecimal integer 0xdeadbeef is stored in bytes as
 0xef, 0xbe, 0xad, 0xde.]
```

### Header (14 bytes)
```
0x0000–0x0005  "LEMBOX"
0x0006–0x0009  4-byte integer, number of files N
0x000A–0x000D  4-byte integer, offset (from byte after the header) to File Locations table
```

### File Directory
```
0x000E:  N filename entries
    0x00–0x03  4-byte integer, length L of following text string
    0x04       L bytes in 8‑bit ASCII, name of file (including path), no 0‑termination
```

### File Locations Table
```
0x00–0x03  4-byte integer, number of table entries N (should equal file count)
0x04       N entries – each is a 4-byte integer offset from start of BOX to file contents
```

### File Lengths Table
```
0x00–0x03  4-byte integer, number of table entries N (should equal file count)
0x04       N entries – each is a 4-byte integer length of the file in bytes
```

After these tables the BOX file simply stores the raw bytes for each embedded file.

---

## Example Encoding

The TXT reference includes the following short example of packing four files:

```
AFILE.EXT        (file contents: 0x42)
DIR1\FILE1.ZZZ   (file contents: 0xde 0xad 0xbe 0xef 0xde 0xad 0xbe 0xef)
DIR1\2ND.MMM     (file contents: 0xab 0xcd 0xef)
D2\SD3\Y.CD      (file contents: 0xac 0xdc)
```

Offsets and lengths allow the actual file data to appear in any order within the archive, though the in‑game BOX files keep them in table order. The example concludes with a hex dump illustrating each field.

