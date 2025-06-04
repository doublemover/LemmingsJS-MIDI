import assert from 'assert';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';

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
});
