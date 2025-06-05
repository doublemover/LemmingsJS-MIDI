import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import '../../js/LogHandler.js';

describe('tools/listSprites.js', function () {
  it('writes spriteList.txt with sprite names', function () {
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
    for (const f of ['MAIN.DAT', 'GROUND0O.DAT', 'VGAGR0.DAT']) {
      fs.copyFileSync(path.join('lemmings', f), path.join(packDir, f));
    }
    const outFile = path.join(packDir, 'spriteList.txt');
    const scriptPath = path.resolve('tools/listSprites.js');
    const code = `
      globalThis.lemmings = { game: { showDebug: false } };
      globalThis.fetch = async () => ({ json: async () => ({}) });
      process.argv = ['node', '${scriptPath}', '${packDir}', '--out', '${outFile}'];
      await import('${scriptPath}');
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    expect(fs.existsSync(outFile)).to.be.true;
    const lines = fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/);
    const names = lines.map(l => l.split(' ')[0]);
    const expected = [
      'WALKING', 'EXPLODING', 'JUMPING', 'DIGGING', 'CLIMBING',
      'POSTCLIMBING', 'BUILDING', 'BLOCKING', 'BASHING', 'FALLING',
      'UMBRELLA', 'SPLATTING', 'MINING', 'DROWNING', 'EXITING',
      'FRYING', 'OHNO', 'SHRUGGING'
    ];
    expect(names).to.eql(expected);
    fs.rmSync(packDir, { recursive: true, force: true });
  });
});
