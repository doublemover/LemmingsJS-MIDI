import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const script = path.resolve('tools/cleanExports.js');

describe('tools/cleanExports.js', function () {
  it('removes export_ folders', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exports-'));
    fs.mkdirSync(path.join(dir, 'export_a'));
    fs.mkdirSync(path.join(dir, 'export_b'));
    fs.writeFileSync(path.join(dir, 'not_export'), '');

    const res = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
    expect(res.status).to.equal(0);
    expect(fs.existsSync(path.join(dir, 'export_a'))).to.be.false;
    expect(fs.existsSync(path.join(dir, 'export_b'))).to.be.false;
    expect(fs.existsSync(path.join(dir, 'not_export'))).to.be.true;

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
