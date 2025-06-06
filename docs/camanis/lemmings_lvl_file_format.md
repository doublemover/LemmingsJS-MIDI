# Lemmings .LVL File Format


thanks to TalveSturges for the original alt.lemmings posting which got me
started on decoding the .lvl format

if you liked lemmings you should give CLONES a try. go to www.tomkorp.com
for more information.

this document will explain how to interpret the lemmings .lvl level
file for the windows version of lemmings (directly saved levels in LemEdit).

values preceded by 0x are hex values

a lemmings .lvl file is 2048 bytes ( 0x0000 to 0x07FF )

## GLOBALS

BYTES 0x0000 to 0x0001
Release Rate	: 0x0000 is slowest, 0x00FA is fastest

BYTES 0x0002 to 0x0003
Num of lemmings	: maximum 0x0072.  0x0010 would be 16 lemmings.

BYTES 0x0004 to 0x0005
Num to rescue	: should be less than or equal to number of lemmings

BYTES 0x0006 to 0x0007
Time Limit	: max 0x00FF, 0x0001 to 0x0009 works best

BYTES 0x0008 to 0x0017 (2 bytes each, only lower byte is used)
Num of skills	: max 0x00FA.  order is Climber, Floater, Bomber,
		  Blocker,Builder, Basher, Miner, Digger

BYTES 0x0018 to 0x0019
Start screen xpos : 0x0000 to 0x04F0.  is rounded to nearest multiple
		    of 8.

BYTES 0x001A to 0x001B
Normal Graphic Set: 0x0000 is dirt, 0x0001 is fire, 0x0002 is squasher,
		    0x0003 is pillar,0x0004 is crystal, 0x0005 is brick,
		    0x0006 is rock, 0x0007 is snow and 0x0008 is bubble.

BYTES 0x001C to 0x001D
Extended Graphic Set: Apparently ignored in windows version.

BYTES 0x001E to 0x001F
Something?	: doesn't seem to matter what goes here.  use 0x0000.

## OBJECTS
BYTES 0x0020 to 0x011F (8 byte blocks)

x pos  : min 0xFFF8, max 0x0638.  0xFFF8 = -24, 0x0001 = -16, 0x0008 = -8
         0x0010 = 0, 0x0018 = 8, ... , 0x0638 = 1576
	 note: should be multiples of 8

y pos  : min 0xFFD7, max 0x009F.  0xFFD7 = -41, 0xFFF8 = -8, 0xFFFF = -1
	 0x0000 = 0, ... , 0x009F = 159.
	 note: can be any value in the specified range

obj id : min 0x0000, max 0x000F.  the object id is different in each
	 graphics set, however 0x0000 is always an exit and 0x0001 is
 	 always a start.
	 note: see appendix a for full object listings

modifier : first byte can be 80 (do not overwrite existing terrain) or 40
	   (must have terrain underneath to be visible). 00 specifies always
	   draw full graphic.
	   second byte can be 8F (display graphic upside-down) or 0F (display
 	   graphic normally)

each 8 byte block starting at byte 0x0020 represents an interactive object. there
can be a maximum of 32 objects.  write 0x00 to fill bytes up to 0x0120 if
there are less than 32 objects.

## TERRAIN
BYTES 0x0120 to 0x075F (4 byte blocks)

x pos : min 0x0000, max 0x063F.  0x0000 = -16, 0x0008 = -8, 0x0010 = 0,
	0x063f = 1583.
	note: the xpos also contains modifiers.  the first nibble can be
	8 (do no overwrite existing terrain), 4 (display upside-down), or
	2 (remove terrain instead of add it). you can add them together.
	0 indicates normal.
	eg: 0xC011 means draw at xpos=1, do not overwirte, upside-down.

y pos : 9-bit value. min 0xEF0, max 0x518.  0xEF0 = -38, 0xEF8 = -37,
	0x020 = 0, 0x028 = 1, 0x030 = 2, 0x038 = 3, ... , 0x518 = 159
	note: the ypos value bleeds into the next value since it is 9bits.

terrain id: min 0x00, max 0x3F.  not all graphic sets have all 64 graphics.

each 4 byte block starting at byte 0x0120 represents a terrain object.
there can be a maximum of 400 terrain objects.  write 0xFF fill the bytes
up to byte 0x0760 if need be.

## STEEL AREAS
BYTES 0x0760 to 0x07DF (4 byte blocks)

x pos : 9-bit value.  min 0x000, max 0xC78.  0x000 = -16, 0x008 = -12,
	0x010 = -8, 0x018 = -4, ... , 0xC78 = 1580.
	note: each hex value represents 4 pixels.  since it is 9 bit value it
	      bleeds into the next attribute.

y pos : min 0x00, max 0x27. 0x00 = 0, 0x01 = 4, 0x02 = 8, ... , 0x27 = 156
	note: each hex value represents 4 pixels

