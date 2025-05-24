import { Lemmings } from './LemmingsNamespace.js';

// ---------------------------------------------------------------------------
//  Constants – hoisted outside the class so they are evaluated only once and
//  the engine can inline them. This avoids re‑allocations on every instance
//  and lets V8 treat them as true compile‑time constants.
// ---------------------------------------------------------------------------
const OBJECT_COUNT          = 16;
const TERRAIN_COUNT         = 64;
const BYTE_SIZE_OF_OBJECTS  = 28 * OBJECT_COUNT;
const BYTE_SIZE_OF_TERRAIN  = 8  * TERRAIN_COUNT;

class GroundReader {
  /**
   * @param {Lemmings.FileReader} groundFile  – GROUNDxO.DAT (1056 bytes)
   * @param {Lemmings.FileReader} vgaTerrain  – slice of VGAGx.DAT (terrain)
   * @param {Lemmings.FileReader} vgaObject   – slice of VGAGx.DAT (objects)
   */
  constructor (groundFile, vgaTerrar, vgaObject) {
    // ---------------------------------------------------------------------
    //  Fast‑fail on incorrect input – no work done, avoids hidden‑class churn
    // ---------------------------------------------------------------------
    this.log = new Lemmings.LogHandler('GroundReader');
    if (groundFile.length !== 1056) {
      this.log.log(`groundFile ${groundFile.filename} has wrong size: ${groundFile.length}`);
      return;
    }

    // ---------------------------------------------------------------------
    //  Pre‑allocate fixed‑length arrays so their shape never changes, which
    //  keeps them in V8 "fast elements" mode for O(1) access.
    // ---------------------------------------------------------------------
    this.imgObjects    = new Array(OBJECT_COUNT);
    this.imgTerrain     = new Array(TERRAIN_COUNT);

    this.groundPalette = new Lemmings.ColorPalette();
    this.colorPalette  = new Lemmings.ColorPalette();

    // Palette offset is the last block in the file – compute once.
    const paletteOffset = BYTE_SIZE_OF_OBJECTS + BYTE_SIZE_OF_TERRAIN;

    this.#readPalettes(groundFile, paletteOffset);
    this.#readObjectImages(groundFile, /*offset=*/0, this.colorPalette);
    this.#readTerrainImages(groundFile, BYTE_SIZE_OF_OBJECTS, this.groundPalette);

    // Decode bitmaps – these calls can be parallelised in WebWorkers later.
    this.#readImages(this.imgObjects, vgaObject, /*bpp=*/4);
    this.#readImages(this.imgTerrain, vgaTerrar, /*bpp=*/3);
  }

  // -----------------------------------------------------------------------
  //  Public accessors – tiny inlineable getters.
  // -----------------------------------------------------------------------
  getTerrainImages() { return this.imgTerrain;  }
  getObjectImages () { return this.imgObjects; }

