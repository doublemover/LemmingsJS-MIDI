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
    // Classic for‑loop is measurably faster than Array.map for side‑effects.
    for (let i = 0, len = imgList.length; i < len; ++i) {
      const img = imgList[i];
      const frames = new Array(img.frameCount); // packed array – no pushes

      let filePos = img.imageLoc;
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

// Attach to the public namespace exactly like the original so nothing else
// in the code‑base needs to change.
Lemmings.GroundReader = GroundReader;
export { GroundReader };
