import assert from 'assert';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';
import { BitWriter } from '../js/BitWriter.js';
import { FileContainer } from '../js/FileContainer.js';
import '../js/UnpackFilePart.js';
import { readFileSync } from 'fs';

globalThis.lemmings = { game: { showDebug: false } };

describe('BitReader/BitWriter', function () {
  it('decompresses raw bytes', function () {
    const compressed = Uint8Array.from([0x10, 0x48, 0x58, 0x48]);
    const br = new BinaryReader(compressed);
    const bitReader = new BitReader(br, 0, compressed.length, 8);
    const bitWriter = new BitWriter(bitReader, 3);

    while (!bitWriter.eof() && !bitReader.eof()) {
      if (bitReader.read(1) === 0) {
        if (bitReader.read(1) === 0) {
          bitWriter.copyRawData(bitReader.read(3) + 1);
        } else {
          bitWriter.copyReferencedData(2, 8);
        }
      } else {
        switch (bitReader.read(2)) {
          case 0:
            bitWriter.copyReferencedData(3, 9);
            break;
          case 1:
            bitWriter.copyReferencedData(4, 10);
            break;
          case 2:
            bitWriter.copyReferencedData(bitReader.read(8) + 1, 12);
            break;
          case 3:
            bitWriter.copyRawData(bitReader.read(8) + 9);
            break;
        }
      }
    }

    const result = Array.from(bitWriter.outData);
    assert.deepStrictEqual(result, [0x41, 0x42, 0x43]);
  });

  it('unpacks first chunk of LEVEL000.DAT', function () {
    const data = readFileSync(new URL('../lemmings/LEVEL000.DAT', import.meta.url));
    const br = new BinaryReader(new Uint8Array(data));
    const fc = new FileContainer(br);
    const part = fc.getPart(0);
    const bytes = [];
    for (let i = 0; i < 10; i++) {
      bytes.push(part.readByte());
    }
    assert.deepStrictEqual(bytes, [0, 50, 0, 80, 0, 40, 0, 4, 0, 10]);
  });
});
