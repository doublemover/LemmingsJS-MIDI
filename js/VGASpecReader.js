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
    let chunkBytes = [];

    while (!fr.eof()) {
      const curByte = fr.readByte();
      if (curByte === 128) {
        const chunk = Uint8Array.from(chunkBytes);
        const bytesPerPixel = chunk.length / pixelCount;
        if (bytesPerPixel === 4) {
          const src = new Uint32Array(chunk.buffer, chunk.byteOffset, pixelCount);
          const dest = this.#img.data;
          const mask = this.#img.mask;
          for (let y = 0; y < chunkHeight; y++) {
            const srcRow = y * width;
            const dstRow = (startScanLine + y) * this.#img.width + groundImagePositionX;
            dest.set(src.subarray(srcRow, srcRow + width), dstRow);
            mask.fill(1, dstRow, dstRow + width);
          }
        } else if (bytesPerPixel === 1) {
          this.#img.drawPaletteImage(chunk, width, chunkHeight, this.#groundPalette, groundImagePositionX, startScanLine);
        } else {
          const fileReader = new Lemmings.BinaryReader(chunk);
          const bitImage = new Lemmings.PaletteImage(width, chunkHeight);
          bitImage.processImage(fileReader, 3, 0);
          bitImage.processTransparentByColorIndex(0);
          this.#img.drawPaletteImage(bitImage.getImageBuffer(), width, chunkHeight, this.#groundPalette, groundImagePositionX, startScanLine);
        }
        startScanLine += chunkHeight;
        if (startScanLine >= this.#img.height) break;
        chunkBytes = [];
      } else if (curByte <= 127) {
        let copyCount = curByte + 1;
        while (!fr.eof() && copyCount-- > 0) {
          chunkBytes.push(fr.readByte());
        }
      } else {
        const repeatByte = fr.readByte();
        let repeatCount = 257 - curByte;
        while (repeatCount-- > 0) chunkBytes.push(repeatByte);
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
