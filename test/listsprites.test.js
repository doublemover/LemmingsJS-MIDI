import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

function patchScript() {
  const origPath = new URL('../tools/listSprites.js', import.meta.url);
  const code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
  const patched = code
    .replace('import { Lemmings } from \'../js/LemmingsNamespace.js\';', 'const { Lemmings } = globalThis;')
    .replace('import \'../js/LemmingsBootstrap.js\';', '')
    .replace(
      'import { NodeFileProvider } from \'./NodeFileProvider.js\';',
      'import { NodeFileProvider as RealNodeFileProvider } from \'./NodeFileProvider.js\';\nconst NodeFileProvider = globalThis.MockNodeFileProvider || RealNodeFileProvider;'
    );
  const dir = path.dirname(fileURLToPath(origPath));
  const temp = path.join(dir, 'listSprites.test-run.js');
  fs.writeFileSync(temp, patched);
  return temp;
}

function run(code) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
  });
}

describe('tools/listSprites.js stubs', function () {
  it('writes file and prints listing', function () {
    const script = patchScript();
    const outFile = path.join(os.tmpdir(), 'out.txt');
    const base = `
      globalThis.fetch = async () => ({ json: async () => ({}) });
      class SpriteSet { constructor() { this.map = { 0:{frames:[{width:1,height:1},{width:1,height:1}]}, 1:{frames:[{width:2,height:2}]}}; } getAnimation(id){ return this.map[id]; } }
      class GameResources { async getLemmingsSprite(){ return new SpriteSet(); } }
      globalThis.Lemmings = { loadSteelSprites: async () => {}, ColorPalette: class {}, GameResources, SpriteTypes:{FOO:0,BAR:1} };
      class NodeFileProvider { async loadBinary(){ throw new Error('x'); } }
      globalThis.MockNodeFileProvider = NodeFileProvider;
    `;
    const codeFile = `${base}process.argv=['node','${script}','myPack','--out','${outFile}']; await import('${pathToFileURL(script).href}');`;
    const resFile = run(codeFile);
    expect(resFile.status).to.equal(0);
    const text = fs.readFileSync(outFile, 'utf8').trim();
    expect(text).to.equal('FOO 1x1 frames:2\nBAR 2x2 frames:1');
    fs.unlinkSync(outFile);

    const codeStdout = `${base}process.argv=['node','${script}','myPack']; await import('${pathToFileURL(script).href}');`;
    const resStd = run(codeStdout);
    expect(resStd.status).to.equal(0);
    expect(resStd.stdout.trim()).to.equal('FOO 1x1 frames:2\nBAR 2x2 frames:1');

    fs.unlinkSync(script);
  });
});
