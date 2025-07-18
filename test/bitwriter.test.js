import assert from 'assert';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BitWriter } from '../js/BitWriter.js';
import { BinaryReader } from '../js/BinaryReader.js';
// minimal global environment for logging
globalThis.lemmings = { game: { showDebug: false } };

class StubReader {
  constructor(values) {
    this.values = values.slice();
  }
  read(bits) {
    return this.values.shift();
  }
}

describe('BitWriter', function () {
  it('writes raw and referenced data', function () {
    const stub = new StubReader([0x01, 0x02, 0x03, 0x04, 1]);
    const writer = new BitWriter(stub, 6);

    writer.copyRawData(4);
    assert.deepStrictEqual(Array.from(writer.outData.slice(2)), [0x04, 0x03, 0x02, 0x01]);

    writer.copyReferencedData(2, 2);
    assert.deepStrictEqual(Array.from(writer.outData), [0x04, 0x03, 0x04, 0x03, 0x02, 0x01]);

    const fr = writer.getFileReader();
    assert.ok(fr instanceof BinaryReader);
    assert.deepStrictEqual(Array.from(fr.data), Array.from(writer.outData));

    assert.ok(writer.eof());
  });

  it('truncates copyRawData when length exceeds buffer', function () {
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
    }
    const origHandler = Lemmings.LogHandler;
    Lemmings.LogHandler = MockLogHandler;

    const stub = new StubReader([0x01, 0x02, 0x03]);
    const writer = new BitWriter(stub, 2);
    const log = writer.log;

    writer.copyRawData(3);

    assert.deepStrictEqual(Array.from(writer.outData), [0x02, 0x01]);
    assert.ok(log.logged.some(m => m.includes('out of out buffer')));

    Lemmings.LogHandler = origHandler;
  });

  it('truncates copyReferencedData when length exceeds buffer', function () {
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
    }
    const origHandler = Lemmings.LogHandler;
    Lemmings.LogHandler = MockLogHandler;

    const stub = new StubReader([0xAA, 0xBB, 0x00]);
    const writer = new BitWriter(stub, 3);
    const log = writer.log;

    writer.copyRawData(2);
    writer.copyReferencedData(3, 1); // offset=0 -> 1

    assert.deepStrictEqual(Array.from(writer.outData), [0xBB, 0xBB, 0xAA]);
    assert.ok(log.logged.some(m => m.includes('out of out buffer')));

    Lemmings.LogHandler = origHandler;
  });

  it('validates constructor arguments', function () {
    class MockReader { read() {} }
    const stub = new MockReader();

    assert.throws(() => new BitWriter(null, 1), TypeError);
    assert.throws(() => new BitWriter({}, 1), TypeError);
    assert.throws(() => new BitWriter(stub, 0), RangeError);
    assert.throws(() => new BitWriter(stub, -1), RangeError);
    assert.throws(() => new BitWriter(stub, 1.5), RangeError);
  });

  it('exposes internal state via getters', function () {
    const stub = new StubReader([0x01]);
    const writer = new BitWriter(stub, 1);

    assert.strictEqual(writer.outPos, 1);
    assert.strictEqual(writer.bitReader, stub);
  });

  it('handles out-of-range referenced copy', function () {
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
    }
    const origHandler = Lemmings.LogHandler;
    Lemmings.LogHandler = MockLogHandler;

    const stub = new StubReader([0xaa, 0xbb, 3]);
    const writer = new BitWriter(stub, 3);
    const log = writer.log;

    writer.copyRawData(2);
    const before = Array.from(writer.outData);
    const posBefore = writer.outPos;

    writer.copyReferencedData(1, 2); // offset=3 + 1 = 4 -> out of range

    assert.deepStrictEqual(Array.from(writer.outData), before);
    assert.strictEqual(writer.outPos, posBefore);
    assert.ok(log.logged.some(m => m.includes('offset out of range')));

    Lemmings.LogHandler = origHandler;
  });
});
