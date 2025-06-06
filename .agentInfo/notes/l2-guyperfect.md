# Lemmings 2 file format notes

tags: l2, file-format, doc

`docs/camanis/lemmings_2_file_formats_guyperfect.md` contains GuyPerfect's writeup on Lemmings 2 assets. Key parts include:
- **Compression Format** (`GSCM` chunks) describing a dictionary based scheme.
- **Data File** container using a `FORM` header with named sections.
- **Graphics Representation** explaining pixel order and the formula to map bytes to X/Y.
- **Style Palette – L2CL** listing 128 RGB triplets for colours 0–127.
- **Style Tiles – L2BL** storing 16×8 tiles with a reorder formula.
- **Style Presets – L2BE** grouping tiles for level editors.
- **Style Sprites – L2SS** encoding sprites across four layers with nibble copy/skip instructions.

This project currently targets DOS Lemmings/NeoLemmix and lacks readers for the L2 compression and `FORM` sections above.
