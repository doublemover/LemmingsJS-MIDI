import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import '../js/LogHandler.js';

describe('tools/listSprites.js stdout', function () {
  it('prints sprite listing when no output file is given', function () {
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
    for (const f of ['MAIN.DAT', 'GROUND0O.DAT', 'VGAGR0.DAT']) {
      fs.copyFileSync(path.join('lemmings', f), path.join(packDir, f));
    }
    const scriptPath = path.resolve('tools/listSprites.js');
    const code = `
      globalThis.lemmings = { game: { showDebug: false } };
      globalThis.fetch = async () => ({ json: async () => ({}) });
      process.argv = ['node', '${scriptPath}', '${packDir}'];
      await import('${scriptPath}');
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    expect(res.stdout.trim().split(/\r?\n/)[0]).to.match(/^WALKING\b/);
    fs.rmSync(packDir, { recursive: true, force: true });
  });
});
