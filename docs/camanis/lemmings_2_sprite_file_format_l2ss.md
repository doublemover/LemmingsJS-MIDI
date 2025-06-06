Lemmings 2 data documentation in L2SS format.
An implementation to dump specified files as targa can be found at http://geoo.digibase.ca/lemmings/l2ss.cpp
Extracted .png images at http://geoo.digibase.ca/lemmings/l2ss.7z

Some of the files are compressed while others are not; as the compressed ones are easily identified by the character sequence 'GCSM', I won't note which ones are compressed and which ones are not.
All documentation refers to uncompressed data; so you'll have to use Mindless' lem2zip to decompress the compressed files.

----------------
Uncompressed IFF Format
----------------

NOTE: the L2SS-L2SI sections are the same as in the tribe-specific
style files (see l2gfx.txt) except for parts marked with DIFF_IFF.

Header Info (12 bytes)
0x0000-0x0003: "FORM"
0x0004-0x0007: file size - 8 bytes (big endian)
0x0008-0x000b: "L2VG" (type: VG)


section overview (8 sections):
L2SS (animation frame data)
	contains the size and gfx data for the frames of animations for special objects
L2SF (animation frame information)
	contains frame positioning data and pointers to gfx data (L2SS) for each special object animation frame
L2SA (animation data)
	contains pointers to frame positioning data (L2SF) for animations of special objects
L2SI (animation pointers)
	contains pointers to information (L2SA) on which frames the animations are built up from for each special object
L2PD (palette data)
	contains usually multiple palettes
L2PI (palette pointers)
	contains pointers to the palettes in the previous (L2PD) section
L2TM (text data)
	contains various text data
L2TI (text pointers)
	contains pointers to the texts in the previous (L2TM) section



