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
const withTempDir = async (fn) => {
  const dir = makeTempDir();
  try {
    return await fn(dir);
  } finally {
    cleanup(dir);
  }
};
const expectReject = async (promise) => {
  let err = null;
  try {
    await promise;
  } catch (e) {
    err = e;
  }
  expect(err).to.be.instanceOf(Error);
  return err;
};
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packFile = path.join(rootDir, 'lemmings', 'LEVEL000.DAT');

describe('archiveDir', function () {
  it('creates zip and tar archives', async function () {
    await withTempDir(async (dir) => {
      fs.copyFileSync(packFile, path.join(dir, 'LEVEL000.DAT'));
      await archiveDir(dir, 'zip');
      await archiveDir(dir, 'tar.gz');
      expect(fs.existsSync(`${dir}.zip`)).to.equal(true);
      expect(fs.existsSync(`${dir}.tar.gz`)).to.equal(true);
    });
  });

  it('throws when rar command fails', async function () {
    await withTempDir(async (dir) => {
      fs.copyFileSync(packFile, path.join(dir, 'LEVEL000.DAT'));
      const missingDir = path.join(dir, 'missing');
      await expectReject(
        archiveDir(missingDir, 'rar', { spawnSync: () => ({ status: 1 }) })
      );
    });
  });

  it('accepts successful rar commands', async function () {
    await withTempDir(async (dir) => {
      fs.copyFileSync(packFile, path.join(dir, 'LEVEL000.DAT'));
      await archiveDir(dir, 'rar', { spawnSync: () => ({ status: 0 }) });
    });
  });

  it('rejects unsupported formats', async function () {
    await withTempDir(async (dir) => {
      await expectReject(archiveDir(dir, '7z'));
    });
  });
});
