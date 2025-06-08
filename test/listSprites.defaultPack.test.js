import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import '../js/LogHandler.js';

describe('tools/listSprites.js default pack', function () {
  it('uses default path when no pack argument is given', function () {
    const scriptPath = path.resolve('tools/listSprites.js');
    const code = `
      globalThis.lemmings = { game: { showDebug: false } };
      globalThis.fetch = async () => ({ json: async () => ({}) });
      process.argv = ['node', '${scriptPath}'];
      await import('${scriptPath}');
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    expect(res.stdout.trim().split(/\r?\n/)[0]).to.match(/^WALKING\b/);
  });

  it('falls back to "lemmings" when config.json is missing', function () {
    const configPath = path.resolve('config.json');
    const backupPath = `${configPath}.bak`;
    fs.renameSync(configPath, backupPath);
    try {
      const scriptPath = path.resolve('tools/listSprites.js');
      const code = `
        globalThis.lemmings = { game: { showDebug: false } };
        globalThis.fetch = async () => ({ json: async () => ({}) });
        process.argv = ['node', '${scriptPath}'];
        await import('${scriptPath}');
      `;
      const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        encoding: 'utf8'
      });
      expect(res.status).to.equal(0);
      expect(res.stdout.trim().split(/\r?\n/)[0]).to.match(/^WALKING\b/);
    } finally {
      fs.renameSync(backupPath, configPath);
    }
  });
});
