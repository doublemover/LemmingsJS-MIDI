import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const cfgPath = fileURLToPath(new URL('../../config.json', import.meta.url));

function patchScript(tmpDir) {
  const origPath = new URL('../../tools/exportAllPacks.js', import.meta.url);
  const code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
  const patched = code.replace('import { spawnSync } from \'child_process\';', 'const spawnSync = globalThis.spawnSync;');
  const tempScript = path.join(tmpDir, 'exportAllPacks.test-run.js');
  fs.writeFileSync(tempScript, patched);
  // ensure config.json is resolved correctly by the temporary script
  const cfgCopy = path.join(path.dirname(tmpDir), '..', 'config.json');
  fs.copyFileSync(cfgPath, cfgCopy);
  return tempScript;
}

describe('tools/exportAllPacks.js', function () {
  it('calls exportAllSprites.js for each configured pack', async function () {
    this.skip();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'));
    const script = patchScript(tempDir);
    const calls = [];
    globalThis.spawnSync = (...args) => { calls.push(args); return { status: 0 }; };
    const origCwd = process.cwd();
    const origArgv = process.argv;
    process.chdir(tempDir);
    process.argv = ['node', script];
    await import(pathToFileURL(script).href + `?t=${Date.now()}`);
    process.argv = origArgv;
    process.chdir(origCwd);
    delete globalThis.spawnSync;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(tempDir), '..', 'config.json'), { force: true });
    const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    expect(calls.length).to.equal(config.length);
    calls.forEach((args, idx) => {
      const pack = config[idx];
      const outDir = path.join('exports', `export_${pack.name.replace(/\\W+/g, '_')}`);
      expect(args[0]).to.equal('node');
      expect(args[1]).to.eql(['tools/exportAllSprites.js', pack.path, outDir]);
      expect(args[2]).to.eql({ stdio: 'inherit' });
    });
  });
});
