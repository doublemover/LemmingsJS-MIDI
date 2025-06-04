import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

/**
 * Optimized bitwise reader for Lemmings decompression.
 * Reads bits (in reverse order) from a stream, tracking a running XOR checksum.
 * 
 * @class
 */
class BitReader {
  /** @type {number} Index of next byte to consume (reading backwards) */
  #pos;

  /** @type {Lemmings.BinaryReader} Private clone of the input file reader */
  #binReader;

  /** @type {number} Current byte-sized bit buffer */
  #buffer;

  /** @type {number} Number of bits remaining in the current buffer */
  #bufferLen;

  /** @type {number} Running XOR checksum of bytes read */
  #checksum;

  /**
   * @param {Lemmings.BinaryReader} fileReader - The input binary reader (must support .readByte and .filename).
   * @param {number} offset - Offset to begin reading from.
   * @param {number} length - Number of bytes to read (reads backwards from offset+length).
   * @param {number} initBufferLength - Initial number of bits in buffer (normally 8 or less).
   */
  constructor(fileReader, offset, length, initBufferLength = 8) {
    if (!fileReader || typeof fileReader.readByte !== 'function')
      throw new TypeError('fileReader must implement readByte()');
    if (!Number.isInteger(offset) || offset < 0)
      throw new RangeError('offset must be a non-negative integer');
    if (!Number.isInteger(length) || length <= 0)
      throw new RangeError('length must be a positive integer');
    if (!Number.isInteger(initBufferLength) || initBufferLength < 0 || initBufferLength > 8)
      throw new RangeError('initBufferLength must be an integer between 0 and 8');

    this.#pos = length - 1;
    this.#binReader = new Lemmings.BinaryReader(
      fileReader,
      offset,
      length,
      fileReader.filename,
    );

    // Preload first byte as buffer
    this.#buffer = this.#binReader.readByte(this.#pos);
    this.#bufferLen = initBufferLength;
    this.#checksum = this.#buffer;
  }

  /**
   * Returns the current XOR checksum.
   * @returns {number}
   */
  getCurrentChecksum() {
    return this.#checksum;
  }

  /**
   * Read an arbitrary number of bits (up to 32) from the stream (in reverse).
   * Extremely hot path: written for maximum performance.
   * 
   * @param {number} bitCount - Number of bits to read (1–32)
   * @returns {number} The bits read (LSB = earliest bit).
   */
  read(bitCount) {
    if (!Number.isInteger(bitCount) || bitCount < 1 || bitCount > 32)
      throw new RangeError('bitCount must be an integer between 1 and 32');

    let result = 0;
    // Pull hot fields into locals
    let buffer = this.#buffer;
    let bufferLen = this.#bufferLen;
    let pos = this.#pos;
    const br = this.#binReader;
    let checksum = this.#checksum;

    for (let i = bitCount; i-- > 0;) {
      if (bufferLen === 0) {
        if (pos < 0) throw new RangeError('Attempt to read past end of buffer');
        buffer = br.readByte(--pos);
        checksum ^= buffer;
        bufferLen = 8;
      }
      bufferLen--;
      result = (result << 1) | (buffer & 1);
      buffer >>>= 1;
    }

    // Write back only once for perf
    this.#buffer = buffer;
    this.#bufferLen = bufferLen;
    this.#pos = pos;
    this.#checksum = checksum;

    return result;
  }

  /**
   * Returns true if no more bits remain in the stream.
   * @returns {boolean}
   */
  eof() {
    return this.#bufferLen === 0 && this.#pos <= 0;
  }
}

Object.freeze(BitReader);

Lemmings.BitReader = BitReader;
export { BitReader };
