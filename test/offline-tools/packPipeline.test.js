import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { BinaryReader } from '../../js/data/BinaryReader.js';
import { FileContainer } from '../../js/data/FileContainer.js';
import { PackFilePart } from '../../js/data/PackFilePart.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = path.join(rootDir, 'tools', 'packPipeline.js');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lemmings-pack-pipeline-'));
const withTempDir = (fn) => {
  const dir = makeTempDir();
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const writeWord = (buffer, offset, value) => {
  buffer[offset] = (value >> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
};

const buildDat = (parts) => {
  const chunks = [];
  for (let i = 0; i < parts.length; i += 1) {
    const raw = Uint8Array.from(parts[i]);
    const packed = PackFilePart.pack(raw);
    const size = packed.byteArray.length + 10;
    const header = new Uint8Array(10);
    header[0] = packed.initialBits;
    header[1] = packed.checksum;
    writeWord(header, 2, 0);
    writeWord(header, 4, raw.length);
    writeWord(header, 6, 0);
    writeWord(header, 8, size);
    chunks.push(Buffer.from(header));
    chunks.push(Buffer.from(packed.byteArray));
  }
  return Buffer.concat(chunks);
};

const runPackPipeline = (args = [], cwd = rootDir) => (
  spawnSync(process.execPath, [scriptPath, ...args], { cwd })
);

const readDatPart = (datPath, index) => {
  const packed = fs.readFileSync(datPath);
  const container = new FileContainer(new BinaryReader(new Uint8Array(packed), 0, packed.length, datPath));
  const reader = container.getPart(index);
  reader.setOffset(0);
  const out = new Uint8Array(reader.length);
  for (let i = 0; i < out.length; i += 1) out[i] = reader.readByte();
  return out;
};

describe('packPipeline', function () {
  it('unpacks and repacks DAT containers without changing part data', function () {
    withTempDir((dir) => {
      const sourceParts = [
        Uint8Array.from([1, 2, 3, 4, 5, 6]),
        Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2])
      ];
      const inputDat = path.join(dir, 'input.dat');
      const unpackDir = path.join(dir, 'unpack');
      const outputDat = path.join(dir, 'output.dat');
      fs.writeFileSync(inputDat, buildDat(sourceParts));

      const unpack = runPackPipeline(['unpack', inputDat, unpackDir]);
      expect(unpack.status).to.equal(0);
      const metaPath = path.join(unpackDir, 'meta.json');
      expect(fs.existsSync(metaPath)).to.equal(true);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      expect(meta.partCount).to.equal(2);
      expect(fs.readFileSync(path.join(unpackDir, 'part-000.bin'))).to.deep.equal(Buffer.from(sourceParts[0]));
      expect(fs.readFileSync(path.join(unpackDir, 'part-001.bin'))).to.deep.equal(Buffer.from(sourceParts[1]));

      const repack = runPackPipeline(['pack', metaPath, outputDat]);
      expect(repack.status).to.equal(0);
      expect(readDatPart(outputDat, 0)).to.deep.equal(sourceParts[0]);
      expect(readDatPart(outputDat, 1)).to.deep.equal(sourceParts[1]);
    });
  });

  it('patches a decompressed part and writes a new DAT', function () {
    withTempDir((dir) => {
      const sourceParts = [
        Uint8Array.from([10, 20, 30, 40]),
        Uint8Array.from([1, 1, 1, 1, 1, 1])
      ];
      const inputDat = path.join(dir, 'input.dat');
      const outputDat = path.join(dir, 'patched.dat');
      const patchFile = path.join(dir, 'patch.bin');
      fs.writeFileSync(inputDat, buildDat(sourceParts));
      fs.writeFileSync(patchFile, Buffer.from([0xaa, 0xbb, 0xcc]));

      const patch = runPackPipeline([
        'patch',
        inputDat,
        outputDat,
        '--part',
        '1',
        '--offset',
        '2',
        '--file',
        patchFile
      ]);

      expect(patch.status).to.equal(0);
      expect(readDatPart(outputDat, 0)).to.deep.equal(sourceParts[0]);
      expect(readDatPart(outputDat, 1)).to.deep.equal(Uint8Array.from([1, 1, 0xaa, 0xbb, 0xcc, 1]));
    });
  });

  it('rejects metadata part paths outside the metadata directory', function () {
    withTempDir((dir) => {
      const unpackDir = path.join(dir, 'unpack');
      fs.mkdirSync(unpackDir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'secret.bin'), Buffer.from([9, 9, 9]));
      fs.writeFileSync(path.join(unpackDir, 'part-000.bin'), Buffer.from([1, 2, 3]));
      const metaPath = path.join(unpackDir, 'meta.json');
      const outputDat = path.join(dir, 'output.dat');
      fs.writeFileSync(metaPath, JSON.stringify({
        format: 'lemmings-dat-pipeline-v1',
        parts: [
          { index: 0, file: '../secret.bin', decompressedSize: 3 }
        ]
      }));

      const result = runPackPipeline(['pack', metaPath, outputDat]);
      expect(result.status).to.not.equal(0);
      expect(result.stderr.toString()).to.match(/escapes base directory/i);
      expect(fs.existsSync(outputDat)).to.equal(false);
    });
  });

  it('rejects absolute metadata part paths', function () {
    withTempDir((dir) => {
      const metaPath = path.join(dir, 'meta.json');
      const absPart = path.join(dir, 'part-000.bin');
      fs.writeFileSync(absPart, Buffer.from([1]));
      fs.writeFileSync(metaPath, JSON.stringify({
        format: 'lemmings-dat-pipeline-v1',
        parts: [
          { index: 0, file: absPart, decompressedSize: 1 }
        ]
      }));

      const result = runPackPipeline(['pack', metaPath, path.join(dir, 'output.dat')]);
      expect(result.status).to.not.equal(0);
      expect(result.stderr.toString()).to.match(/escapes base directory/i);
    });
  });

  it('prints usage when command arguments are missing', function () {
    const result = runPackPipeline([]);
    expect(result.status).to.equal(0);
    expect(result.stdout.toString()).to.match(/Usage:/);
  });
});
