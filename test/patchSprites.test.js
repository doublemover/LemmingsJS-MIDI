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
    const patched = code.replace('import \'../js/LemmingsBootstrap.js\';', '');
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

  it('patches multiple sprites and preserves palette offsets', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprites-'));
    const pngDir = path.join(dir, 'png');
    fs.mkdirSync(pngDir);

    const raws = [
      Uint8Array.from({ length: 16 }, (_, i) => i),
      Uint8Array.from({ length: 16 }, (_, i) => i + 16),
      Uint8Array.from({ length: 16 }, (_, i) => i + 32)
    ];
    const paletteOffsets = [1, 2, 3];

    const parts = raws.map((raw, idx) => {
      const packed = PackFilePart.pack(raw);
      const size = packed.data.length + 10;
      const header = new Uint8Array([
        packed.initialBits,
        packed.checksum,
        0, 0,
        0, 16,
        0, paletteOffsets[idx],
        (size >> 8) & 0xFF,
        size & 0xFF
      ]);
      return { header, packed: packed.data, size };
    });

    const total = parts.reduce((s, p) => s + p.size, 0);
    const datBuf = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      datBuf.set(p.header, off);
      datBuf.set(p.packed, off + 10);
      off += p.size;
    }
    const datFile = path.join(dir, 'orig.dat');
    fs.writeFileSync(datFile, datBuf);

    const png0 = new PNG({ width: 2, height: 2 });
    png0.data = Buffer.from(raws[0].map(v => v + 1));
    fs.writeFileSync(path.join(pngDir, '0.png'), PNG.sync.write(png0));

    const sheet = new PNG({ width: 2, height: 4 });
    sheet.data = Buffer.alloc(32);
    sheet.data.set(Buffer.from(raws[1].map(v => v + 1)), 0);
    sheet.data.set(Buffer.from(raws[2].map(v => v + 1)), 16);
    fs.writeFileSync(path.join(pngDir, '1.png'), PNG.sync.write(sheet));

    const outFile = path.join(dir, 'out.dat');

    const origPath = new URL('../tools/patchSprites.js', import.meta.url);
    const code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
    const patched = code.replace('import \'../js/LemmingsBootstrap.js\';', '');
    const tempScript = path.join(path.dirname(fileURLToPath(origPath)), 'patchSprites.test-run.js');
    fs.writeFileSync(tempScript, patched);

    const origArgv = process.argv;
    process.argv = ['node', tempScript, '--sheet-orientation=vertical', datFile, pngDir, outFile];
    await import(pathToFileURL(tempScript).href);
    process.argv = origArgv;
    fs.unlinkSync(tempScript);

    const outBuf = fs.readFileSync(outFile);
    const fc = new FileContainer(new BinaryReader(new Uint8Array(outBuf)));
    expect(fc.count()).to.equal(3);

    const expectData = [
      raws[0].map(v => v + 1),
      raws[1].map(v => v + 1),
      raws[2].map(v => v + 1)
    ];

    fc.parts.forEach((part, idx) => {
      const unpacked = fc.getPart(idx);
      expect(Array.from(unpacked.data.slice(0, unpacked.length)))
        .to.eql(Array.from(expectData[idx]));
      const repacked = PackFilePart.pack(Uint8Array.from(expectData[idx]));
      expect(part.checksum).to.equal(repacked.checksum);
      expect(part.initialBufferLen).to.equal(repacked.initialBits);
      expect(part.unknown0).to.equal(paletteOffsets[idx]);
    });
  });
});
