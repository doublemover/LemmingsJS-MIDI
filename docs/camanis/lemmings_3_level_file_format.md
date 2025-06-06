# Lemmings 3 Level Files Documentation

by Mindless and geoo89

(all data is stored in little-endian words, i.e. 2 bytes per field, unless otherwise noted)

## LEVELS\\LEVELxxx.DAT
```
0x00  -- lemming style  (0x04 -> classic, 0x0a -> shadow, 0x05 -> egyptian)
0x02  -- refers to GRAPHICS\\CAVExxx.MAP files  (never used)
0x04  -- refers to GRAPHICS\\CAVExxx.RAW files  (never used)
0x06  -- refers to LEVELS\\TEMPxxx.OBS file to load  (destroyable objects)
0x08  -- refers to LEVELS\\PERMxxx.OBS file to load  (undestroyable objects, skills, extra lemmings)
0x0a  -- level style  (0x01 -> classic, 0x02 -> shadow, 0x03 -> egyptian)
0x0c  -- level width  (in pixels, must be divisible by 4, min: 320, max: 1280?)
0x0e  -- level height (in pixels, must be divisible by 4, min: 160, max: 400?)
0x10  -- start x position  (in pixels, must be divisible by 4)
0x12  -- start y position  (in pixels, must be divisible by 4)
0x14  -- time limit  (in seconds)
0x16  -- (byte) number of extra lemmings
0x17  -- ???
0x18  -- release rate
0x1a  -- release delay
0x1c  -- number of enemies
```

## LEVELS\\PERMxxx.OBS and LEVELS\\TEMPxxx.OBS
```
0x00  -- object 1 id
0x02  -- object 1 x  (in pixels, must be divisible by 8)
0x04  -- object 1 y  (in pixels, must be divisible by 2)
0x06  -- object 2 id
0x08  -- object 2 x  (in pixels, must be divisible by 8)
0x0a  -- object 2 y  (in pixels, must be divisible by 2)
....  repeat for all objects (minimum of 1 object, maximum of at least 512)
```
