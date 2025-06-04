import assert from 'assert';

// Minimal environment for LogHandler
global.lemmings = { game: { showDebug: false } };

import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/BinaryReader.js';
import '../js/BitReader.js';
import '../js/BitWriter.js';
import '../js/UnpackFilePart.js';
import { FileContainer } from '../js/FileContainer.js';

function buildBuffer(badChecksum = false) {
  const compressed = Uint8Array.from([16, 8, 24, 8]);
  let checksum = 0;
  for (const b of compressed) checksum ^= b;
  if (badChecksum) checksum ^= 0xFF;
  const size = compressed.length + 10;
  const header = Uint8Array.from([
    5, checksum, 0, 0, 0, 3, 0, 0, 0, size
  ]);
  const buffer = new Uint8Array(size);
  buffer.set(header, 0);
  buffer.set(compressed, 10);
  return { buffer, checksum, compressed };
}

function computeChecksum(part, source) {
  let cs = 0;
  const data = source.data.subarray(part.offset, part.offset + part.compressedSize);
  for (const b of data) cs ^= b;
  return cs;
}

function runTest(bad) {
  const { buffer, checksum, compressed } = buildBuffer(bad);
  const br = new Lemmings.BinaryReader(buffer, 0, buffer.length, 'buf');
  const fc = new FileContainer(br);
  assert.strictEqual(fc.count(), 1);
  const part = fc.parts[0];
  assert.strictEqual(part.initialBufferLen, 5);
  assert.strictEqual(part.compressedSize, compressed.length);
  assert.strictEqual(part.decompressedSize, 3);
  assert.strictEqual(part.checksum, checksum);

  const out = part.unpack();
  assert.strictEqual(out.length, part.decompressedSize);
  assert.deepStrictEqual(Array.from(out.data.slice(0, out.length)), [8, 16, 24]);

  const calc = computeChecksum(part, br);
  if (bad) {
    assert.notStrictEqual(calc, part.checksum);
  } else {
    assert.strictEqual(calc, part.checksum);
  }
}

describe('FileContainer', function () {
  it('unpacks a valid part', function () {
    runTest(false);
  });

  it('detects invalid checksum', function () {
    runTest(true);
  });
});
