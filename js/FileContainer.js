import { Lemmings } from './LemmingsNamespace.js';

/**
 * Represents a file composed of compressed segments/parts (Lemmings resource).
 * Each part can be unpacked into a BinaryReader.
 * @class
 */
class FileContainer {
  /** @type {Lemmings.UnpackFilePart[]} */
  #parts;

  /** @type {Lemmings.LogHandler} */
  #log;

  /**
   * Parse the file container's content on construction.
   * @param {Lemmings.BinaryReader} content - The binary file content.
   */
  constructor(content) {
    this.#log = new Lemmings.LogHandler("FileContainer");
    this.#parts = [];
    this.read(content);
  }

  /**
   * Get the number of file parts in this container.
   * @returns {number}
   */
  count() {
    return this.#parts.length;
  }

  /**
   * Return a new BinaryReader for the requested file part (unpacked).
   * If the index is out of range, returns an empty BinaryReader.
   * @param {number} index - Part index.
   * @returns {Lemmings.BinaryReader}
   */
  getPart(index) {
    if (index < 0 || index >= this.#parts.length) {
      this.#log.log(`getPart(${index}) Out of index!`);
      return new Lemmings.BinaryReader();
    }
    return this.#parts[index].unpack();
  }

  /**
   * Read and parse all file parts in this container.
   * Populates the internal parts array.
   * @param {Lemmings.BinaryReader} fileReader - Input file reader.
   */
  read(fileReader) {
    this.#parts.length = 0; // Reset
    let pos = 0;
    const HEADER_SIZE = 10;

    while (pos + HEADER_SIZE < fileReader.length) {
      fileReader.setOffset(pos);

      // New part instance
      let part = new Lemmings.UnpackFilePart(fileReader);
      part.offset = pos + HEADER_SIZE;
      // Header parsing
      part.initialBufferLen = fileReader.readByte();
      part.checksum = fileReader.readByte();
      part.unknown1 = fileReader.readWord();
      part.decompressedSize = fileReader.readWord();
      part.unknown0 = fileReader.readWord();
      let size = fileReader.readWord();
      part.compressedSize = size - HEADER_SIZE;
      part.index = this.#parts.length;

      // Sanity checks
      if (part.offset < 0 || size > 0xFFFFFF || size < HEADER_SIZE) {
        this.#log.log(`out of sync ${fileReader.filename}`);
        break;
      }
      this.#parts.push(part);
      pos += size;
    }
    this.#log.debug(`${fileReader.filename} has ${this.#parts.length} file-parts.`);
  }

  /** @returns {Lemmings.UnpackFilePart[]} Array of all file parts (read-only view). */
  get parts() {
    return this.#parts.slice();
  }
}

// Prevent extension if not needed.
Object.freeze(FileContainer);

Lemmings.FileContainer = FileContainer;
export { FileContainer };
