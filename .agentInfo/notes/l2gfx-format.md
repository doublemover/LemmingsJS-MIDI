# L2 style file format

tags: l2gfx-format, doc

`docs/camanis/lemmings_2_style_file_format_l2gfx.md` summarizes the `.l2gfx` container used by Lemmings 2 styles. It begins with a FORM header followed by twelve sections:
- **L2CL** palette with 128 RGB triples (each channel multiplied by four)
- **L2SS** special-object sprites
- **L2SF** frame positioning
- **L2SA** frame data pointers
- **L2SI** frame arrangement pointers
- **L2BE** terrain tile layout
- **L2OB** object information
- **L2BF** animation-frame data
- **L2BA** animation-frame pointers
- **L2BI** animation arrangement pointers
- **L2BL** 16x8 sprites
- **L2BS** 2x1 preview sprites

TODO: no parser exists for these sections yet. Unknown fields like `0x0008-0x0009` in `L2CL` and certain `L2OB` bitfields still need research.
