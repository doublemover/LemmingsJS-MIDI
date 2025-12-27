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
});
