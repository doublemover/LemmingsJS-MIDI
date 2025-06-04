import { Lemmings } from './LemmingsNamespace.js';

const OBJECT_COUNT          = 16;
const TERRAIN_COUNT         = 64;
const BYTE_SIZE_OF_OBJECTS  = 28 * OBJECT_COUNT;
const BYTE_SIZE_OF_TERRAIN  = 8  * TERRAIN_COUNT;
const TRANSPARENT = 128;

class GroundReader {
  /**
   * @param {Lemmings.FileReader} groundFile  – GROUNDxO.DAT (1056 bytes)
   * @param {Lemmings.FileReader} vgaTerrain  – slice of VGAGx.DAT (terrain)
   * @param {Lemmings.FileReader} vgaObject   – slice of VGAGx.DAT (objects)
   */
  constructor (groundFile, vgaTerrain, vgaObject) {
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

    this._readPalettes(groundFile, paletteOffset);
    this._readObjectImages(groundFile, /*offset=*/0, this.colorPalette);
    this._readTerrainImages(groundFile, BYTE_SIZE_OF_OBJECTS, this.groundPalette);

    // Decode bitmaps – these calls can be parallelised in WebWorkers later.
    this._readImages(this.imgObjects, vgaObject, /*bpp=*/4);
    this._readImages(this.imgTerrain, vgaTerrain, /*bpp=*/3);
  }

  getTerrainImages() { return this.imgTerrain;  }
  getObjectImages () { return this.imgObjects; }

  // -----------------------------------------------------------------------
  //  Private helpers – prefixed with _ so the engine can de‑virtualise them.
  // -----------------------------------------------------------------------
  _readImages (imgList, vga, bitsPerPixel) {
    for (let i = 0, imgCount = imgList.length; i < imgCount; ++i) {
      const img = imgList[i];
      if (!img) continue; // hack to continue if missing img

      const frames = new Array(img.frameCount);
      let maxSteelW = 0, maxSteelH = 0;

      let filePos = img.imageLoc;

      for (let f = 0; f < img.frameCount; ++f) {
        const pimg = new Lemmings.PaletteImage(img.width, img.height);
        pimg.processImage(vga, bitsPerPixel, filePos);
        pimg.processTransparentData(vga, filePos + img.maskLoc);

        const frame = pimg.getImageBuffer();
        frames[f]   = frame;
        filePos    += img.frameDataSize;

        if (img.isSteel) {
          let widest  = 0;
          let tallest = 0;

          // scan each row once from the right 
          for (let y = img.height - 1; y >= 0; --y) {
            const rowBase = y * img.width;
            let rowHasPixel = false;

            // scan from rightmost column until we see a solid pixel
            for (let x = img.width - 1; x >= 0; --x) {
              if (frame[rowBase + x] !== TRANSPARENT) {
                if (x + 1 > widest)  widest = x + 1;
                rowHasPixel = true;
                break;
              }
            }

            if (rowHasPixel && tallest === 0) {
              tallest = y + 1;          // first solid row from the bottom
              if (widest === img.width) break;
            }
          }

          if (widest  > maxSteelW) maxSteelW = widest;
          if (tallest > maxSteelH) maxSteelH = tallest;
        }
      }

      if (img.isSteel) {
        img.steelWidth  = maxSteelW;
        img.steelHeight = maxSteelH;
      }
      img.frames = frames;
    }
  }

  _readObjectImages (fr, offset, palette) {
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

      if (img.unknown1 !== img.maskLoc)
        this.log.log(`OBJ ${i}: unknown1 diverges from maskLoc (expected ${img.maskLoc}, got ${img.unknown1})`);
      if (img.unknown2 !== (img.maskLoc >> 1))
        this.log.log(`OBJ ${i}: unknown2 should be maskLoc/2 (got ${img.unknown2})`);
      if (img.unknown !== 0)
        this.log.log(`OBJ ${i}: unknown3 is non-zero (${img.unknown}) – CGA asset?`);

      if (fr.eof()) {
        this.log.log(`readObjectImages(): unexpected EOF reading ${fr.filename}`);
        return;
      }
      this.imgObjects[i] = img;
    }
  }

  _readTerrainImages (fr, offset, palette) {
    fr.setOffset(offset);

    for (let i = 0; i < TERRAIN_COUNT; ++i) {
      const img   = new Lemmings.TerrainImageInfo();
      img.width   = fr.readByte();
      img.height  = fr.readByte();
      img.imageLoc = fr.readWordBE();
      img.maskLoc  = fr.readWordBE() - img.imageLoc; // delta to stay compatible
      img.vgaLoc   = fr.readWordBE();
      img.palette  = palette;
      img.frameCount = 1; // terrains never animate

      let filename = fr.filename;
      let foldername = fr.foldername;
      if (foldername == "[unknown]") {
        console.log("folder name for " + filename + " is unknown, unable to use magic numbers to make perfect steel");
      }
      else if (foldername == "lemmings") {
        if (filename == "GROUND0O.DAT") { // normal maps
          if (i >= 22 && i <= 26) {
            img.isSteel = true;
          }
          if (i == 19) {
            // this one writes black over steel
          }
        } 
        else if (filename == "GROUND1O.DAT") { // dungeon maps 
          if (i >= 12 && i <= 17) {
            img.isSteel = true;
          }
        } 
        else if (filename == "GROUND2O.DAT") { // pink maps
          if (i == 5 || i >= 57 && i <= 59) { 
            img.isSteel = true;
          }
        } 
        else if (filename == "GROUND3O.DAT") { // desert maps
          if (i == 27) { 
            img.isSteel = true;
          }
          if ( i >= 48 && i <= 50) {
            img.isSteel = true;
          }
        } 
        else if (filename == "GROUND4O.DAT") { // crystal maps
          if (i >= 31 && i <= 32 || i == 34) {
            img.isSteel = true;
          }
        }
      } 
      else if (foldername == "lemmings_ohNo") {
        if (filename == "GROUND0O.DAT") { // brick maps
          if (i >= 51 && i <= 54) {
            img.isSteel = true;
          }
        } 
        else if (filename == "GROUND1O.DAT") { // jungle maps 
          if (i >= 56 && i <= 59) {
            img.isSteel = true;
          }
        } 
        else if (filename == "GROUND2O.DAT") { // ice maps
          if (i >= 29 && i <= 32) { 
            img.isSteel = true;
          }
        } 
      }

      if (fr.eof()) {
        this.log.log(`readTerrainImages(): unexpected EOF reading ${fr.filename}`);
        return;
      }
      this.imgTerrain[i] = img;
    }
  }

  _readPalettes (fr, offset) {
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
