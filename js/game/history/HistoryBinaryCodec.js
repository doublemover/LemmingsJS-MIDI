// @ts-check
import { decodeText, encodeText, toI32 } from './HistoryShared.js';

class BinaryWriter {
  constructor(initialCapacity = 256) {
    const size = Math.max(32, initialCapacity | 0);
    this._bytes = new Uint8Array(size);
    this.length = 0;
    this._scratch = new Uint8Array(8);
    this._scratchView = new DataView(this._scratch.buffer);
  }

  _ensure(extraBytes) {
    const needed = this.length + extraBytes;
    if (needed <= this._bytes.length) return;
    let nextSize = this._bytes.length;
    while (nextSize < needed) nextSize *= 2;
    const next = new Uint8Array(nextSize);
    next.set(this._bytes.subarray(0, this.length));
    this._bytes = next;
  }

  writeU8(value) {
    this._ensure(1);
    this._bytes[this.length] = value & 0xff;
    this.length += 1;
  }

  writeU32(value) {
    const v = Number.isFinite(value) ? (Math.trunc(value) >>> 0) : 0;
    this._ensure(4);
    this._bytes[this.length] = v & 0xff;
    this._bytes[this.length + 1] = (v >>> 8) & 0xff;
    this._bytes[this.length + 2] = (v >>> 16) & 0xff;
    this._bytes[this.length + 3] = (v >>> 24) & 0xff;
    this.length += 4;
  }

  writeI32(value) {
    this.writeU32((toI32(value) >> 0) >>> 0);
  }

  writeF64(value) {
    this._scratchView.setFloat64(0, Number.isFinite(value) ? value : 0, true);
    this.writeRaw(this._scratch);
  }

  writeVarUint(value) {
    let next = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    while (next >= 0x80) {
      this.writeU8((next & 0x7f) | 0x80);
      next = Math.floor(next / 128);
    }
    this.writeU8(next);
  }

  writeRaw(bytes) {
    if (!bytes || !bytes.length) return;
    this._ensure(bytes.length);
    this._bytes.set(bytes, this.length);
    this.length += bytes.length;
  }

  writeBytes(bytes) {
    const src = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
    this.writeVarUint(src.length);
    this.writeRaw(src);
  }

  toUint8Array() {
    return this._bytes.slice(0, this.length);
  }
}

class BinaryReader {
  constructor(bytes) {
    this._bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    this._view = new DataView(this._bytes.buffer, this._bytes.byteOffset, this._bytes.byteLength);
    this.offset = 0;
  }

  _require(length) {
    if ((this.offset + length) > this._bytes.length) {
      throw new Error('HistoryStore cold-block decode overflow.');
    }
  }

  readU8() {
    this._require(1);
    const value = this._bytes[this.offset];
    this.offset += 1;
    return value;
  }

  readU32() {
    this._require(4);
    const value = this._view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readI32() {
    this._require(4);
    const value = this._view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readF64() {
    this._require(8);
    const value = this._view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readVarUint() {
    let value = 0;
    let shift = 0;
    while (true) {
      const byte = this.readU8();
      value += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 49) {
        throw new Error('HistoryStore cold-block varuint too large.');
      }
    }
    return value;
  }

  readRaw(length) {
    const size = Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : 0;
    this._require(size);
    const value = this._bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }

  readBytes() {
    const length = this.readVarUint();
    return this.readRaw(length);
  }

  eof() {
    return this.offset >= this._bytes.length;
  }
}

const VALUE_TAG_NULL = 0;
const VALUE_TAG_FALSE = 1;
const VALUE_TAG_TRUE = 2;
const VALUE_TAG_NUMBER = 3;
const VALUE_TAG_STRING = 4;
const VALUE_TAG_ARRAY = 5;
const VALUE_TAG_OBJECT = 6;
const VALUE_TAG_UNDEFINED = 7;

const writeTaggedValue = (writer, value) => {
  if (value === null) {
    writer.writeU8(VALUE_TAG_NULL);
    return;
  }
  if (value === undefined) {
    writer.writeU8(VALUE_TAG_UNDEFINED);
    return;
  }
  if (value === false) {
    writer.writeU8(VALUE_TAG_FALSE);
    return;
  }
  if (value === true) {
    writer.writeU8(VALUE_TAG_TRUE);
    return;
  }
  if (typeof value === 'number') {
    writer.writeU8(VALUE_TAG_NUMBER);
    writer.writeF64(value);
    return;
  }
  if (typeof value === 'string') {
    writer.writeU8(VALUE_TAG_STRING);
    writer.writeBytes(encodeText(value));
    return;
  }
  if (Array.isArray(value)) {
    writer.writeU8(VALUE_TAG_ARRAY);
    writer.writeVarUint(value.length);
    for (let i = 0; i < value.length; i += 1) {
      writeTaggedValue(writer, value[i]);
    }
    return;
  }
  writer.writeU8(VALUE_TAG_OBJECT);
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
  writer.writeVarUint(keys.length);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    writer.writeBytes(encodeText(key));
    writeTaggedValue(writer, value[key]);
  }
};

const readTaggedValue = (reader) => {
  const tag = reader.readU8();
  switch (tag) {
  case VALUE_TAG_NULL:
    return null;
  case VALUE_TAG_FALSE:
    return false;
  case VALUE_TAG_TRUE:
    return true;
  case VALUE_TAG_NUMBER:
    return reader.readF64();
  case VALUE_TAG_STRING:
    return decodeText(reader.readBytes());
  case VALUE_TAG_ARRAY: {
    const length = reader.readVarUint();
    const out = new Array(length);
    for (let i = 0; i < length; i += 1) {
      out[i] = readTaggedValue(reader);
    }
    return out;
  }
  case VALUE_TAG_OBJECT: {
    const length = reader.readVarUint();
    const out = {};
    for (let i = 0; i < length; i += 1) {
      const key = decodeText(reader.readBytes());
      out[key] = readTaggedValue(reader);
    }
    return out;
  }
  case VALUE_TAG_UNDEFINED:
    return undefined;
  default:
    throw new Error(`HistoryStore cold-block tag ${tag} is unsupported.`);
  }
};

const bytesEqual = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const fnv1aHashBytes = (bytes) => {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const rleEncodeBytes = (bytes) => {
  if (!bytes || bytes.length <= 2) return bytes;
  const out = [];
  for (let i = 0; i < bytes.length;) {
    const value = bytes[i];
    let run = 1;
    while ((i + run) < bytes.length && bytes[i + run] === value && run < 255) {
      run += 1;
    }
    out.push(run, value);
    i += run;
  }
  return Uint8Array.from(out);
};

const rleDecodeBytes = (bytes) => {
  const out = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const run = bytes[i];
    const value = bytes[i + 1];
    for (let j = 0; j < run; j += 1) {
      out.push(value);
    }
  }
  return Uint8Array.from(out);
};

export {
  BinaryWriter,
  BinaryReader,
  writeTaggedValue,
  readTaggedValue,
  bytesEqual,
  fnv1aHashBytes,
  rleEncodeBytes,
  rleDecodeBytes
};
