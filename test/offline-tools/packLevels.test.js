import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { BinaryReader } from '../../js/data/BinaryReader.js';
import { FileContainer } from '../../js/data/FileContainer.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = path.join(rootDir, 'tools', 'packLevels.js');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lemmings-pack-'));

describe('packLevels', function () {
  it('packs 2048 byte level files into a DAT archive', function () {
    const dir = makeTempDir();
    const source = new Uint8Array(2048);
    for (let i = 0; i < source.length; i++) {
      source[i] = i % 256;
    }
    const lvlPath = path.join(dir, 'LEVEL001.LVL');
    fs.writeFileSync(lvlPath, source);
    const outFile = path.join(dir, 'packed.dat');

    const res = spawnSync(process.execPath, [scriptPath, dir, outFile], { cwd: rootDir });
    expect(res.status).to.equal(0);
    expect(fs.existsSync(outFile)).to.equal(true);

    const packed = fs.readFileSync(outFile);
    const packedContainer = new FileContainer(new BinaryReader(packed, outFile));
    expect(packedContainer.count()).to.equal(1);
    const packedPart = packedContainer.getPart(0);
    const unpacked = packedPart.unpack();
    unpacked.setOffset(0);
    const outBytes = new Uint8Array(source.length);
    for (let j = 0; j < outBytes.length; j++) {
      outBytes[j] = unpacked.readByte();
    }
    expect(Buffer.compare(Buffer.from(outBytes), Buffer.from(source))).to.equal(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