animation frame data "L2SS" section (variable size)
0x0000-0x0003:	"L2SS"
0x0004-0x0007:	section data size (big endian)
0x0008-0x0009:	number of entries N (little endian)
	N entries (variable size):
	0x00-0x01: entry size X excluding itself (i.e. excl. 2 bytes indicating size) (little endian)
	0x02-0x03: x-size (little endian)
	0x04-0x05: y-size (little endian)
	2*4 bytes: array of offsets (little endian) for each of the four pixel layers
		offset relative to begin of first entry
		(DIFF_IFF: in .iff files, it's the offset to the begin of _this_ entry)
		however no entry size defining bytes are counted
		i.e. twice the entryID (start counting from 1) has to be added in order to get the real offset
	4 layers of pixel information (variable size):
		each layer (for closer description see Appendix A):
			variable number of bytes: pixel data
			final byte 0xFF indicates end of layer information


animation frame information "L2SF" section (variable size)
0x0000-0x0003:	"L2SF"
0x0004-0x0007:	section data size (big endian)
0x0008-0x0009:	number of entries N (little endian)
	N entries (6 bytes each):
	0x00-0x01: horizontal start position of sprite (little endian)
	0x02-0x03: vertical start position of sprite (little endian)
	0x04-0x05: offset relative to begin of first entry in L2SS section (little endian)
		(DIFF_IFF: in .iff files, it's the offset divided by 16)
		however no entry size defining bytes are counted
		i.e. twice the entryID (start counting from 1) has to be added in order to get the real offset


animation data pointer "L2SA" section (variable size)
0x0000-0x0003:	"L2SA"
0x0004-0x0007:	section data size (big endian)
0x0008-0x0009:	number of entries/special-objects N (little endian)
	N entries (variable size):
	0x00-0x01: number M of frames (little endian)
	2*M bytes: list of M offsets (little endian) relative to begin of first entry in L2SF section


animation pointer "L2SI" section (variable size)
0x0000-0x0003:	"L2SI"
0x0004-0x0007:	section data size (big endian)
0x0008-0x0009:	number of entries/special-objects N (little endian)
2*N bytes:	list of N offsets (little endian) relative to first entry in L2SA section


palette data "L2PD" section
0x0000-0x0003:	"L2PD"
0x0004-0x0007:	section data size (big endian)
0x0008-0x0009:	number of entries (little endian)
	N entries (variable size):
	0x00-0x01: palette size in bytes M
		M bytes: M/3 3-byte RGB sets, value of the RGB component is 4*byte-value


palette pointer "L2PI" section
0x0000-0x0003:	"L2PI"
0x0004-0x0007:	section data size (big endian)
0x0008-0x0009:	number of entries (little endian)
2*N bytes:	list of N offsets (little endian) relative to first entry in L2PD section
		however no entry size defining bytes are counted
		i.e. twice the entryID has to be added in order to get the real offset


text data "L2TM" section
0x0000-0x0003:	"L2TM"
0x0004-0x0007:	section data size (big endian)
0x0008-0x0009:	number of entries (little endian)
	N entries (variable size):
	0x00-0x01: text size in bytes M
		M bytes: text


text pointer "L2TI" section
0x0000-0x0003:	"L2TI"
0x0004-0x0007:	section data size (big endian)
0x0008-0x0009:	number of entries (little endian)
2*N bytes:	list of N offsets (little endian) relative to first entry in L2TM section
		however no entry size defining bytes are counted
		i.e. twice the entryID has to be added in order to get the real offset


----------------
Stripped Format (intern.dat and masks.dat)
----------------
The same formap like .iff files, however DIFF_IFFs do not apply,
and the last four sections are missing,
requiring to use a palette from an external file.


----------------
Raw Format (icons.dat and panel.dat)
----------------
In panel.dat the data doesn't start at the beginning of this file,
therefore I refer to the section of data in this format in the file as 'subfile'

0x0000-0x0001:	number of entries N (little endian)
2*N bytes:	frame pointers relative to the beginning of the subfile
	2*N entries (frames), similar to L2SS:
	0x02-0x03: value 0
	0x04-0x05: value 0
	2*4 bytes: array of offsets (little endian) for each of the four pixel layers
		offset relative to the begin of the subfile
	4 layers of pixel information (variable size):
		each layer (for closer description see Appendix A):
			variable number of bytes: pixel data
			final byte 0xFF indicates end of layer information

----------------
VLEMMS Format
----------------
Header Info (12 bytes)
0x0000-0x0003: "FORM"
0x0004-0x0007: file size - 8 bytes (big endian)
0x0008-0x000b: "L2VG" (type: VG)

followed by a number (namely 0x7a) of sections labeled 'LM??' where ??
stands for some hexadecimal integer.

Lemming animation "LM??" section
0x0000-0x0003:	"LM??"
0x0004-0x0007:	section data size (big endian)
0x0008-0x0009:	number of entries N (little endian)
2*N bytes:	frame pointers relative to the beginning of the first entry
	2*N entries (frames), similar to L2SS:
	0x00-0x01: horizontal offset of the image from the top left corner of the animation coordinate system
	0x02-0x03: vertical offset of the image from the top left corner of the animation coordinate system
	0x04-0x05: frame pointer pointing to this fram + 6 (i.e. pointer to beginning of the size entries)
	0x06-0x07: x-size
	0x08-0x09: y-Size
	2*4 bytes: array of offsets (little endian) for each of the four pixel layers
		offset relative to the begin of the section + 8
	4 layers of pixel information (variable size):
		each layer (for closer description see Appendix A):
			variable number of bytes: pixel data
			final byte 0xFF indicates end of layer information


----------------
Contents
----------------

icons.dat
intern.dat
	palette depends on current tribe
masks.dat
panel.dat
	only data starting at 0x1590 is L2SS data
	up to that address the data is in bitmap format
vlemms.dat
	palette depends on current tribe
vstyle.dat
	same as map.iff
	

frontend/gfxiffs/award.iff
frontend/gfxiffs/end.iff
	none of the palettes in the file fits
frontend/gfxiffs/info.iff
	uses a separate palette for each of the tribes for the tribe icons
frontend/gfxiffs/intro.iff
frontend/gfxiffs/load.iff
frontend/gfxiffs/map.iff
frontend/gfxiffs/medals.iff
frontend/gfxiffs/menu.iff
frontend/gfxiffs/practice.iff
frontend/gfxiffs/prefs.iff
frontend/gfxiffs/tough.iff
	same as end.iff with a different second palette
	however none of the palettes in the file fits

introdat/gfxiffs/endscene.iff
introdat/gfxiffs/middle.iff
introdat/gfxiffs/intro.iff
	same as frontend/gfxiffs/intro.iff
introdat/gfxiffs/talisman.iff
	almost the same as talis2, only difference is a shading border around the talisman pieces in talisman.iff
introdat/gfxiffs/talis2.iff
	uses 3 or 4 different palettes for its data
introdat/gfxiffs/waking.iff



Appendix A: (L2SS) layer arrangement description
each layer N contains pixel information:
- Nth layer (counting begins at 0) contains the data for the pixels
  with x-position 4m+N (m is any non-negative integer) in sequential order
  i.e. to get the x-position in the final sprite, the 'internal' x position
  has to be multiplied by 4 and N has to be added
- each layer stores a list of data of the following form:
	1st byte: definition byte
	rest: list of pixel information, i.e. color index IDs (from palette L2PD) (one byte each)
		number of pixel information bytes is indicated by the definition bytes

definition byte value table (first/higher nybble is H, second/lower nybble is L):
- in the beginning the current x/y-position is 0
- after a pixel is set, the 'internal' x-position is increased by 1
- linebreak means x-position is reset, y-position increased by 1
0xFF:
	end of layer information
H<8; L=0:
	followed by H bytes of pixel information (H may be 0)
	after these pixels are set: linebreak
H<8; L<8:
	followed by L+H bytes of pixel information
H<8; L>=8:
	followed by H bytes of pixel information
	after these pixels are set: x-position increased by L-8
H>=8; H!=e; L<8:
	x-position increased by H-8
	followed by L bytes of pixel information
H=e; L>=8; L!=e:
	x-position increased by L-2
H>=8; H!=e; L>=8:
	effect unknown, not used in original gfx
