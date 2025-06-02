import { Lemmings } from './LemmingsNamespace.js';

/**
 * Efficient backwards-writing buffer for Lemmings decompression (LZ-style).
 * Copies raw data or references already-written bytes using a BitReader.
 * @class
 */
class BitWriter {
  /** @type {Uint8Array} Output buffer (write backwards from end) */
  #outData;

  /** @type {number} Current write position (decrements on write) */
  #outPos;

  /** @type {Lemmings.BitReader} Input reader for compressed data */
  #bitReader;

  /** @type {Lemmings.LogHandler} Logger */
  #log;

  /**
   * @param {Lemmings.BitReader} bitReader - Source of compressed bits.
   * @param {number} outLength - Total length of output buffer.
   */
  constructor(bitReader, outLength) {
    if (!bitReader || typeof bitReader.read !== 'function') {
      throw new TypeError('bitReader must have a .read() method');
    }
    if (!Number.isInteger(outLength) || outLength <= 0) {
      throw new RangeError('outLength must be a positive integer');
    }
    this.#log = new Lemmings.LogHandler('BitWriter');
    this.#outData = new Uint8Array(outLength);
    this.#outPos = outLength; // Write head walks *backwards*
    this.#bitReader = bitReader;
  }

  /** @returns {Uint8Array} The output buffer */
  get outData() {
    return this.#outData;
  }

  /** @returns {number} The current backwards write position */
  get outPos() {
    return this.#outPos;
  }

  /** @returns {Lemmings.BitReader} The input bit reader */
  get bitReader() {
    return this.#bitReader;
  }

  /**
   * Copy `length` *bytes* directly from the reader into the output buffer.
   * @param {number} length - Number of bytes to copy.
   */
  copyRawData(length) {
    let outPos = this.#outPos;
    const outData = this.#outData;
    const reader = this.#bitReader;

    if (outPos - length < 0) {
      this.#log.log('copyRawData: out of out buffer');
      length = outPos;
    }

    while (length-- > 0) {
      outData[--outPos] = reader.read(8);
    }
    this.#outPos = outPos;
  }

  /**
   * Copy `length` *bytes* from data already written.
   * Offset is encoded by `offsetBitCount` bits (mirrors LZ77 copy).
   * @param {number} length - Number of bytes to copy.
   * @param {number} offsetBitCount - Bit width of the backwards offset.
   */
  copyReferencedData(length, offsetBitCount) {
    const outData = this.#outData;
    let outPos = this.#outPos;
    const offset = this.#bitReader.read(offsetBitCount) + 1;

    if (outPos + offset > outData.length) {
      this.#log.log('copyReferencedData: offset out of range');
      return;
    }
    if (outPos - length < 0) {
      this.#log.log('copyReferencedData: out of out buffer');
      length = outPos;
    }

    // Tight backwards copy, avoids bounds check in inner loop.
    while (length-- > 0) {
      outData[--outPos] = outData[outPos + offset];
    }
    this.#outPos = outPos;
  }

  /**
   * Returns a frozen BinaryReader view of the decompressed data.
   * @param {string} [filename] - Optional file name for BinaryReader.
   * @returns {Lemmings.BinaryReader}
   */
  getFileReader(filename) {
    return new Lemmings.BinaryReader(this.#outData, null, null, filename);
  }

  /**
   * Returns true if the output buffer is full.
   * @returns {boolean}
   */
  eof() {
    return this.#outPos <= 0;
  }
}

// Prevent further extension if not needed.
Object.freeze(BitWriter);

Lemmings.BitWriter = BitWriter;
export { BitWriter };
