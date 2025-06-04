import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

/**
 * Decodes a VGASPEC-format ground file, including color palette and image buffer.
 * @class
 */
class VGASpecReader extends Lemmings.BaseLogger {
  /** @type {number} */
  #width;
  /** @type {number} */
  #height;
  /** @type {Lemmings.ColorPalette} */
  #groundPalette;
  /** @type {Lemmings.Frame} */
  #img;
  /** @type {Lemmings.Logger} */
  #log;

  /**
     * @param {Lemmings.BinaryReader} vgaspecFile - File with VGASPEC-encoded level
     * @param {number} width
     * @param {number} height
     */
  constructor(vgaspecFile, width, height) {
    super();
    this.#log = this.log;
    this.#width = width | 0;
    this.#height = height | 0;
    this.#groundPalette = new Lemmings.ColorPalette();
    this.#img = new Lemmings.Frame(this.#width, this.#height);
    this.#read(vgaspecFile);
  }

  /** @returns {number} */
  get width() { return this.#width; }
  /** @returns {number} */
  get height() { return this.#height; }
  /** @returns {Lemmings.ColorPalette} */
  get groundPalette() { return this.#groundPalette; }
  /** @returns {Lemmings.Frame} */
  get img() { return this.#img; }

  /**
     * Read the VGASPEC file, palette, and image.
     * @private
     * @param {Lemmings.BinaryReader} fr
     */
  #read(fr) {
    fr.setOffset(0);
    const fc = new Lemmings.FileContainer(fr);
    if (fc.count() !== 1) {
      this.#log.log('No FileContainer found!');
      return;
    }
    // Use the first file part
    const part = fc.getPart(0);
    this.#readPalettes(part, 0);
    this.#readImage(part, 40);
  }

  /**
     * Reads the main image using a RLE-like format.
     * @private
     * @param {Lemmings.BinaryReader} fr
     * @param {number} offset
     */
  #readImage(fr, offset) {
    fr.setOffset(offset);
    const width = 960, chunkHeight = 40, groundImagePositionX = 304;
    let startScanLine = 0;
    const pixelCount = width * chunkHeight;
    let bitBuffer = new Uint8Array(pixelCount);
    let bitBufferPos = 0;

    while (!fr.eof()) {
      const curByte = fr.readByte();
      if (curByte === 128) {
        // End of scanline chunk: decode and draw
        const fileReader = new Lemmings.BinaryReader(bitBuffer);
        const bitImage = new Lemmings.PaletteImage(width, chunkHeight);
        bitImage.processImage(fileReader, 3, 0);
        bitImage.processTransparentByColorIndex(0);
        this.#img.drawPaletteImage(bitImage.getImageBuffer(), width, chunkHeight, this.#groundPalette, groundImagePositionX, startScanLine);
        startScanLine += chunkHeight;
        if (startScanLine >= this.#img.height) break;
        bitBufferPos = 0;
      } else if (curByte <= 127) {
        // Copy next (curByte + 1) bytes
        let copyCount = curByte + 1;
        while (!fr.eof() && copyCount-- > 0) {
          if (bitBufferPos >= bitBuffer.length) return;
          bitBuffer[bitBufferPos++] = fr.readByte();
        }
      } else {
        // Repeat a value for (257 - curByte) times
        const repeatByte = fr.readByte();
        let repeatCount = 257 - curByte;
        while (repeatCount-- > 0) {
          if (bitBufferPos >= bitBuffer.length) return;
          bitBuffer[bitBufferPos++] = repeatByte;
        }
      }
    }
  }

  /**
     * Load the palettes from the file part.
     * @private
     * @param {Lemmings.BinaryReader} fr
     * @param {number} offset
     */
  #readPalettes(fr, offset) {
    fr.setOffset(offset);
    for (let i = 0; i < 8; i++) {
      const r = fr.readByte() << 2;
      const g = fr.readByte() << 2;
      const b = fr.readByte() << 2;
      this.#groundPalette.setColorRGB(i, r, g, b);
    }
    if (fr.eof()) {
      this.#log.log(`readPalettes(): unexpected end of file!: ${fr.filename}`);
    }
  }
}

Lemmings.VGASpecReader = VGASpecReader;
export { VGASpecReader };
