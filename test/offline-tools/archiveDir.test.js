import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { archiveDir } from '../../tools/archiveDir.js';
import { fileURLToPath } from 'url';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lemmings-archive-'));

const cleanup = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(`${dir}.zip`, { force: true });
  fs.rmSync(`${dir}.tar.gz`, { force: true });
};
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packFile = path.join(rootDir, 'lemmings', 'LEVEL000.DAT');

describe('archiveDir', function () {
  it('creates zip and tar archives', async function () {
    const dir = makeTempDir();
    fs.copyFileSync(packFile, path.join(dir, 'LEVEL000.DAT'));
    await archiveDir(dir, 'zip');
    await archiveDir(dir, 'tar.gz');
    expect(fs.existsSync(`${dir}.zip`)).to.equal(true);
    expect(fs.existsSync(`${dir}.tar.gz`)).to.equal(true);
    cleanup(dir);
  });

  it('throws when rar command fails', async function () {
    const dir = makeTempDir();
    fs.copyFileSync(packFile, path.join(dir, 'LEVEL000.DAT'));
    const missingDir = path.join(dir, 'missing');
    try {
      let err = null;
      try {
        await archiveDir(missingDir, 'rar', { spawnSync: () => ({ status: 1 }) });
      } catch (e) {
        err = e;
      }
      expect(err).to.be.instanceOf(Error);
    } finally {
      cleanup(dir);
    }
  });

  it('accepts successful rar commands', async function () {
    const dir = makeTempDir();
    fs.copyFileSync(packFile, path.join(dir, 'LEVEL000.DAT'));
    try {
      await archiveDir(dir, 'rar', { spawnSync: () => ({ status: 0 }) });
    } finally {
      cleanup(dir);
    }
  });

  it('rejects unsupported formats', async function () {
    const dir = makeTempDir();
    let err = null;
    try {
      await archiveDir(dir, '7z');
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(Error);
    cleanup(dir);
  });
});
