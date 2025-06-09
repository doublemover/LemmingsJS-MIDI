import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PNG } from 'pngjs';

import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { PackFilePart } from '../js/PackFilePart.js';
import '../js/UnpackFilePart.js';
import { FileContainer } from '../js/FileContainer.js';

globalThis.lemmings = { game: { showDebug: false } };

async function runScript(script, args) {
  const origArgv = process.argv;
  process.argv = ['node', script, ...args];
  await import(pathToFileURL(script).href + `?t=${Date.now()}`);
  process.argv = origArgv;
}

describe('tools/patchSprites.js extra coverage', function () {
  function createTempScript() {
    const origPath = new URL('../tools/patchSprites.js', import.meta.url);
    const code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
    const patched = code.replace('import \'../js/LemmingsBootstrap.js\';', '');
    const tempScript = path.join(path.dirname(fileURLToPath(origPath)), 'patchSprites.test-run.js');
    fs.writeFileSync(tempScript, patched);
    return tempScript;
  }

  afterEach(function () {
    const tempPath = path.join(path.dirname(fileURLToPath(new URL('../tools/patchSprites.js', import.meta.url))), 'patchSprites.test-run.js');
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  });

  it('shows usage when arguments are missing', async function () {
    const script = createTempScript();
    const logs = [];
    const origLog = console.log;
    console.log = msg => logs.push(String(msg));
    await runScript(script, []);
    console.log = origLog;
    expect(logs.some(l => l.includes('Usage:'))).to.be.true;
  });

  it('slices a horizontal sprite sheet', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprites-'));
    const pngDir = path.join(dir, 'png');
    fs.mkdirSync(pngDir);

    const raws = [
      Uint8Array.from({ length: 16 }, (_, i) => i),
      Uint8Array.from({ length: 16 }, (_, i) => i + 16)
    ];

    const parts = raws.map(raw => {
      const packed = PackFilePart.pack(raw);
      const size = packed.byteArray.length + 10;
      const header = new Uint8Array([
        packed.initialBits,
        packed.checksum,
        0, 0,
        0, 16,
        0, 0,
        (size >> 8) & 0xff,
        size & 0xff
      ]);
      return { header, packed: packed.byteArray, size };
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

    const sheet = new PNG({ width: 4, height: 2 });
    const f1 = Uint8Array.from(raws[0].map(v => v + 1));
    const f2 = Uint8Array.from(raws[1].map(v => v + 1));
    sheet.data = Buffer.alloc(32);
    sheet.data.set(f1.subarray(0, 8), 0);
    sheet.data.set(f2.subarray(0, 8), 8);
    sheet.data.set(f1.subarray(8), 16);
    sheet.data.set(f2.subarray(8), 24);
    fs.writeFileSync(path.join(pngDir, '0.png'), PNG.sync.write(sheet));

    const outFile = path.join(dir, 'out.dat');
    const script = createTempScript();
    await runScript(script, ['--sheet-orientation=horizontal', datFile, pngDir, outFile]);

    const outBuf = fs.readFileSync(outFile);
    const fc = new FileContainer(new BinaryReader(new Uint8Array(outBuf)));
    expect(fc.count()).to.equal(2);
    const expectData = [
      raws[0].map(v => v + 1),
      raws[1].map(v => v + 1)
    ];
    fc.parts.forEach((part, idx) => {
      const unpacked = fc.getPart(idx);
      expect(Array.from(unpacked.data.slice(0, unpacked.length))).to.eql(Array.from(expectData[idx]));
    });
  });

  it('skips PNGs with mismatching size', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprites-'));
    const pngDir = path.join(dir, 'png');
    fs.mkdirSync(pngDir);

    const raw = Uint8Array.from({ length: 16 }, (_, i) => i);
    const packed = PackFilePart.pack(raw);
    const size = packed.byteArray.length + 10;
    const header = new Uint8Array([
      packed.initialBits,
      packed.checksum,
      0, 0,
      0, 16,
      0, 0,
      (size >> 8) & 0xff,
      size & 0xff
    ]);
    const datBuf = new Uint8Array(size);
    datBuf.set(header, 0);
    datBuf.set(packed.byteArray, 10);
    const datFile = path.join(dir, 'orig.dat');
    fs.writeFileSync(datFile, datBuf);

    const badPng = new PNG({ width: 3, height: 2 });
    badPng.data = Buffer.alloc(3 * 2 * 4); // 24 bytes vs expected 16
    fs.writeFileSync(path.join(pngDir, '0.png'), PNG.sync.write(badPng));

    const outFile = path.join(dir, 'out.dat');
    const script = createTempScript();
    const logs = [];
    const origLog = console.log;
    console.log = msg => logs.push(String(msg));
    await runScript(script, [datFile, pngDir, outFile]);
    console.log = origLog;
    expect(logs.some(l => l.includes('size mismatch'))).to.be.true;
    expect(fs.existsSync(outFile)).to.be.true;
  });
});
