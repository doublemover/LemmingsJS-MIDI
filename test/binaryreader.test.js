import assert from 'assert';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('BinaryReader', function () {
  it('reads data from Blob asynchronously', async function () {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const blob = new Blob([bytes]);
    const reader = new BinaryReader(blob);
    await reader.ready;
    const result = [reader.readByte(), reader.readByte(), reader.readByte(), reader.readByte()];
    assert.deepStrictEqual(result, [1, 2, 3, 4]);
  });
});
