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

  #getSource() {
    if (!this.#source) throw new Error('Raw asset handle has been released');
    return this.#source;
  }

  get released() { return this.#source === null; }

  release() {
    this.#source?.release();
    this.#source = null;
  }

  createReader(options = {}) {
    const source = this.#getSource(), { filename = source.filename, foldername = source.foldername } = options;
    const reader = new BinaryReader(source, 0, null, filename, foldername);
    Object.defineProperty(reader, 'sourceIdentity', { value: this.identity });
    return reader;
  }

  copyBytes() {
    return this.#getSource().copyBytes();
  }

  decodeText(encoding = 'utf-8') {
    return new TextDecoder(encoding, { fatal: true }).decode(this.copyBytes());
  }
}
