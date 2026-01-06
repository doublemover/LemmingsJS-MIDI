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
const withTempDir = (fn) => {
  const dir = makeTempDir();
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const runPackLevels = (args = [], cwd = rootDir) => (
  spawnSync(process.execPath, [scriptPath, ...args], { cwd })
);
const writeLevel = (dir, name, bytes) => {
  const lvlPath = path.join(dir, name);
  fs.writeFileSync(lvlPath, bytes);
  return lvlPath;
};

describe('packLevels', function () {
  it('packs 2048 byte level files into a DAT archive', function () {
    withTempDir((dir) => {
      const source = new Uint8Array(2048);
      for (let i = 0; i < source.length; i++) {
        source[i] = i % 256;
      }
      writeLevel(dir, 'LEVEL001.LVL', source);
      const outFile = path.join(dir, 'packed.dat');

      const res = runPackLevels([dir, outFile]);
      expect(res.status).to.equal(0);
      expect(fs.existsSync(outFile)).to.equal(true);

      const packed = fs.readFileSync(outFile);
      const packedContainer = new FileContainer(new BinaryReader(packed, 0, undefined, outFile));
      expect(packedContainer.count()).to.equal(1);
      const unpacked = packedContainer.getPart(0);
      unpacked.setOffset(0);
      const outBytes = new Uint8Array(source.length);
      for (let j = 0; j < outBytes.length; j++) {
        outBytes[j] = unpacked.readByte();
      }
      expect(Buffer.compare(Buffer.from(outBytes), Buffer.from(source))).to.equal(0);
    });
  });

  it('prints usage when required args are missing', function () {
    const res = runPackLevels();
    expect(res.status).to.equal(0);
    expect(res.stdout.toString()).to.match(/Usage: node tools\/packLevels\.js/);
  });

  it('skips files that are not 2048 bytes', function () {
    withTempDir((dir) => {
      writeLevel(dir, 'LEVEL001.LVL', new Uint8Array(10));
      const outFile = path.join(dir, 'packed.dat');

      const res = runPackLevels([dir, outFile]);
      expect(res.status).to.equal(0);
      expect(res.stderr.toString()).to.include('Skipping LEVEL001.LVL');
      expect(fs.readFileSync(outFile).length).to.equal(0);
    });
  });
});
