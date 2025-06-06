Lemmings 2 - uncompressed style/gfx file format

Header Info (12 bytes)
0x0000-0x0003: “FORM”
0x0004-0x0007: file size - 8 bytes (big endian)
0x0008-0x000b: “L2VG” (type: VG)

section overview (12 sections):
L2CL (palette)
contains the palette data
L2SS (special-object sprites)
contains the size and gfx data for the frames of animations for special objects
L2SF (special-object-frame data)
contains frame positioning data and pointers to gfx data (L2SS) for each special object animation frame
L2SA (special-object-frame data pointers)
contains pointers to frame positioning data (L2SF) for animations of special objects
L2SI (special-object-frame arrangement pointers)
contains pointers to information (L2SA) on which frames the animations are built up from for each special object
L2BE (terrain tile arrangement)
contains information on how terrain/background tiles are built up from the sprites (L2BL)
L2OB (object information)
contains information about the objects and how they are built up from animations
thanks to ccexplore for a significant portion of this information
L2BF (animation-frame data)
contains information on which sprites (L2BL) the animation frames are built up from
L2BA (animation-frame data pointers)
contains information on size of frames and pointers to information (L2BF) on which sprites frames are built up from
L2BI (animation-frame arrangement pointers)
contains pointers to information (L2BA) on which frames the animations are built up from for each animation
L2BL (8*16 sprites)
contains the gfx data for the 16*8 sprites used for objects/terrain
L2BS (preview 2*1 sprites)
contains the gfx data for the 2*1px sprites used for level preview

palette “L2CL” section (394 bytes)
0x0000-0x0003: “L2CL”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: unknown (number of entries? big endian)
0x000a-0x018a: palette entry, 128 3-byte RGB sets
value of the RGB component is 4\*byte-value

special-object sprite “L2SS” section (variable size)
0x0000-0x0003: “L2SS”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries N (little endian)
N entries (variable size):
0x00-0x01: entry size X excluding itself (i.e. excl. 2 bytes indicating size) (little endian)
0x02-0x03: x-size (little endian)
0x04-0x05: y-size (little endian)
2\*4 bytes: array of offsets (little endian) for each of the four pixel layers
offset relative to begin of first entry, however no entry size defining bytes are counted
i.e. twice the entryID (start counting from 1) has to be added in order to get the real offset
4 layers of pixel information (variable size):
each layer (for closer description see Appendix A):
variable number of bytes: pixel data
final byte 0xFF indicates end of layer information

special-object-frame data “L2SF” section (variable size)
0x0000-0x0003: “L2SF”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries N (little endian)
N entries (6 bytes each):
0x00-0x01: horizontal start position of sprite (little endian)
0x02-0x03: vertical start position of sprite (little endian)
0x04-0x05: offset relative to begin of first entry in L2SS section (little endian)
however no entry size defining bytes are counted
i.e. twice the entryID (start counting from 1) has to be added in order to get the real offset

special-object-frame data pointer “L2SA” section (variable size)
0x0000-0x0003: “L2SA”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries/special-objects N (little endian)
N entries (variable size):
0x00-0x01: number M of frames (little endian)
2\*M bytes: list of M offsets (little endian) relative to begin of first entry in L2SF section

special-object-frame arrangement pointer “L2SI” section (variable size)
0x0000-0x0003: “L2SI”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries/special-objects N (little endian)
2\*N bytes: list of N offsets (little endian) relative to first entry in L2SA section

terrain tile arrangement “L2BE” section (variable size)
0x0000-0x0003: “L2BE”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries N (little endian)
N entries (variable size):
0x00-0x01: unknown
0x02: x-size (sprites)
0x03: y-size (sprites)
0x04-0x05: size including 6 header bytes (little endian)
2*x*y bytes: datablock of spriteIDs (from L2BL) (2 bytes each) (little endian)

