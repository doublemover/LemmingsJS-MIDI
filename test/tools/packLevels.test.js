import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { Lemmings } from '../../js/LemmingsNamespace.js';
import '../../js/LogHandler.js';
import { BinaryReader } from '../../js/BinaryReader.js';
import { BitReader } from '../../js/BitReader.js';
import { BitWriter } from '../../js/BitWriter.js';
import { PackFilePart } from '../../js/PackFilePart.js';
import '../../js/UnpackFilePart.js';
import { FileContainer } from '../../js/FileContainer.js';

const script = path.resolve('tools/packLevels.js');

globalThis.lemmings = { game: { showDebug: false } };

describe('tools/packLevels.js sorted packing', function () {
  it('packs .nxlv files in sorted order', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nxlv-'));
    const files = {
      'B.nxlv': Uint8Array.from({ length: 2048 }, (_, i) => i % 256),
      'A.nxlv': Uint8Array.from({ length: 2048 }, (_, i) => (i * 3) % 256),
      'C.nxlv': Uint8Array.from({ length: 2048 }, (_, i) => (255 - i) % 256)
    };
    for (const [name, data] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), data);
    }
    const outFile = path.join(dir, 'out.dat');

    const result = spawnSync('node', [script, dir, outFile], { encoding: 'utf8' });
    expect(result.status).to.equal(0);

    const buf = fs.readFileSync(outFile);
    const fc = new FileContainer(new BinaryReader(new Uint8Array(buf)));
    expect(fc.count()).to.equal(3);

    const expectedOrder = Object.keys(files).sort();
    expectedOrder.forEach((name, idx) => {
      const data = files[name];
      const part = fc.parts[idx];
      const unpacked = fc.getPart(idx);
      expect(Array.from(unpacked.data.slice(0, unpacked.length)))
        .to.eql(Array.from(data));
      const packed = PackFilePart.pack(data);
      expect(part.checksum).to.equal(packed.checksum);
      expect(part.initialBufferLen).to.equal(packed.initialBits);
    });

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

