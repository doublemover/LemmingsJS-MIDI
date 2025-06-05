import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { archiveDir } from '../../tools/archiveDir.js';

const rarCheck = spawnSync('rar', ['--version'], { stdio: 'ignore' });
const hasRar = !rarCheck.error;

describe('archiveDir', function () {
  it('creates a zip archive', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    fs.writeFileSync(path.join(dir, 'file.txt'), 'zip');
    await archiveDir(dir, 'zip');
    assert.ok(fs.existsSync(`${dir}.zip`));
    fs.rmSync(`${dir}.zip`, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates a tar.gz archive', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    fs.writeFileSync(path.join(dir, 'file.txt'), 'tar');
    await archiveDir(dir, 'tar');
    assert.ok(fs.existsSync(`${dir}.tar.gz`));
    fs.rmSync(`${dir}.tar.gz`, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates a rar archive', async function () {
    if (!hasRar) this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    fs.writeFileSync(path.join(dir, 'file.txt'), 'rar');
    await archiveDir(dir, 'rar');
    assert.ok(fs.existsSync(`${dir}.rar`));
    fs.rmSync(`${dir}.rar`, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects unsupported formats', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    await assert.rejects(archiveDir(dir, '7z'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
