import assert from 'assert';
import { Lemmings, setDependency, useGlobalLemmings } from './helpers/lemmings.js';
import { BitWriter } from '../js/data/BitWriter.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
// minimal global environment for logging
useGlobalLemmings({ game: { showDebug: false } });

class MockLogHandler {
  constructor() { this.logged = []; }
  log(msg) { this.logged.push(msg); }
  debug() {}
}

const withMockLogHandler = (fn) => {
  const origHandler = Lemmings.LogHandler;
  setDependency('LogHandler', MockLogHandler);
  try {
    return fn();
  } finally {
    setDependency('LogHandler', origHandler);
  }
};

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
    const { outData, log } = withMockLogHandler(() => {
      const stub = new StubReader([0x01, 0x02, 0x03]);
      const writer = new BitWriter(stub, 2);
      writer.copyRawData(3);
      return { outData: writer.outData, log: writer.log };
    });

    assert.deepStrictEqual(Array.from(outData), [0x02, 0x01]);
    assert.ok(log.logged.some(m => m.includes('out of out buffer')));
  });

  it('truncates copyReferencedData when length exceeds buffer', function () {
    const { outData, log } = withMockLogHandler(() => {
      const stub = new StubReader([0xAA, 0xBB, 0x00]);
      const writer = new BitWriter(stub, 3);
      writer.copyRawData(2);
      writer.copyReferencedData(3, 1); // offset=0 -> 1
      return { outData: writer.outData, log: writer.log };
    });

    assert.deepStrictEqual(Array.from(outData), [0xBB, 0xBB, 0xAA]);
    assert.ok(log.logged.some(m => m.includes('out of out buffer')));
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
    const { outData, outPos, log, before, posBefore } = withMockLogHandler(() => {
      const stub = new StubReader([0xaa, 0xbb, 3]);
      const writer = new BitWriter(stub, 3);
      writer.copyRawData(2);
      const before = Array.from(writer.outData);
      const posBefore = writer.outPos;
      writer.copyReferencedData(1, 2); // offset=3 + 1 = 4 -> out of range
      return {
        outData: writer.outData,
        outPos: writer.outPos,
        log: writer.log,
        before,
        posBefore
      };
    });

    assert.deepStrictEqual(Array.from(outData), before);
    assert.strictEqual(outPos, posBefore);
    assert.ok(log.logged.some(m => m.includes('offset out of range')));
  });
});
