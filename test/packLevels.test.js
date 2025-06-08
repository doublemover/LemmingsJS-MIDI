import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';
import { BitWriter } from '../js/BitWriter.js';
import { PackFilePart } from '../js/PackFilePart.js';
import '../js/UnpackFilePart.js';
import { FileContainer } from '../js/FileContainer.js';

const script = path.resolve('tools/packLevels.js');

globalThis.lemmings = { game: { showDebug: false } };

async function runScript(scriptPath, args, options = {}) {
  const origArgv = process.argv;
  const origCwd = process.cwd();
  let error;
  const handler = e => { error = e; };
  if (options.cwd) process.chdir(options.cwd);
  process.argv = ['node', scriptPath, ...args];
  process.once('unhandledRejection', handler);
  try {
    const mod = await import(pathToFileURL(scriptPath).href + `?t=${Date.now()}`);
    await mod.main?.(args);
    await new Promise(r => setTimeout(r, 20));
  } finally {
    process.off('unhandledRejection', handler);
    process.argv = origArgv;
    if (options.cwd) process.chdir(origCwd);
  }
  if (error) throw error;
}

describe('tools/packLevels.js', function () {
  it('packs a directory of levels into a DAT file', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levels-'));
    const a = Uint8Array.from({ length: 2048 }, (_, i) => i % 256);
    const b = Uint8Array.from({ length: 2048 }, (_, i) => (255 - i) % 256);
    fs.writeFileSync(path.join(dir, 'A.bin'), a);
    fs.writeFileSync(path.join(dir, 'B.bin'), b);
    const outFile = path.join(dir, 'out.dat');

    await runScript(script, [dir, outFile]);

    const buf = fs.readFileSync(outFile);
    const fc = new FileContainer(new BinaryReader(new Uint8Array(buf)));
    expect(fc.count()).to.equal(2);

    const inputs = [a, b];
    fc.parts.forEach((part, idx) => {
      const unpacked = fc.getPart(idx);
      expect(Array.from(unpacked.data.slice(0, unpacked.length)))
        .to.eql(Array.from(inputs[idx]));
      const packed = PackFilePart.pack(inputs[idx]);
      expect(part.checksum).to.equal(packed.checksum);
      expect(part.initialBufferLen).to.equal(packed.initialBits);
    });
  });

  it('prints usage when arguments are missing', function () {
    const result = spawnSync('node', [script], { encoding: 'utf8' });
    expect(result.status).to.equal(0);
    const output = (result.stdout + result.stderr).trim();
    expect(output).to.match(/Usage:/);
  });

  it('fails when the level directory is missing', function () {
    const missingDir = path.join(os.tmpdir(), 'no-such-dir');
    const outFile = path.join(os.tmpdir(), 'out.dat');
    const result = spawnSync('node', [script, missingDir, outFile], {
      encoding: 'utf8'
    });
    expect(result.status).to.not.equal(0);
    expect(result.stderr).to.match(/ENOENT|no such file/i);
  });
});