area : min 0x00, max 0xFF.  the first nibble is the x-size, from 0 - F.
       each value represents 4 pixels. the second nibble is the y-size.
       0x00 = (4,4), 0x11 = (8,8), 0x7F = (32,64), 0x23 = (12,16)

eg: 00 9F 52 00 = put steel at (-12,124) width = 24, height = 12

each 4 byte block starting at byte 0x0760 represents a steel area which
the lemmings cannot bash through.  the first three bytes are given above,
and the last byte is always 00.. what a waste of space considering how
compact they made the first 3 bytes!  write 0x00 to fill each byte up to
0x07E0 if need be.

## LEVEL NAME
BYTES 0x07E0 to 0x07FF

a character string 32 bytes long. write 0x20 (space) to fill up the empty
bytes.










## APPENDIX A
available objects for each graphics set

	 graphics set 0:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = waving green flag
	                0x0003 = one-way block pointing left
	                0x0004 = one-way block pointing right
	                0x0005 = water
	                0x0006 = bear trap
	                0x0007 = exit decoration, flames
	                0x0008 = rock squishing trap
	                0x0009 = waving blue flag
	                0x000A = 10 ton squishing trap
	                0x000B - 0x000F = invalid
	 graphics set 1:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = waving green flag
	                0x0003 = one-way block pointing left
	                0x0004 = one-way block pointing right
	                0x0005 = red lava
	                0x0006 = exit decoration, flames
	                0x0007 = fire pit trap
	                0x0008 = fire shooter trap from left
	                0x0009 = waving blue flag
	                0x000A = fire shooter trap from right
	                0x000B - 0x000F = invalid
	 graphics set 2:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = waving green flag
	                0x0003 = one-way block pointing left
	                0x0004 = one-way block pointing right
	                0x0005 = green liquid
	                0x0006 = exit decoration, flames
	                0x0007 = waving blue flag
	                0x0008 = pillar squishing trap
	                0x0009 = spinning death trap
	                0x000A - 0x000F = invalid
	 graphics set 3:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = waving green flag
	                0x0003 = one-way block pointing left
	                0x0004 = one-way block pointing right
	                0x0005 = water
	                0x0006 = exit decoration, flames
	                0x0007 = waving blue flag
	                0x0008 = spinny rope trap
	                0x0009 = spikes from left trap
	                0x000A = spikes from right trap
	                0x000B - 0x000F = invalid
	 graphics set 4:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = waving green flag
	                0x0003 = waving blue flag
	                0x0004 = one-way block pointing left
	                0x0005 = one-way block pointing right
	                0x0006 = sparkle water
	                0x0007 = slice trap
	                0x0008 = exit decoration, flames
	                0x0009 = electrode trap
	                0x000A = zap trap
	                0x000B - 0x000F = invalid
	 graphics set 5:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = waving green flag
	                0x0003 = one-way block pointing left
	                0x0004 = one-way block pointing right
	                0x0005 = sandy water
	                0x0006 = hydraulic press trap
	                0x0007 = flatten wheel trap
	                0x0008 = waving blue flag
	                0x0009 = exit decoration, candy canes
	                0x000A - 0x000F = invalid
	 graphics set 6:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = waving green flag
	                0x0003 = one-way block pointing left
	                0x0004 = one-way block pointing right
	                0x0005 = wavy tentacles (water)
	                0x0006 = tentacle grab trap
	                0x0007 = exit decoration, green thing
	                0x0008 = licker from right trap
	                0x0009 = exit decoration, green thing
	                0x000A = licker from right trap
			0x000B = waving blue flag
	                0x000C - 0x000F = invalid
	 graphics set 7:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = waving green flag
	                0x0003 = one-way block pointing left
	                0x0004 = one-way block pointing right
	                0x0005 = ice water
	                0x0006 = exit decoration, red flag
	                0x0007 = waving blue flag
	                0x0008 = icicle point trap
	                0x0009 = ice blast from left trap
	                0x000A - 0x000F = invalid
	 graphics set 8:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = waving green flag
	                0x0003 = one-way block pointing left
	                0x0004 = one-way block pointing right
	                0x0005 = bubble water
	                0x0006 = exit decoration, red thing
	                0x0007 = waving blue flag
	                0x0008 = zapper from left trap
	                0x0009 = sucker from top trap
	                0x000A = gold thing??
	                0x000B - 0x000F = invalid
	 graphics set 9:
	                0x0000 = exit
	                0x0001 = start
	                0x0002 = gift box
	                0x0003 = exit decoration, flames
	                0x0004 = bouncing snowman
	                0x0005 = twinkling xmas lights
	                0x0006 = fireplace - bottom
	                0x0007 = fireplace - top
	                0x0008 = santa-in-the-box bottom
	                0x0009 = santa-in-the-box top
	                0x000A- 0x000F = invalid
