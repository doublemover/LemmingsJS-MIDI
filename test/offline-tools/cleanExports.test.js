import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = path.join(rootDir, 'tools', 'cleanExports.js');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lemmings-clean-'));
const withTempDir = (fn) => {
  const dir = makeTempDir();
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('cleanExports', function () {
  it('removes export_* directories', function () {
    withTempDir((dir) => {
      const target = path.join(dir, 'export_temp');
      const keep = path.join(dir, 'exports');
      fs.mkdirSync(target, { recursive: true });
      fs.mkdirSync(keep, { recursive: true });

      const res = spawnSync(process.execPath, [scriptPath], { cwd: dir });
      expect(res.status).to.equal(0);
      expect(fs.existsSync(target)).to.equal(false);
      expect(fs.existsSync(keep)).to.equal(true);
    });
  });
});
