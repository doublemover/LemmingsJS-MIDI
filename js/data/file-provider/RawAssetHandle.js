import { BinaryReader } from '../BinaryReader.js';

/** A pinned byte generation. Mutating/transfer APIs deliberately return copies. */
export class RawAssetHandle {
  #source;

  constructor(source, identity) {
    this.#source = source;
    this.identity = Object.freeze({ ...identity });
    this.byteLength = source.length;
    Object.freeze(this);
  }

  createReader({ filename = this.#source.filename, foldername = this.#source.foldername } = {}) {
    const reader = new BinaryReader(this.#source, 0, null, filename, foldername);
    Object.defineProperty(reader, 'sourceIdentity', { value: this.identity });
    return reader;
  }

  copyBytes() {
    return this.#source.copyBytes();
  }

  decodeText(encoding = 'utf-8') {
    return new TextDecoder(encoding, { fatal: true }).decode(this.copyBytes());
  }
}