object information “L2OB” section (variable size)
0x0000-0x0003: “L2OB”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries/objects N
N entries (variable size), consisting of header (20 bytes) and subentries (12 bytes each):
header (20 bytes):
0x00-0x01: number of subentries M (little endian)
0x02-0x03: type (little endian), see table in Appendix B
0x04-0x11: object type specific data
e.g. entrance: “Again, I haven’t tested it, but it looks like in the object (not subobject, the main object)’s data, for an entrance, the little-endian word at offset 4 is the x-offset, and at offset 6 the y-offset. That is, take the object’s position in the level, and add the given x- and y-offsets, and I think that’s the initial position for a lemming coming out of that entrance.”
e.g. fling objects (type 0x0c): little endian words at offset 6 and 8 respectively are the x and y fling velocity; offset 9 bit1 means permanent animation, bit 0 invert velocity for lems facing left
0x12-0x13: sound effect ID (little endian)
M component-subentries (components that make up the object) (12 bytes each):
note: might not fully apply if the subentry refers to a special sprite not defined in L2BI
0x00: interaction type (see appendix D)
0x01: bitfield
bit0: unused (not set)
bit1: unused (not set)
bit2: only set for steam objects in sports tribe
bit3: interaction flag (?)
bit4: vertical extensibility flag: repeat component if vertical extension requested (ref. L2BO section of level file)
bit5: horizontal extensibility flag: repeat component if horizontal extension requested (ref. L2BO section of level file)
bit6: relative x flag: if 0, interpret subobject x position as measured from the (x, y) given in the level data for object. If 1 and not the first subpart of the object, interpret subobject x position as measured from the upper-left of the previous subpart. If first object subpart and this bit is 1, ignore subobject x position and use 0.
bit7: relative y flag: if 0, interpret subobject y position as measured from the (x, y) given in the level data for object. If 1 and not the first subpart of the object, interpret subobject y position as measured from the upper-left of the previous subpart. If first object subpart and this bit is 1, ignore subobject y position and use 0.
0x02-0x03: subobject x position, see also bits 6 and 7 of byte 0x01 (little endian)
0x04-0x05: subobject y position, see also bits 6 and 7 of byte 0x01 (little endian)
0x06: unused
0x07-0x08: bitfield (little endian)
bit0-2: unused (not set)
bit3-4:
00: If both bits 3 and 4 are 0, then subobject contains no trigger area (conceivably it may overwrite existing trigger area in the level as well).
10: If bit 3 is 0 and bit 4 is 1, then subobject is definitely contains a trigger area. This method of indication is used by exits, full-waters, and ice.
11: If both bits 3 and 4 are 1, then subobject contains no trigger area. Instead, they seem to be always things that you can click on, such as the arrows in a cannon object, or the “release button” for the swing chain.
01: Finally, if bit 3 is 1 and bit 4 is 0, then subobject may contain a trigger area. In this case you need to look at byte 0x00 of the subobject (aka “interaction type”) for full determination. It appears that if the interaction type has values from 0x06 to 0x0c (inclusive), then subobject functions like a trigger area; otherwise they function as other things.
Again, in all cases above where I say “subobject contains no trigger area”, it may still be that the subobject can actually overwrite (ie. cancel out) existing trigger area in a level, within the 16x8 tile where the subobject’s upper-left corner is located.
bit5-8: trigger area x-offset
bit9-11: trigger area y-offset
bit12-13:
00: trigger area is 16x8 (ie. takes up the full tile)
01: trigger area is 1x1 (ie. single pixel) at (x-offset, y-offset)
10: trigger area is 5x5 centered at (x-offset, y-offset)
11: trigger area is 9x9 centered at (x-offset, y-offset)
With one further proviso: any parts of the square given by the above table that lies outside the 16x8 tile area, those parts are clipped. Another way to think of it is, if the pixel lies outside of the 16x8 tile area, it is not controlled by the object subpart in question, but possibly some other subpart of either this object or some other object in the level. See list of examples in Appendix E.
bit14-15:
00: normal
01: water reaction
10: ice surface reaction
11: causes no effect on lemmings (ie. no exiting, drowning, slipping, nothing) and is not used by any objects in the game
0x09: solidity (?) (bitfield) (0x10 steel; 0x40 background; 0x00 special/event)
0x0a: graphics ID (from L2BI, or L2SI if in byte 0x0b special bit5 is set and bit7 is not set)
0x0b: bitfield
bit0-3: unused (not set)
bit4: permanent animation flag (as opposed to animation on trigger)
bit5: for objects with special L2SS graphics only
bit6: only ever used by two chain components each
bit7: invisible flag (?)

