import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

/**
 * Reads binary data with flexible offset, length, and endian options.
 * Used for game/resource file decoding.
 * @class
 */
class BinaryReader extends Lemmings.BaseLogger {
  /** @type {Uint8Array} Backing store for bytes */
  #data;

  /** @type {number} Absolute offset for logical 0 */
  #hiddenOffset;

  /** @type {number} Length of logical data window */
  #length;

  /** @type {number} Current absolute position (relative to #data) */
  #pos;

  /** @type {string} File name (for logging/debug) */
  filename;

  /** @type {string} Folder name (for logging/debug) */
  foldername;


  /**
   * @param {Uint8Array|ArrayBuffer|BinaryReader|null} dataArray - Backing data (or another BinaryReader).
   * @param {number} [offset=0] - Logical offset for 0 in this reader.
   * @param {number} [length] - Length of logical data window. Defaults to full array.
   * @param {string} [filename='[unknown]'] - File name for debug/logging.
   * @param {string} [foldername='[unknown]'] - Folder name for debug/logging.
   */
  constructor(dataArray, offset = 0, length, filename = '[unknown]', foldername = '[unknown]') {
    super();
    this.filename = filename;
    this.foldername = foldername;

    /**
     * Promise that resolves when the backing data is available.
     * @type {Promise<void>}
     */
    this.ready = Promise.resolve();

    // Set initial offsets to allow property access before async load
    this.#hiddenOffset = offset;
    this.#length = 0;
    this.#pos = this.#hiddenOffset;

    let dataLength = 0;
    if (dataArray == null) {
      this.#data = new Uint8Array(0);
      dataLength = 0;
      this.log.log('BinaryReader from NULL; size: 0');
    } else if (dataArray instanceof BinaryReader) {
      this.#data = dataArray.data;
      dataLength = dataArray.length;
      this.log.log('BinaryReader from BinaryReader; size: ' + dataLength);
    } else if (dataArray instanceof Uint8Array) {
      this.#data = dataArray;
      dataLength = dataArray.byteLength;
      this.log.log('BinaryReader from Uint8Array; size: ' + dataLength);
    } else if (dataArray instanceof ArrayBuffer) {
      this.#data = new Uint8Array(dataArray);
      dataLength = dataArray.byteLength;
      this.log.log('BinaryReader from ArrayBuffer; size: ' + dataLength);
    } else if (typeof Blob !== 'undefined' && dataArray instanceof Blob) {
      this.#data = new Uint8Array(0);
      dataLength = 0;
      this.log.log('BinaryReader from Blob; reading asynchronously');
      this.ready = (async () => {
        let buf;
        if (typeof dataArray.arrayBuffer === 'function') {
          buf = await dataArray.arrayBuffer();
        } else if (typeof FileReader !== 'undefined') {
          buf = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(fr.error);
            fr.readAsArrayBuffer(dataArray);
          });
        } else {
          throw new Error('Blob reading not supported');
        }
        this.#data = new Uint8Array(buf);
        dataLength = this.#data.byteLength;
        if (length == null) length = dataLength - offset;
        this.#hiddenOffset = offset;
        this.#length = length;
        this.#pos = this.#hiddenOffset;
      })();
      // constructor returns immediately; callers should await this.ready
      this.ready.catch(() => {}); // avoid unhandled rejection
      return;
    } else {
      // Generic object: treat as array-like
      this.#data = new Uint8Array(dataArray);
      dataLength = this.#data.length;
      this.log.log('BinaryReader from unknown: ' + dataArray + '; size:' + dataLength);
    }

    if (length == null) length = dataLength - offset;
    this.#hiddenOffset = offset;
    this.#length = length;
    this.#pos = this.#hiddenOffset;
  }

  /** @returns {Uint8Array} Backing data array */
  get data() {
    return this.#data;
  }

  /** @returns {number} Logical start offset */
  get hiddenOffset() {
    return this.#hiddenOffset;
  }

  /** @returns {number} Logical length */
  get length() {
    return this.#length;
  }

  /** @returns {number} Current absolute position */
  get pos() {
    return this.#pos;
  }

  /**
   * Reads one byte at the current position (or absolute offset if given).
   * Advances position after read.
   * @param {number} [offset] - Absolute (not logical) offset in data. If provided, sets the position.
   * @returns {number} Byte value (0–255), or 0 if out-of-bounds.
   */
  readByte(offset) {
    if (offset !== undefined && offset !== null) {
      this.#pos = (offset + this.#hiddenOffset);
    }
    if (this.#pos < 0 || this.#pos >= this.#data.length) {
      this.log.log(`read out of data: ${this.filename} - size: ${this.#data.length} @ ${this.#pos}`);
      return 0;
    }
    return this.#data[this.#pos++];
  }

  /**
   * Reads a little-endian integer (4 bytes by default).
   * @param {number} [length=4] - Number of bytes to read (1–4).
   * @param {number} [offset] - Absolute offset in data. If omitted, uses current position.
   * @returns {number} Parsed integer.
   */
  readInt(length = 4, offset) {
    if (offset == null) offset = this.#pos;
    if (length === 4) {
      // Fast path for 4 bytes, little-endian
      const v = (this.#data[offset] << 24) |
                (this.#data[offset + 1] << 16) |
                (this.#data[offset + 2] << 8) |
                (this.#data[offset + 3]);
      this.#pos = offset + 4;
      return v;
    }
    let v = 0;
    for (let i = length; i > 0; i--) {
      v = (v << 8) | this.#data[offset++];
    }
    this.#pos = offset;
    return v;
  }

  /**
   * Reads a big-endian 4-byte integer.
   * @param {number} [offset] - Absolute offset in data.
   * @returns {number} Parsed integer.
   */
  readIntBE(offset) {
    if (offset == null) offset = this.#pos;
    const v = (this.#data[offset]) |
              (this.#data[offset + 1] << 8) |
              (this.#data[offset + 2] << 16) |
              (this.#data[offset + 3] << 24);
    this.#pos = offset + 4;
    return v;
  }

  /**
   * Reads a big-endian 2-byte word.
   * @param {number} [offset] - Absolute offset in data.
   * @returns {number} Parsed word (0–65535).
   */
  readWord(offset) {
    if (offset == null) offset = this.#pos;
    const v = (this.#data[offset] << 8) | (this.#data[offset + 1]);
    this.#pos = offset + 2;
    return v;
  }

  /**
   * Reads a little-endian 2-byte word.
   * @param {number} [offset] - Absolute offset in data.
   * @returns {number} Parsed word (0–65535).
   */
  readWordBE(offset) {
    if (offset == null) offset = this.#pos;
    const v = (this.#data[offset]) | (this.#data[offset + 1] << 8);
    this.#pos = offset + 2;
    return v;
  }

  /**
   * Reads a string of the given length from the current position.
   * @param {number} length - Number of bytes/chars to read.
   * @param {number} [offset] - If provided, sets position before reading.
   * @returns {string} The decoded string (ASCII).
   */
  readString(length, offset) {
    if (offset !== undefined && offset !== null) {
      this.#pos = offset + this.#hiddenOffset;
    }
    let chars = [];
    for (let i = 0; i < length; i++) {
      if (this.#pos >= this.#data.length) break;
      chars.push(String.fromCharCode(this.#data[this.#pos++]));
    }
    return chars.join('');
  }

  /**
   * Returns the current logical position (relative to logical 0).
   * @returns {number}
   */
  getOffset() {
    return this.#pos - this.#hiddenOffset;
  }

  /**
   * Sets the current logical position.
   * @param {number} newPos - New logical offset (relative to logical 0).
   */
  setOffset(newPos) {
    this.#pos = newPos + this.#hiddenOffset;
  }

  /**
   * Returns true if the cursor is at/after the end or before the start of the logical data window.
   * @returns {boolean}
   */
  eof() {
    const pos = this.#pos - this.#hiddenOffset;
    return (pos >= this.#length) || (pos < 0);
  }

  /**
   * Reads the entire logical window as a string.
   * @returns {string}
   */
  readAll() {
    return this.readString(this.#length, 0);
  }
}

Object.freeze(BinaryReader);

Lemmings.BinaryReader = BinaryReader;
export { BinaryReader };