  // -----------------------------------------------------------------------
  //  Private helpers – prefixed with # so the engine can de‑virtualise them.
  // -----------------------------------------------------------------------
  #readImages (imgList, vga, bitPerPixel) {
    for (let i = 0, len = imgList.length; i < len; ++i) {
      const img = imgList[i];
      if (img == null) continue; // hack to continue if missing img
      const frames = new Array(img.frameCount); // packed array – no pushes

      let filePos = img.imageLoc;
      //console.log("frame images count: " + img.frameCount)
      for (let f = 0; f < img.frameCount; ++f) {
        const bitImage = new Lemmings.PaletteImage(img.width, img.height);
        bitImage.processImage(vga, bitPerPixel, filePos);
        bitImage.processTransparentData(vga, filePos + img.maskLoc);
        frames[f] = bitImage.getImageBuffer();
        filePos  += img.frameDataSize; // increment once, avoid extra mul
      }

      img.frames = frames;
    }
  }

  #readObjectImages (fr, offset, palette) {
    fr.setOffset(offset);

    //console.log("obj count: " + OBJECT_COUNT)
    for (let i = 0; i < OBJECT_COUNT; ++i) {
      const img      = new Lemmings.ObjectImageInfo();
      const flags    = fr.readWordBE();

      // The following property assignments are grouped to keep the hidden
      // class stable and help TurboFan generate monomorphic inline caches.
      img.animationLoop        = (flags & 1) === 0;
      img.firstFrameIndex      = fr.readByte();
      img.frameCount           = fr.readByte();
      img.width                = fr.readByte();
      img.height               = fr.readByte();
      img.frameDataSize        = fr.readWordBE();
      img.maskLoc              = fr.readWordBE();
      img.unknown1             = fr.readWordBE();
      img.unknown2             = fr.readWordBE();
      img.trigger_left         = fr.readWordBE() * 4;
      img.trigger_top          = fr.readWordBE() * 4 - 4;
      img.trigger_width        = fr.readByte() * 4;
      img.trigger_height       = fr.readByte() * 4;
      img.trigger_effect_id    = fr.readByte();
      img.imageLoc             = fr.readWordBE();
      img.preview_image_index  = fr.readWordBE();
      img.unknown              = fr.readWordBE();
      img.trap_sound_effect_id = fr.readByte();
      img.palette              = palette;

      if (fr.eof()) {
        this.log.log(`readObjectImages(): unexpected EOF reading ${fr.filename}`);
        return;
      }
      this.imgObjects[i] = img;
    }
  }

  #readTerrainImages (fr, offset, palette) {
    fr.setOffset(offset);

    for (let i = 0; i < TERRAIN_COUNT; ++i) {
      const img   = new Lemmings.TerrainImageInfo();
      img.width   = fr.readByte();
      img.height  = fr.readByte();

      let filename = fr.filename;
      if (filename == "GROUND0O.DAT") {
        if (i >= 22 && i <= 26) { // normal maps 

        }
        if (i >= 51 && i <= 54) { // brick maps

        }
      } else if (filename == "GROUND1O.DAT") {
        if (i >= 12 && i <= 15 || i == 17) { // dungeon maps

        }
        if (i >= 56 && i <= 59) { // jungle maps

        }
      } else if (filename == "GROUND2O.DAT") {
        if (i == 5 || i >= 57 && i <= 59) { // pink maps

        }
        if (i >= 29 && i <= 32) { // ice maps

        }
      } else if (filename == "GROUND3O.DAT") {
        if (i == 27 || i >= 48 && i <= 50) { // desert maps

        }
      } else if (filename == "GROUND4O.DAT") {
        if (i >= 31 && i <= 32 || i == 34) { // crystal maps

        }
      }

        // brick maps
        // steel on Snuggle up to a lemming (2-1-5)
        //          Thats a good level (2-2-1)
        //          Many lemmings make level work (2-2-3)
        //          and now the end is near (2-2-7)
        //          lemming friendly (2-2-12)
        //          worra load of blocks (2-2-15)
        //          lemming rhymes (2-3-3)
        //          you take the high road (2-3-7)
        //          mutiny on the bounty (2-3-11)
        //          onward and upward (2-3-13)
        //          the silence of the lemmings (2-3-15)
        //          take care, sweetie (2-3-16)
        //          the chain with no name (2-3-17)
        //          got anything lemmingy (2-3-20)
        //          lemming tomato ketchup facility (2-4-1)
        //          introducing superlemming (2-4-2)
        //          this corrosion (2-4-3)
        //          fourth dimension (2-4-4)
        //          temple of love (2-4-10)
        //          suicidal tendencies (2-4-12)
        //          almost nearly vr (2-4-13)
        //          the lemming learning curve (2-4-14)
        //          five alive (2-4-16)
        //          up down round (2-4-19)
        //          funhouse (2-4-20)
        //          be more than just a number (2-5-2)
        //          lemming bout town (2-5-8)
        //          sync lem (2-5-14)
        //          lemmings in a situation (2-5-18)

        // ice maps (GROUND2O.DAT) 
        // steel on the stack (2-2-6)
        //          ice ice lemming (2-2-20)
        //          lemming hotel (2-3-2)
        //          spam egg lem (2-4-15)
        //          lots more (2-4-18)
        //          tubular lem (2-5-1)
        //          have an ice day (2-5-15)
        //          nippy (2-5-19)

        // jungle maps (GROUND1O.DAT) 
        // steel on ROCKY VI (2-2-10)
        //          meeting adjourned (2-3-4)
        //          its a tight fit (2-3-8)
        //          hig pig (2-3-10)
        //          lemmingdelica (2-3-19)
        //          welcome to the party (2-5-11)
        //          scaling the heights (2-5-16)
        //          where lemmings dare (2-5-17)

        // desert maps (GROUND3O.DAT)
        // steel on Perserverance (1-1-10)
        //          Curse of the Pharoahs (1-1-29)
        //          Have a nice day! (1-2-13)
        //          Cascade (1-2-25)
        //          Call in the bomb squad (1-3-27)
        //          Save me (1-4-29)

        // pink maps (GROUND2O.DAT)
        // steel on Compression Method 1 (1-1-17)
        //          It's Hero Time! (1-1-24)
        //          Come on over to my place (1-1-27)
        //          Time to get up! (1-2-11)
        //          Pillars of Herc (1-4-10)
        //          Pea Soup (1-4-14)
        //          mind the step (1-4-28)

        // normal maps (GROUND0O.DAT)
        // steel on The Steel Mines of Kestrel (1-1-21)
        //          Every lemming for himself  (1-2-4)
        //          One way or another (1-2-9)
        //          The island of wicker people (1-2-27)
        //          Lost something? (1-2-28)
        //          Watch out, there's traps about (1-3-2)
        //          Steel works (1-4-1)
        //          The far side (1-4-12)
        //          And then there were four (1-4-18)
        //          Rendezvous at the mountain (1-4-30)

        // dungeon maps (GROUND1O.DAT)
        // steel on X marks the spot (1-1-23)
        //          Down, up, along, in that order (1-1-28)
        //          All or nothing (1-1-30)
        //          King of the castle (1-2-8)
        //          The fast food kitchen (1-2-10)
        //          Livin on the edge (1-3-12)
        //          Marry poppins land (1-3-16)
        //          Feel the heat! (1-3-21)
        //          Take a running jump (1-3-24)
        //          Triple Trouble (1-3-26)
        //          The Boiler Room (1-4-2)
        //          Last one out is a rotten egg (1-4-8)
        //          The fast food kitchen (1-4-15)

        // crystal maps (GROUND4O.DAT)
        // steel on The Art Gallery (1-2-5)
        //          POOR WEE CREATURES! (1-3-28)
        //          Going up... (1-4-23)


      img.imageLoc = fr.readWordBE();
      img.maskLoc  = fr.readWordBE() - img.imageLoc; // delta to stay compatible
      img.vgaLoc   = fr.readWordBE();
      img.palette  = palette;
      img.frameCount = 1; // terrains never animate

      if (fr.eof()) {
        this.log.log(`readTerrainImages(): unexpected EOF reading ${fr.filename}`);
        return;
      }
      this.imgTerrain[i] = img;
    }
  }

  #readPalettes (fr, offset) {
    // Skip EGA palettes – they are unused in the VGA version (3×8 bytes)
    fr.setOffset(offset + 24);

    const gp = this.groundPalette;
    const cp = this.colorPalette;

    // Index 8‒15 for ground (terrain) palette
    for (let i = 0; i < 8; ++i) {
      gp.setColorRGB(i, fr.readByte() << 2, fr.readByte() << 2, fr.readByte() << 2);
    }

    // Index 0‒7 for object palette
    for (let i = 0; i < 8; ++i) {
      cp.setColorRGB(i, fr.readByte() << 2, fr.readByte() << 2, fr.readByte() << 2);
    }

    // Index 8‒15 for preview (shared with objects)
    for (let i = 8; i < 16; ++i) {
      cp.setColorRGB(i, fr.readByte() << 2, fr.readByte() << 2, fr.readByte() << 2);
    }
  }
}

Lemmings.GroundReader = GroundReader;
export { GroundReader };