animation-frame data “L2BF” section (variable size)
0x0000-0x0003: “L2BF”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries N (little endian)
N entries (variable size):
0x00-0x01: size X of entry content excluding itself (i.e. excl. 2 bytes indicating size) (little endian)
X bytes: list of X/2 spriteIDs (from L2BL) (2 bytes each) (little endian) for sprites making up one frame of animation

animation-frame pointer “L2BA” section (variable size)
0x0000-0x0003: “L2BA”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries/animations N (little endian)
N entries (variable size):
0x00-0x01: number of frames M (little endian)
0x02-0x03: x-size of object/animation (little endian)
0x04-0x05: y-size of object/animation (little endian)
2\*M bytes: list of M offsets (little endian) relative to first entry in L2BF section
however no entry size defining bytes are counted
i.e. twice the entryID (start counting from 1) has to be added in order to get the real offset –\> to be corrected

animation-frame arrangement pointer “L2BI” section (variable size)
0x0000-0x0003: “L2BI”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries/animations N (little endian)
2\*N bytes: list of N offsets (little endian) relative to first entry in L2BA section

(16*8px) sprite “L2BL” section (variable size)
0x0000-0x0003: “L2BL”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries N = number of sprites (little endian)
N entries (128 bytes each), 16*8 pixel:
0x00-0x7f: list of colorIDs (from L2CL palette) for a certain pixel
position of that pixel depending on offset B relative to the start of the entry:
x(B)=(4B)%16+B/32
y(B)=(B/4)%8
alternative description (by Mindless): see Appendix C

preview (2\*1px) sprite “L2BS” section (variable size)
0x0000-0x0003: “L2BS”
0x0004-0x0007: section data size (big endian)
0x0008-0x0009: number of entries N = number of sprites (little endian)
N entries (2 bytes each):
0x00: color for first pixel (0,0)
0x01: color for second pixel (1,0)

Appendix A: (L2SS) layer arrangement description
each layer N contains pixel information:
- Nth layer (counting begins at 0) contains the data for the pixels with x-position 4n+N, n is any non-negative integer
- each layer stores a list of data of the following form:
1st byte: definition byte
otherwise it belongs to the ‘rest’
rest: list of pixel information, i.e. color index IDs (from palette L2CL) (one byte each)
number of pixel information bytes is indicated by the definition bytes

definition byte value table (first/higher nybble is H, second/lower nybble is L):
+ possibly not complete, but sufficient for producing apparently correct sprites from the original gfx
+ to get the x-position in the final sprite, it has to be multiplied by 4 and N has to be added
- in the beginning the current x/y-position is 0
- after a pixel is set, the x-position is increased by 1
- linebreak means x-position is reset, y-position increased by 1
0xFF:
end of layer information
H\<8; L=0:
followed by H bytes of pixel information (H may be 0)
after these pixels are set: linebreak
H\<8; L\<8:
followed by L+H bytes of pixel information
H\<8; L\>=8:
followed by H bytes of pixel information
after these pixels are set: x-position increased by L-8
H\>=8; H!=e; L\<8:
x-position increased by H-8
followed by L bytes of pixel information
H=e; L\>=8; L!=e:
x-position increased by L-2
H\>=8; H!=e; L\>=8:
effect unknown, not used in original gfx

