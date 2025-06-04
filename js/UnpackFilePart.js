import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

/**
 * Represents a single compressed file part/chunk in a Lemmings resource.
 * Handles (lazy) decompression and exposes its metadata.
 * @class
 */
class UnpackFilePart extends Lemmings.BaseLogger {
  /** @type {number} File offset in container */
  #offset = 0;
  /** @type {number} Initial buffer length for BitReader */
  #initialBufferLen = 0;
  /** @type {number} Expected checksum */
  #checksum = 0;
  /** @type {number} Size of decompressed data */
  #decompressedSize = 0;
  /** @type {number} Size of compressed data */
  #compressedSize = 0;
  /** @type {number} Unknown field (0) */
  #unknown0 = 0;
  /** @type {number} Unknown field (1) */
  #unknown1 = 0;
  /** @type {number} Index in container */
  #index = 0;

  /** @type {Lemmings.BinaryReader} Underlying file reader (or unpacked data after first unpack) */
  #fileReader;
  /** @type {boolean} Unpacking done flag */
  #unpackingDone = false;

  /**
   * @param {Lemmings.BinaryReader} fileReader - The container file's BinaryReader (positioned at this part).
   */
  constructor(fileReader) {
    super();
    this.#fileReader = fileReader;
  }

  /** @returns {number} File offset in container */
  get offset() { return this.#offset; }
  set offset(val) { this.#offset = val; }

  /** @returns {number} Initial buffer length for BitReader */
  get initialBufferLen() { return this.#initialBufferLen; }
  set initialBufferLen(val) { this.#initialBufferLen = val; }

  /** @returns {number} Expected checksum */
  get checksum() { return this.#checksum; }
  set checksum(val) { this.#checksum = val; }

  /** @returns {number} Decompressed data size */
  get decompressedSize() { return this.#decompressedSize; }
  set decompressedSize(val) { this.#decompressedSize = val; }

  /** @returns {number} Compressed data size */
  get compressedSize() { return this.#compressedSize; }
  set compressedSize(val) { this.#compressedSize = val; }

  /** @returns {number} Unknown field (0) */
  get unknown0() { return this.#unknown0; }
  set unknown0(val) { this.#unknown0 = val; }

  /** @returns {number} Unknown field (1) */
  get unknown1() { return this.#unknown1; }
  set unknown1(val) { this.#unknown1 = val; }

  /** @returns {number} Index in container */
  get index() { return this.#index; }
  set index(val) { this.#index = val; }

  /** @returns {boolean} Whether this chunk has been unpacked */
  get unpackingDone() { return this.#unpackingDone; }

  /** @returns {Lemmings.BinaryReader} The BinaryReader of the underlying (possibly unpacked) data */
  get fileReader() { return this.#fileReader; }

  /**
   * Unpack (decompress) this file part and return a BinaryReader over the output buffer.
   * Caches the result after the first call.
   * @returns {Lemmings.BinaryReader}
   */
  unpack() {
    if (!this.#unpackingDone) {
      this.#fileReader = this.#doUnpacking(this.#fileReader);
      this.#unpackingDone = true;
      return this.#fileReader;
    }
    // Return a new BinaryReader over the decompressed buffer for repeat access
    return new Lemmings.BinaryReader(this.#fileReader);
  }

  /**
   * Internal method: perform actual decompression using BitReader/BitWriter.
   * @private
   * @param {Lemmings.BinaryReader} fileReader
   * @returns {Lemmings.BinaryReader}
   */
  #doUnpacking(fileReader) {
    return Lemmings.withPerformance(
      'doUnpacking',
      {
        track: 'UnpackFilePart',
        trackGroup: 'IO',
        color: 'tertiary-light',
        tooltipText: `doUnpacking ${fileReader.filename}`
      },
      () => {
        const bitReader = new Lemmings.BitReader(
          fileReader,
          this.#offset,
          this.#compressedSize,
          this.#initialBufferLen
        );
        const outBuffer = new Lemmings.BitWriter(bitReader, this.#decompressedSize);

        while (!outBuffer.eof() && !bitReader.eof()) {
          if (bitReader.read(1) === 0) {
            switch (bitReader.read(1)) {
            case 0:
              outBuffer.copyRawData(bitReader.read(3) + 1);
              break;
            case 1:
              outBuffer.copyReferencedData(2, 8);
              break;
            }
          } else {
            switch (bitReader.read(2)) {
            case 0:
              outBuffer.copyReferencedData(3, 9);
              break;
            case 1:
              outBuffer.copyReferencedData(4, 10);
              break;
            case 2:
              outBuffer.copyReferencedData(bitReader.read(8) + 1, 12);
              break;
            case 3:
              outBuffer.copyRawData(bitReader.read(8) + 9);
              break;
            }
          }
        }

        if (this.#checksum === bitReader.getCurrentChecksum()) {
          this.log.debug(`doUnpacking(${fileReader.filename}) done!`);
        } else {
          this.log.log(`doUnpacking(${fileReader.filename}): Checksum mismatch!`);
        }
        // Create a BinaryReader over the decompressed buffer
        return outBuffer.getFileReader(`${fileReader.filename}[${this.#index}]`);
      }).call(this);
  }
}

// Prevent extension if not intended
Object.freeze(UnpackFilePart);

Lemmings.UnpackFilePart = UnpackFilePart;
export { UnpackFilePart };
