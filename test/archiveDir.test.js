import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

function patchModule() {
  const origPath = new URL('../tools/archiveDir.js', import.meta.url);
  const code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
  const patched = code.replace(
    'import { spawnSync } from \'child_process\';',
    'const spawnSync = (...args) => globalThis.spawnSync(...args);'
  );
  const tmp = path.join(path.dirname(fileURLToPath(origPath)), 'archiveDir.patched.js');
  fs.writeFileSync(tmp, patched);
  return tmp;
}

let archiveDir;
let script;

before(async function () {
  script = patchModule();
  ({ archiveDir } = await import(pathToFileURL(script).href + `?t=${Date.now()}`));
});

after(function () {
  fs.unlinkSync(script);
});

describe('archiveDir (patched)', function () {
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

  it('uses spawnSync for rar archives', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    fs.writeFileSync(path.join(dir, 'file.txt'), 'rar');
    let called = false;
    globalThis.spawnSync = () => {
      called = true;
      return { status: 0 };
    };
    await archiveDir(dir, 'rar');
    assert.ok(called);
    delete globalThis.spawnSync;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws when rar command fails', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    fs.writeFileSync(path.join(dir, 'file.txt'), 'rar');
    globalThis.spawnSync = () => ({ status: 1 });
    await assert.rejects(archiveDir(dir, 'rar'));
    delete globalThis.spawnSync;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects unsupported formats', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
    await assert.rejects(archiveDir(dir, '7z'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
