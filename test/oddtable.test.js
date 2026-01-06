import { expect } from 'chai';
import { readFileSync } from 'fs';

import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import '../js/data/BinaryReader.js';
import '../js/data/BitReader.js';
import '../js/data/BitWriter.js';
import '../js/data/UnpackFilePart.js';
import { FileContainer } from '../js/data/FileContainer.js';

useGlobalLemmings({ game: { showDebug: false } });

describe('ODDTABLE offsets', function() {
  it('parses part offsets from LEVEL000.DAT', function() {
    const buf = readFileSync(new URL('../lemmings/LEVEL000.DAT', import.meta.url));
    const br = new Lemmings.BinaryReader(new Uint8Array(buf));
    const fc = new FileContainer(br);

    const expected = [];
    let pos = 0;
    const HEADER_SIZE = 10;
    while (pos + HEADER_SIZE <= br.length) {
      br.setOffset(pos + 8);
      const size = br.readWord();
      if (size === 0) break;
      expected.push(pos + HEADER_SIZE);
      pos += size;
    }

    const offsets = fc.parts.map(p => p.offset);
    expect(offsets).to.eql(expected);
  });
});
