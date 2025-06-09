import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PNG } from 'pngjs';
import { BinaryReader } from '../js/BinaryReader.js';
import { PackFilePart } from '../js/PackFilePart.js';
import '../js/UnpackFilePart.js';
import '../js/BitReader.js';
import '../js/BitWriter.js';
import { FileContainer } from '../js/FileContainer.js';
import '../js/LogHandler.js';

function patchScript() {
  const origPath = new URL('../tools/patchSprites.js', import.meta.url);
  let code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
  code = code.replace('import \'../js/LemmingsBootstrap.js\';', '');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-'));
  const tmpFile = path.join(tmpDir, 'patchSprites.js');
  fs.writeFileSync(tmpFile, code);
  return tmpFile;
}

function createDat(dir) {
  const raw = Uint8Array.from({ length: 16 }, (_, i) => i);
  const packed = PackFilePart.pack(raw);
  const size = packed.byteArray.length + 10;
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
  datBuf.set(packed.byteArray, 10);
  const datFile = path.join(dir, 'orig.dat');
  fs.writeFileSync(datFile, datBuf);
  return { datFile, raw };
}

function createPng(dir, raw) {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.from(raw);
  const pngFile = path.join(dir, '0.png');
  fs.writeFileSync(pngFile, PNG.sync.write(png));
}

function runScriptSync(script, args) {
  const { spawnSync } = require('child_process');
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

describe('tools/patchSprites.js CLI', function () {
  it('prints usage when arguments are missing', function () {
    const script = patchScript();
    const res = runScriptSync(script, []);
    expect(res.status).to.equal(0);
    expect(res.stdout).to.match(/Usage:/);
  });

  it('processes sprites with --sheet-orientation option', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprites-'));
    const pngDir = path.join(dir, 'png');
    fs.mkdirSync(pngDir);

    const { datFile, raw } = createDat(dir);
    createPng(pngDir, raw);

    const outFile = path.join(dir, 'out.dat');
    const script = patchScript();
    const res = runScriptSync(script, ['--sheet-orientation=vertical', datFile, pngDir, outFile]);
    expect(res.status).to.equal(0);
    expect(fs.existsSync(outFile)).to.be.true;

    const outBuf = fs.readFileSync(outFile);
    const fc = new FileContainer(new BinaryReader(new Uint8Array(outBuf)));
    expect(fc.count()).to.equal(1);
  });
});