Appendix B: (L2OB) type value table (by ccexplore)
0: swing chain
1: cannon
2: entrance
3: exit
4: trampoline
5: steel or decorative objects
6: water/water surface
7: catapault (ie. in Medieval)
8: ice (eg. for skater lemmings…)
9: triggered trap (ie. can’t kill lemmings while in motion)
10: constant trap (yet animation affected by lemmings)? used by following objects:
medieval: L2OB entry \#4 (0-based), dragon
space: airlock
space: alien thingie
11: constant trap (animation unaffected by lemmings)? used by the following objects:
classic: fire shooter
sports: bouncing ball
12: “lemming launchers”. used by the following objects (list may not be exhaustive):
cavelem: the lizard whose tail “flicks” the lemmings away
outdoor: a grass-like object with similar function I think
sports: all the gas clouds
13: gas/tube switches
14: teleporter
15: (don’t remember what it does) used by the following objects (list may not be exhaustive)
egyptian: L2OB entry \#4 (0-based) = sand tube
shadow: L2OB entry \#21 = sand tube

Appendix C: (L2BE) pixel arrangement description by Mindless
do
p = 0
for v = 0 to 3
for y = 0 to 7
for x = 0 to 3
pset((x \* 4) + v, y), d\[p\]
p += 1
next
next
next
d += 128
loop
(d is a byte pointer to the current tile, pset is a pixel setting function)

Appendix D: (L2OB) interaction types
00: various
01/02: components of normal cannon
03/04/05: components of catapult
06: remove lem and run anim
07: dragon/air lock/robot
08: fire blower/tennis ball
09: fling lemming into air
0A: switch (to trigger tube or steam)
0B: trampoline
0C: teleport
0D: tube
0E: chain
\>0E: not defined

Appendix E: (L2OB) examples for trigger area bytes (by ccexplore)
1) Suppose the word value is 0x1350. Parsing the bitfields, we get an x-offset of 1010=10 (decimal), a y-offset of 001, and a size indicator of 01. So we have a 1x1 trigger area at (10, 1) relative to the upper-left of the 16x8 tile \[(0, 0) being the upper-leftmost pixel of that tile\].

2)  Suppose the word value is 0x2870. Parsing the bitfields, we get an x-offset of 0011=3, a y-offset of 100=4, and a size indicator of 02. So it’s a 5x5 trigger area centered at (3, 4). In other words, the upper-leftmost pixel of the area is (1, 2), and the lower-rightmost pixel is (5, 6).

3)  Suppose the word value is 0x2830. Similar to example \#2, but x-offset is only 1 instead of 3. So the clipping rule comes into effect, making the effective trigger area represented by this subpart to span only from (0, 2) to (3, 6), rather than (-1, 2) to (3, 6). If you actually want the unclipped version, you’ll need to put in a second object subpart to create a 2nd trigger area for the 16x8 tile above the current one, to make up for the part clipped out in the current subpart/tile.

4)  Similarly, a word value of 0x29f0 has an x-offset of 15 instead of 3, so with the clipping rule, the trigger area spans from (13, 2) to (15, 6). A word value of 0x2070 has a y-offset of 0 instead of 4, leading to the trigger area spanning from (1, 0) to (5, 2). A word value of 0x2c70 has a y-offset of 6 instead of 4, and the trigger area would span from (1, 4) to (5, 7).

5)  A word value of 0x0010, with a size indicator of 0, will cover the entire 16x8 tile area. The values for x- and y-offsets have no effect–if you want, you can think of it as a 31x31 area with clipping applied, which would make the x- and y-offsets irrelevant.

6)  A word value of 0x3db0 has an x-offset of 13, a y-offset of 6, and a size indicator of 3. So the trigger area spans from (9, 2) to (15, 7).
