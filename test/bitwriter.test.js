import assert from 'assert';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BitWriter } from '../js/BitWriter.js';
import { BinaryReader } from '../js/BinaryReader.js';
import '../js/LogHandler.js';

// minimal global used by LogHandler
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
});
