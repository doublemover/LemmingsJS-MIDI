import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PNG } from 'pngjs';

import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';
import { BitWriter } from '../js/BitWriter.js';
import { PackFilePart } from '../js/PackFilePart.js';
import '../js/UnpackFilePart.js';
import { FileContainer } from '../js/FileContainer.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('tools/patchSprites.js', function () {
  it('patches sprite data using PNG files', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprites-'));
    const pngDir = path.join(dir, 'png');
    fs.mkdirSync(pngDir);

    const raw = Uint8Array.from({ length: 16 }, (_, i) => i);
    const packed = PackFilePart.pack(raw);
    const size = packed.data.length + 10;
    const header = new Uint8Array([
      packed.initialBits,
      packed.checksum,
      0, 0,
      0, 16,
      0, 0,
      (size >> 8) & 0xFF,
      size & 0xFF
    ]);
    const datBuf = new Uint8Array(size);
    datBuf.set(header, 0);
    datBuf.set(packed.data, 10);
    const datFile = path.join(dir, 'orig.dat');
    fs.writeFileSync(datFile, datBuf);

    const png = new PNG({ width: 2, height: 2 });
    png.data = Buffer.from(raw);
    fs.writeFileSync(path.join(pngDir, '0.png'), PNG.sync.write(png));

    const outFile = path.join(dir, 'out.dat');

    const origPath = new URL('../tools/patchSprites.js', import.meta.url);
    const code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
    const patched = code.replace("import '../js/LemmingsBootstrap.js';", '');
    const tempScript = path.join(path.dirname(fileURLToPath(origPath)), 'patchSprites.test-run.js');
    fs.writeFileSync(tempScript, patched);

    const origArgv = process.argv;
    process.argv = ['node', tempScript, datFile, pngDir, outFile];
    await import(pathToFileURL(tempScript).href);
    process.argv = origArgv;
    fs.unlinkSync(tempScript);

    const outBuf = fs.readFileSync(outFile);
    const fc = new FileContainer(new BinaryReader(new Uint8Array(outBuf)));
    expect(fc.count()).to.equal(1);
    const part = fc.parts[0];
    const unpacked = fc.getPart(0);
    expect(Array.from(unpacked.data.slice(0, unpacked.length)))
      .to.eql(Array.from(raw));
    const expected = PackFilePart.pack(raw);
    expect(part.checksum).to.equal(expected.checksum);
    expect(part.initialBufferLen).to.equal(expected.initialBits);
  });
});
