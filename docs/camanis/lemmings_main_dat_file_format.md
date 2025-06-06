# The main.dat file format
*by ccexplore and Mindless*

## 1) Intro

main.dat is the file in the DOS Lemmings game that contains the core graphics needed by the game, such as the main menu, the lemmings animation, etc.  Actually, to be accurate, it's the graphics used when you run in the game in EGA/VGA mode.  The CGA/Tandy mode pulls graphics from cgamain.dat instead.

To decipher this file properly, you first need to decompress it.  It uses the same compression scheme that other dat files uses (notably, it's the same scheme used for the levelset dat files, the XgagrX files, the XgaspecX files, and the sound drivers [adlib.dat etc]).  The decompression algorithm is covered elsewhere, so it is not repeated here.  There are programs available to decompress DAT files.

After decompression of main.dat, you should get 7 sections.  The contents of each section are as follows:

  section 0: lemming animations 
  section 1: exploder countdown numerals, terrain destruction masks (nuke, mine, bash, maybe others) 
  section 2: skill numbers, skill panel graphics and numbers and letters for "PS2/high performance" machine mode
  section 3: brown background, lemmings holding signs, music/fx sign 
  section 4: purple text, blinking lemming eyes, scroller (lemmings and reel), difficulty selector sign 
  section 5: unknown 
  section 6: skill panel graphics, green numbers and letters

Note that this doc concerns the main.dat file from the DOS version of "Lemmings".  The DOS Xmas Lemmings games and the "Oh No! More Lemmings" games have slightly different graphics, so their main.dat should be slightly different, but the overall format should be identical, so you can still use the information here to explore the contents in those games' main.dat.


## 2) format and palette of graphics

All bitmaps are planar.  The explanation of planar bitmaps can be found on Wikipedia or documentation on the groundXo/vgagrX files, and will not be repeatedhere.  The number of bitplanes and the width/height of the bitmaps may vary, these metadata will be listed further down in this doc.

The game uses two 16-color palettes.  One is for the main menu and level preview screen, the other is when you're in a level itself.

The main-menu palette:

  idx      R,G,B      color
  ---  -------------  -----
   0   (  0,  0,  0)  Black 
   1   (128, 64, 32)  Browns 
   2   ( 96, 48, 32) 
   3   ( 48,  0, 16)
   4   ( 32,  8,124)  Purples 
   5   ( 64, 44,144)
   6   (104, 88,164) 
   7   (152,140,188) 
   8   (  0, 80,  0)  Greens
   9   (  0, 96, 16)
  10   (  0,112, 32)
  11   (  0,128, 64)
  12   (208,208,208)  White 
  13   (176,176,  0)  Yellow 
  14   ( 64, 80,176)  Blue 
  15   (224,128,144)  Pink  


The in-level palette:

  idx      R,G,B      color
  ---  -------------  -----
   0   (  0,  0,  0)  Black
   1   ( 64, 64,224)  Blue
   2   (  0,176,  0)  Green
   3   (240,208,208)  White
   4   (176,176,  0)  Yellow
   5   (240, 32, 32)  Red
   6   (128,128,128)  Grey

The upper 8 colors of the in-level palette are loaded from the groundXo files and/or the vgaspecX files, depending on which graphics set the level uses.  Color idx 7 is generally set to the color of idx 8.  Color idx 7 is the color used to render the build bricks and the mini-map at the bottom right.

Note that the values above are for VGA only.  Values for the EGA will be added to this doc in the future [read: probably never :p].

The color idx 0 is often interpreted as "transparent" in many if not all of the main.dat graphics.


## 3) section 0 details

Section 0 contains all the lemmings animations, such as walking, climbing, etc. Note that most of them have a left (l) and a right (r) version corresponding to which direction the lemming is facing.  Width and Height are in pixels.

   offset (hex)  description        # of frames  width x height  bpp
   ------------  -----------------  -----------  --------------  ---
    [0x0000]     walking (r)              8          16x10        2
    [0x0140]     jumping (r)              1          16x10        2
    [0x0168]     walking (l)              8          16x10        2
    [0x02A8]     jumping (l)              1          16x10        2
    [0x02D0]     digging                 16          16x14        3
    [0x0810]     climbing (r)             8          16x12        2
    [0x0990]     climbing (l)             8          16x12        2
    [0x0B10]     drowning                16          16x10        2
    [0x0D90]     post-climb (r)           8          16x12        2
    [0x0F10]     post-climb (l)           8          16x12        2 
    [0x1090]     brick-laying (r)        16          16x13        3 
    [0x1570]     brick-laying (l)        16          16x13        3 
    [0x1A50]     bashing (r)             32          16x10        3 
    [0x21D0]     bashing (l)             32          16x10        3 
    [0x2950]     mining (r)              24          16x13        3 
    [0x30A0]     mining (l)              24          16x13        3 
    [0x37F0]     falling (r)              4          16x10        2 
    [0x3890]     falling (l)              4          16x10        2 
    [0x3930]     pre-umbrella (r)         4          16x16        3
    [0x3AB0]     umbrella (r)             4          16x16        3 
    [0x3C30]     pre-umbrella (l)         4          16x16        3 
    [0x3DB0]     umbrella (l)             4          16x16        3
    [0x3F30]     splatting               16          16x10        2 
    [0x41B0]     exiting                  8          16x13        2 
    [0x4350]     fried                   14          16x14        4 
    [0x4970]     blocking                16          16x10        2 
    [0x4BF0]     shrugging (r)            8          16x10        2 
    [0x4D30]     shrugging (l)            8          16x10        2 
    [0x4E70]     oh-no-ing               16          16x10        2 
    [0x50F0]     explosion                1          32x32        3

Note: for "digging", "bashing", and "mining", the animation frames include the particles.  For "explosion", the subsequent shower of particles are drawn separately by the game itself.

"jumping" refers to the animation when a walker walks up a step that's 3 pixels to 6 pixels tall.

"post-climb" refers to the animation when a climber reaches the top and transitions to a walker.

Although the "bashing" animations have 32 frames, note that they actually include 2 bash strokes per 32 frames.

"pre-umbrella" and "umbrella" refers to floater animations.  "pre-umbrella" is when the floater's parachute starts to open, and "umbrella" is the animation of floating down after the parachute fully opens.

"splatting" refers to when a non-floater lemming falls from too high and hits ground.

"fried" refers to the action of certain traps, such as the spinning flame-throwing trap on level 9 of rating Fun ("As long as you try your best"), or the flaming-coal-pit traps on level 18 of rating Fun ("Let's Block and Blow").

"shrugging" refers to the shrug the builder makes when he runs out of build bricks and is about to transition to a walker.

"oh-no-ing" refers to the animation of the lemming trembling when the explosion countdown reached 0 and the lemming is about to explode.  After the "oh-no-ing" animation is finished the explosion occurs, taking out terrain pixels and displaying the explosion graphic (a typical explosion fireball).


## 4) section 1 details

Section 1 contains two sets of bitmaps.  One set are the masks used to take out terrain pixels as the result of certain lemming actions (bashing and exploding, for example).  There can be multiple frames of masks per action because the terrain-destruction effect is often animated.  The multiple frames don't necessarily overlap perfectly, depending on how the game updates the lemming's position while it is carrying out the action.  In the mask bitmaps, a 1 bit means a pixel that will be taken out, 0 bit means leave the pixel alone.

Because bashing and mining have a left (l) and right (r) version, naturally their masks also have left/right versions.

The other set of bitmaps are the font for the explosion-countdown number you see on top of a lemming's head.  Although the explosion always starts from "5" in the game and never actually shows "0", the font includes all digits from 0 to 9.  The game always maps 1 to white and 0 to transparent for these bitmaps.

   offset (hex)  description        # of frames  width x height  bpp
   ------------  -----------------  -----------  --------------  ---
    [0x0000]     bash masks (r)          4           16x10        1
    [0x0050]     bash masks (l)          4           16x10        1
    [0x00A0]     mine masks (r)          2           16x13        1
    [0x00D4]     mine masks (l)          2           16x13        1
    [0x0108]     explosion mask          1           16x22        1
    [0x0134]     "9"                     1            8x8         1
    [0x013C]     "8"                     1            8x8         1
    [0x0144]     "7"                     1            8x8         1
    [0x014C]     "6"                     1            8x8         1
    [0x0154]     "5"                     1            8x8         1
    [0x015C]     "4"                     1            8x8         1
    [0x0164]     "3"                     1            8x8         1
    [0x016C]     "2"                     1            8x8         1
    [0x0174]     "1"                     1            8x8         1
    [0x017C]     "0"                     1            8x8         1


## 5) section 2 details

Section 2 contains 3 sets of bitmaps.  Two of them are only used by the game when run in the "IBM PS/2" or "High Performance" modes, which apparently has slightly different graphics than the ones used in the "PC Compatible"/"Tandy"/"AMSTRAD" modes (corresponding graphics for those are located in section 6).

Note that the normal in-level palette is obviously wrong for the high-perf 8x16 font.  I currently don't know what the correct palette should be.

The skill panel graphics actually represents the entire bottom of the in-level screen, that is, everything below the level graphics itself.  As such, in addition to the skill toolbar, it also contains the boundary rectangle for the mini-map, as well as blank spaces at the top reserved for displaying level status (number of lemmings out, number of lemmings saved, time remaining, etc.)

The 8x16 font is used for rendering text in the level status area (number of lemmings out etc.)

The 8x8 skill number digits font is used for rendering the numbers in the skills toolbar indicating how many skills you have left.  There are a left (l) and right (r) versions for each digit, because each digit is in fact really only 4 pixels wide.  So the game made a version with the digit set on the left half of the 8x8 area, and a corresponding right-half version.  This makes it easy to combine a left and a right digit to form any 2-digit number.  These are used in both the standard and high-perf machine modes.


(the high-perf skill panel)

   offset (hex)  description              # of frames  width x height  bpp
   ------------  -----------------------  -----------  --------------  ---
    [0x0000]     skill panel (high-perf)       1          320x40        4

(the following are the skill number digits)

   offset (hex)  description            # of frames  width x height  bpp
   ------------  ---------------------  -----------  --------------  ---
    [0x1900]     "0" (r)                     1            8x8         1 
    [0x1908]     "0" (l)                     1            8x8         1 
    [0x1910]     "1" (r)                     1            8x8         1 
    [0x1918]     "1" (l)                     1            8x8         1 
    [0x1920]     "2" (r)                     1            8x8         1 
    [0x1928]     "2" (l)                     1            8x8         1 
    [0x1930]     "3" (r)                     1            8x8         1 
    [0x1938]     "3" (l)                     1            8x8         1 
    [0x1940]     "4" (r)                     1            8x8         1 
    [0x1948]     "4" (l)                     1            8x8         1 
    [0x1950]     "5" (r)                     1            8x8         1 
    [0x1958]     "5" (l)                     1            8x8         1 
    [0x1960]     "6" (r)                     1            8x8         1 
    [0x1968]     "6" (l)                     1            8x8         1 
    [0x1970]     "7" (r)                     1            8x8         1 
    [0x1978]     "7" (l)                     1            8x8         1 
    [0x1980]     "8" (r)                     1            8x8         1 
    [0x1988]     "8" (l)                     1            8x8         1 
    [0x1990]     "9" (r)                     1            8x8         1 
    [0x1998]     "9" (l)                     1            8x8         1

(the remaining bitmaps are individual characters of the high-perf 8x16 font)

   offset (hex)  description            # of frames  width x height  bpp
   ------------  ---------------------  -----------  --------------  ---
    [0x19A0]     "%" (high perf)             1            8x16        3 
     ... 

To avoid repeating the table for all characters, here's the list of them:

% 0 1 2 3 4 5 6 7 8 9 - A B C D E F G H I J K L M N O P Q R S T U V W X Y Z

So the offset to a character is, in hex, 0x19A0 + 0x30 * character index, where character index is the 0-based ordinal of the character in the list above, with the first character (%) being character index 0.


## 6) section 3 details

Section 3 contains the major graphical pieces that form the game's main menu.

   offset (hex)  description              # of frames  width x height  bpp
   ------------  -----------------------  -----------  --------------  ---
    [0x0000]     brown background              1          320x104       2
    [0x2080]     Lemmings logo                 1          632x94        4 
    [0x9488]     F1 sign                       1          120x61        4 
    [0xA2D4]     F2 sign                       1          120x61        4
    [0xB120]     F3 sign                       1          120x61        4
    [0xBF6C]     Level Rating sign             1          120x61        4 
    [0xCDB8]     Exit to DOS sign              1          120x61        4 
    [0xDC04]     F4 sign                       1          120x61        4
    [0xEA50]     music note icon               1           64x31        4
    [0xEE30]     "FX" icon                     1           64x31        4

The brown background is tiled multiple times across and down the screen I think.

The Lemmings logo is only 1 frame, although some of the lemmings in the logo have blinking eyes.  The blinking eyes animation are stored separately in section 4.

The various "sign" graphics includes the graphics of the lemmings that are holding the sign, but again, the blinking eyes animation for some of these lemmings are stored in section 4.

The F3 sign (for setting sound option to music/FX only/no sound) graphics is a blank F3 sign, corresponding to the "no sound" option.  For the other two options, the game draws over this sign the music note icon or the "FX" icon.  Note that both icon bitmaps contain more than just the icon, they in fact contain parts of the lemmings holding the sign as well (the feet in particular, if I recall).

The Level Rating sign is the one where you select which sets of levels (Fun, Tricky, Taxing, Mayhem) to play.  The bitmap at 0xBF6C is drawn with the "Fun" rating.  However, the actual rating bitmaps (including one for Fun) are stored elsewhere in section 4.

Note that the shadows you see at certain graphics in the main menu is actually something the game dynamically draws.  So changing the graphics will also change the shadows correspondingly.


## 7) section 4 details

Section 4 contains the remaining graphics for the game's main menu, as well as the font for the purple text you see on the various screens outside a level.

   offset (hex)  description                     # of frames  width x height  bpp
   ------------  -----------------------------   -----------  --------------  ---
    [0x0000]     blink1                               8           32x12        4
    [0x0600]     blink2                               8           32x12        4
    [0x0C00]     blink3                               8           32x12        4
    [0x1200]     blink4                               8           32x12        4
    [0x1800]     blink5                               8           32x12        4
    [0x1E00]     blink6                               8           32x12        4
    [0x2400]     blink7                               8           32x12        4

    [0x2A00]     left Lemming working scroller       16           48x16        4
    [0x4200]     right Lemming working scroller      16           48x16        4
    [0x5A00]     reel                                 1           16x16        4

    [0x5A80]     mayhem sign                          1           72x27        4
    [0x5E4C]     taxing sign                          1           72x27        4
    [0x6218]     tricky sign                          1           72x27        4
    [0x65E4]     fun sign                             1           72x27        4

    [0x69B0]     "!"                                  1           16x16        3
    [0x6A10]...  (contains the remaining ASCII characters)

The various "blink" animations are the blinking eyes for the various lemmings in the main menu screen.  I forgot which one is for which.  They include a small part of the faces as well.

The left Lemming/right Lemming/reel bitmaps form the scrolling credits at the bottom of the main menu screen.  The left/right lemming animations includes the lemming and scroll wheel at each end of the reel.  The reel bitmap is tiled from one end to another to form the full reel (and the game redraws it in slightly different positions over time to create the scrolling effect).  The purple text in the scrolling credits are drawn with the generic purple font.

The rating signs are drawn over the "Level Rating Sign" mentioned in section 3.  The signs here basically are replacements for the rectangle-board part of the "Level Rating Sign" graphic in section 3.

Finally, the last part are the individual characters of the generic purple text font.  This font is used pretty much everywhere except the in-level screens.  It contains all ASCII characters from "!" to "~", in the ASCII order.  So you can find the offset to ASCII character number n via the following formula:

0x69B0 + (n - 0x21) * 0x60.


## 8) section 5

No details are currently available for section 5.  No one knows what it does.  Setting it to all 0s does not seem to affect anything in the game, visually or otherwise.  Note in particular that it does not affect how the particles for a lemmings explosion is drawn, so that isn't it.

Curiously, both main.dat and cgamain.dat contain this section, and the contents are identical in both files.  The data in this section might be nongraphical.


## 9) section 6 details

Section 6 contains most of the in-level graphics, such as the skill panel and green text font, as used when the game is run in the standard "PC Compatible" mode.  I believe they are used in the other machine modes as well, with the exception of the "IBM PS/2" ("High Performance") mode, which gets its graphics from section 2 instead.

   offset (hex)  description  # of frames  width x height  bpp
   ------------  -----------  -----------  --------------  ---
    [0x0000]     skill panel       1          320x40        4
    [0x1900]     "%"               1            8x16        3
    [0x1930]...  (remaining green text characters used for level status area)

Since this section is very similar to section 2, reread section 2 for details on the various bitmaps.  The in-level palette listed in this doc should be accurate for the graphics here, unlike the graphics in section 2.

Recall that the font used for the level status area (number of lemmings out etc.) contains these characters:
 
% 0 1 2 3 4 5 6 7 8 9 - A B C D E F G H I J K L M N O P Q R S T U V W X Y Z

So in this section, you can get the offset to a character with the formula 0x1900 + i * 0x30.
