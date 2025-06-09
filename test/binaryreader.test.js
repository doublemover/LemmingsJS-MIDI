import assert from 'assert';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import '../js/LogHandler.js';

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
    assert.strictEqual(reader.readIntBE(0), 0x04030201);
    assert.strictEqual(reader.readWord(4), 0x0506);
    assert.strictEqual(reader.readWordBE(4), 0x0605);
    assert.strictEqual(reader.readString(3, 6), 'ABC');
  });

  it('logs warnings for invalid offsets', function () {
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
      debug() {}
    }

    const origHandler = Lemmings.LogHandler;
    Lemmings.LogHandler = MockLogHandler;
    const bytes = Uint8Array.from([0x00, 0x01]);
    const reader = new BinaryReader(bytes, 0, bytes.length, 'test.bin');

    const prev = globalThis.lemmings.game.showDebug;
    globalThis.lemmings.game.showDebug = true;

    reader.readByte(-1);
    reader.readByte(5);

    globalThis.lemmings.game.showDebug = prev;

    assert.ok(reader.log.logged.filter(m => m.includes('read out of data')).length >= 2);
    Lemmings.LogHandler = origHandler;
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
});
