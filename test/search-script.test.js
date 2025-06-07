import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import '../js/LogHandler.js';

describe('tools/search.js', function () {
  it('writes search history under .searchMetrics', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
    for (const sub of ['index-prose', 'index-code']) {
      fs.mkdirSync(path.join(dir, sub));
    }
    for (const f of ['sparse_postings.json', 'chunk_meta.json']) {
      fs.copyFileSync(path.join('index-prose', f), path.join(dir, 'index-prose', f));
      fs.copyFileSync(path.join('index-code', f), path.join(dir, 'index-code', f));
    }

    const script = path.resolve('tools/search.js');
    const res = spawnSync(process.execPath, [script, 'lemmings'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);

    const hist = path.join(dir, '.searchMetrics', 'searchHistory');
    expect(fs.existsSync(hist)).to.be.true;
    const lines = fs.readFileSync(hist, 'utf8').trim().split(/\n/);
    expect(lines).to.have.lengthOf(1);
    const record = JSON.parse(lines[0]);
    expect(record.query).to.equal('lemmings');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('omits function label when match is outside any function', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
    for (const sub of ['index-prose', 'index-code']) {
      fs.mkdirSync(path.join(dir, sub));
    }
    for (const f of ['sparse_postings.json', 'chunk_meta.json']) {
      fs.copyFileSync(path.join('index-prose', f), path.join(dir, 'index-prose', f));
      fs.copyFileSync(path.join('index-code', f), path.join(dir, 'index-code', f));
    }

    const script = path.resolve('tools/search.js');
    const modes = [
      [],
      ['--human'],
      ['--human', '--human-json'],
      ['--json'],
    ];
    for (const flags of modes) {
      const res = spawnSync(process.execPath, [script, 'AGENTS guidelines', ...flags], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(res.status).to.equal(0);
      expect(res.stdout.includes('(func:')).to.be.false;
    }
    
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
