import { BaseLogger } from '../util/LogHandler.js';

/**
 * Reads binary data through a logical window over a backing byte array.
 * Explicit offsets are logical offsets relative to this reader's window.
 *
 * Legacy method names are preserved for compatibility:
 * - readInt/readWord read big-endian values.
 * - readIntBE/readWordBE read little-endian values despite the BE suffix.
 * @class
 */
class BinaryReader extends BaseLogger {
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
    if (typeof offset === 'string') {
      const nextFolder = typeof length === 'string' ? length : foldername;
      filename = offset;
      foldername = nextFolder;
      offset = 0;
      length = undefined;
    } else if (typeof length === 'string') {
      foldername = filename;
      filename = length;
      length = undefined;
    }
    this.filename = filename;
    this.foldername = foldername;

    /**
     * Promise that resolves when the backing data is available.
     * For synchronous sources it resolves immediately with the data array.
     * @type {Promise<Uint8Array>}
     */
    this.ready = Promise.resolve();

    // Set initial offsets to allow property access before async load
    this.#hiddenOffset = offset;
    this.#length = 0;
    this.#pos = this.#hiddenOffset;

    let dataLength = 0;
    let baseHiddenOffset = 0;
    if (dataArray == null) {
      this.#data = new Uint8Array(0);
      dataLength = 0;
      this.log.log('BinaryReader from NULL; size: 0');
    } else if (dataArray instanceof BinaryReader) {
      this.#data = dataArray.data;
      dataLength = dataArray.length;
      baseHiddenOffset = dataArray.hiddenOffset;
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
        return this.#data;
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
    this.#hiddenOffset = baseHiddenOffset + offset;
    this.#length = Math.max(0, Math.min(length, dataLength - offset));
    this.#pos = this.#hiddenOffset;
    this.ready = Promise.resolve(this.#data);
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

  #resolveReadOffset(offset) {
    if (offset === undefined || offset === null) return this.#pos;
    return this.#hiddenOffset + Math.trunc(Number(offset));
  }

  #windowEnd() {
    return Math.min(this.#data.length, this.#hiddenOffset + this.#length);
  }

  #canRead(pos, byteCount, label) {
    if (!Number.isFinite(pos) || !Number.isFinite(byteCount) || byteCount < 0) {
      this.log.log(`${label}: invalid offset for ${this.filename}`);
      return false;
    }
    if (pos < this.#hiddenOffset || pos + byteCount > this.#windowEnd()) {
      this.log.log(
        `${label}: read out of data: ${this.filename} - window: ${this.#hiddenOffset}+${this.#length} @ ${pos}`
      );
      return false;
    }
    return true;
  }

  /**
   * Reads one byte at the current position or logical offset.
   * Advances position after read.
   * @param {number} [offset] - Logical offset. If provided, sets the position.
   * @returns {number} Byte value (0–255), or 0 if out-of-bounds.
   */
  readByte(offset) {
    this.#pos = this.#resolveReadOffset(offset);
    if (!this.#canRead(this.#pos, 1, 'readByte')) {
      return 0;
    }
    return this.#data[this.#pos++];
  }

  /**
   * Legacy alias for readIntBigEndian().
   * @param {number} [length=4] - Number of bytes to read (1–4).
   * @param {number} [offset] - Logical offset. If omitted, uses current position.
   * @returns {number} Parsed integer.
   */
  readInt(length = 4, offset) {
    return this.readIntBigEndian(length, offset);
  }

  /**
   * Legacy alias for readIntLittleEndian(4, offset).
   * @param {number} [offset] - Logical offset.
   * @returns {number} Parsed integer.
   */
  readIntBE(offset) {
    return this.readIntLittleEndian(4, offset);
  }

  /**
   * Legacy alias for readWordBigEndian().
   * @param {number} [offset] - Logical offset.
   * @returns {number} Parsed word (0–65535).
   */
  readWord(offset) {
    return this.readWordBigEndian(offset);
  }

  /**
   * Legacy alias for readWordLittleEndian().
   * @param {number} [offset] - Logical offset.
   * @returns {number} Parsed word (0–65535).
   */
  readWordBE(offset) {
    return this.readWordLittleEndian(offset);
  }

  readIntBigEndian(length = 4, offset) {
    const byteCount = Math.trunc(Number(length));
    const pos = this.#resolveReadOffset(offset);
    if (byteCount < 1 || byteCount > 4 || !this.#canRead(pos, byteCount, 'readIntBigEndian')) {
      return 0;
    }
    let v = 0;
    for (let i = 0; i < byteCount; i += 1) {
      v = (v << 8) | this.#data[pos + i];
    }
    this.#pos = pos + byteCount;
    return v;
  }

  readIntLittleEndian(length = 4, offset) {
    const byteCount = Math.trunc(Number(length));
    const pos = this.#resolveReadOffset(offset);
    if (byteCount < 1 || byteCount > 4 || !this.#canRead(pos, byteCount, 'readIntLittleEndian')) {
      return 0;
    }
    let v = 0;
    for (let i = byteCount - 1; i >= 0; i -= 1) {
      v = (v << 8) | this.#data[pos + i];
    }
    this.#pos = pos + byteCount;
    return v;
  }

  readWordBigEndian(offset) {
    const pos = this.#resolveReadOffset(offset);
    if (!this.#canRead(pos, 2, 'readWordBigEndian')) return 0;
    const v = (this.#data[pos] << 8) | this.#data[pos + 1];
    this.#pos = pos + 2;
    return v;
  }

  readWordLittleEndian(offset) {
    const pos = this.#resolveReadOffset(offset);
    if (!this.#canRead(pos, 2, 'readWordLittleEndian')) return 0;
    const v = this.#data[pos] | (this.#data[pos + 1] << 8);
    this.#pos = pos + 2;
    return v;
  }

  /**
   * Reads a string of the given length from the current position.
   * @param {number} length - Number of bytes/chars to read.
   * @param {number} [offset] - Logical offset. If provided, sets position before reading.
   * @returns {string} The decoded string (ASCII).
   */
  readString(length, offset) {
    this.#pos = this.#resolveReadOffset(offset);
    let chars = [];
    const end = this.#windowEnd();
    for (let i = 0; i < length; i++) {
      if (this.#pos < this.#hiddenOffset || this.#pos >= end) break;
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
export { BinaryReader };
