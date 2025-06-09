import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { archiveDir } from '../../tools/archiveDir.js';

const originalPath = process.env.PATH;
const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rarbin-'));
const rarScript = path.join(mockDir, 'rar');

function setRarBehavior(success) {
  if (success) {
    fs.writeFileSync(rarScript, '#!/bin/sh\ntouch "$2"\nexit 0\n');
  } else {
    fs.writeFileSync(rarScript, '#!/bin/sh\nexit 1\n');
  }
  fs.chmodSync(rarScript, 0o755);
}

setRarBehavior(true);
process.env.PATH = `${mockDir}:${originalPath}`;
const rarCheck = spawnSync('rar', ['--version'], { stdio: 'ignore' });
const hasRar = !rarCheck.error;

after(function () {
  process.env.PATH = originalPath;
  fs.rmSync(mockDir, { recursive: true, force: true });
});

describe('archiveDir', function () {
  it('creates a zip archive', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    fs.writeFileSync(path.join(dir, 'file.txt'), 'zip');
    await archiveDir(dir, 'zip');
    assert.ok(fs.existsSync(`${dir}.zip`));
    fs.rmSync(`${dir}.zip`, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const fmt of ['tar', 'tar.gz', 'tgz']) {
    it(`creates a ${fmt} archive`, async function () {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
      fs.writeFileSync(path.join(dir, 'file.txt'), 'tar');
      await archiveDir(dir, fmt);
      assert.ok(fs.existsSync(`${dir}.tar.gz`));
      fs.rmSync(`${dir}.tar.gz`, { force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  it('creates a rar archive', async function () {
    if (!hasRar) this.skip();
    setRarBehavior(true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    fs.writeFileSync(path.join(dir, 'file.txt'), 'rar');
    await archiveDir(dir, 'rar');
    assert.ok(fs.existsSync(`${dir}.rar`));
    fs.rmSync(`${dir}.rar`, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws when rar command fails', async function () {
    if (!hasRar) this.skip();
    setRarBehavior(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    fs.writeFileSync(path.join(dir, 'file.txt'), 'rar');
    await assert.rejects(archiveDir(dir, 'rar'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects unsupported formats', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    await assert.rejects(archiveDir(dir, '7z'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
