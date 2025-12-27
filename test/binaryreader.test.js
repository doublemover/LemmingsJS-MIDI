import assert from 'assert';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import '../js/util/LogHandler.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('BinaryReader', function () {
  it('reads data from Blob asynchronously', async function () {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const blob = new Blob([bytes]);
    const reader = new BinaryReader(blob);
    const loaded = await reader.ready;
    assert.ok(loaded instanceof Uint8Array);
    assert.deepStrictEqual(Array.from(loaded), [1, 2, 3, 4]);
    const result = [reader.readByte(), reader.readByte(), reader.readByte(), reader.readByte()];
    assert.deepStrictEqual(result, [1, 2, 3, 4]);
  });

  it('reads integers, words and strings with offsets', function () {
    const bytes = Uint8Array.from([
      0x01, 0x02, 0x03, 0x04,
      0x05, 0x06,
      65, 66, 67
    ]);
    const reader = new BinaryReader(bytes);

    assert.strictEqual(reader.readInt(4, 0), 0x01020304);
    assert.strictEqual(reader.readInt(2, 0), 0x0102);
    assert.strictEqual(reader.readInt(3, 0), 0x010203);
    assert.strictEqual(reader.readIntBE(0), 0x04030201);
    assert.strictEqual(reader.readWord(4), 0x0506);
    assert.strictEqual(reader.readWordBE(4), 0x0605);
    assert.strictEqual(reader.readString(3, 6), 'ABC');
  });

  it('readIntBE uses the current offset when none is provided', function () {
    const reader = new BinaryReader(Uint8Array.from([0x01, 0x02, 0x03, 0x04]));
    const value = reader.readIntBE();
    assert.strictEqual(value, 0x04030201);
    assert.strictEqual(reader.pos, 4);
  });

  it('readInt uses the current offset when none is provided', function () {
    const reader = new BinaryReader(Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05]));
    const value = reader.readInt();
    assert.strictEqual(value, 0x01020304);
    assert.strictEqual(reader.pos, 4);
  });

  it('logs warnings for invalid offsets', function () {
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
      debug() {}
    }

    const origHandler = Lemmings.LogHandler;
    setDependency('LogHandler', MockLogHandler);
    const bytes = Uint8Array.from([0x00, 0x01]);
    const reader = new BinaryReader(bytes, 0, bytes.length, 'test.bin');

    const prev = globalThis.lemmings.game.showDebug;
    globalThis.lemmings.game.showDebug = true;

    reader.readByte(-1);
    reader.readByte(5);

    globalThis.lemmings.game.showDebug = prev;

    assert.ok(reader.log.logged.filter(m => m.includes('read out of data')).length >= 2);
    setDependency('LogHandler', origHandler);
  });

  it('falls back to FileReader when arrayBuffer is unavailable', async function () {
    const bytes = Uint8Array.from([9, 8, 7]);
    const blob = new Blob([bytes]);

    const origArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = undefined;

    let readCalled = false;
    class FR {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.result = null;
      }
      readAsArrayBuffer() {
        readCalled = true;
        this.result = Buffer.from(bytes);
        setImmediate(() => this.onload());
      }
    }

    global.FileReader = FR;

    const reader = new BinaryReader(blob);
    const loaded = await reader.ready;
    assert.ok(readCalled);
    assert.deepStrictEqual(Array.from(loaded), [9, 8, 7]);

    Blob.prototype.arrayBuffer = origArrayBuffer;
    delete global.FileReader;
  });

  it('rejects when blob reading APIs are missing', async function () {
    const blob = new Blob(['x']);
    const origArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = undefined;
    const origFileReader = global.FileReader;
    delete global.FileReader;

    const reader = new BinaryReader(blob);
    await assert.rejects(reader.ready, /Blob reading not supported/);

    Blob.prototype.arrayBuffer = origArrayBuffer;
    if (origFileReader) global.FileReader = origFileReader;
  });

  it('initializes with offset and default length for ArrayBuffer', function () {
    const bytes = Uint8Array.from([10, 20, 30, 40]);
    const reader = new BinaryReader(bytes.buffer, 1);
    assert.strictEqual(reader.hiddenOffset, 1);
    assert.strictEqual(reader.length, 3);
    assert.strictEqual(reader.pos, 1);
    assert.ok(reader.data instanceof Uint8Array);
    assert.deepStrictEqual(Array.from(reader.data), [10, 20, 30, 40]);
  });

  it('initializes from array with explicit length', async function () {
    const reader = new BinaryReader([5, 6, 7, 8], 2, 1);
    const loaded = await reader.ready;
    assert.ok(loaded instanceof Uint8Array);
    assert.strictEqual(reader.hiddenOffset, 2);
    assert.strictEqual(reader.length, 1);
    assert.strictEqual(reader.pos, 2);
    assert.deepStrictEqual(Array.from(reader.data), [5, 6, 7, 8]);
  });

  it('handles null input and readAll', function () {
    const reader = new BinaryReader(null);
    assert.strictEqual(reader.length, 0);
    assert.strictEqual(reader.readByte(), 0);
    assert.strictEqual(reader.readAll(), '');
  });

  it('initializes from another BinaryReader and tracks offsets', function () {
    const base = new BinaryReader(Uint8Array.from([1, 2, 3, 4]));
    const reader = new BinaryReader(base, 1, 2);
    reader.setOffset(0);
    assert.strictEqual(reader.getOffset(), 0);
    assert.strictEqual(reader.readByte(), 2);
    assert.strictEqual(reader.getOffset(), 1);
    const str = reader.readString(4);
    assert.strictEqual(str.length, 2);
    assert.strictEqual(str.charCodeAt(0), 3);
    assert.strictEqual(str.charCodeAt(1), 4);
  });

  it('rejects when FileReader emits an error', async function () {
    const bytes = Uint8Array.from([1, 2, 3]);
    const blob = new Blob([bytes]);
    const origArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = undefined;

    class FR {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.error = new Error('read failed');
      }
      readAsArrayBuffer() {
        setImmediate(() => this.onerror());
      }
    }

    global.FileReader = FR;
    const reader = new BinaryReader(blob);
    await assert.rejects(reader.ready, /read failed/);

    Blob.prototype.arrayBuffer = origArrayBuffer;
    delete global.FileReader;
  });
});
