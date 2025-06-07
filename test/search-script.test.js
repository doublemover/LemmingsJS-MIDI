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

  it('supports fuzzy search and context option', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
    for (const sub of ['index-prose', 'index-code']) {
      fs.mkdirSync(path.join(dir, sub));
    }
    for (const f of ['sparse_postings.json', 'chunk_meta.json']) {
      fs.copyFileSync(path.join('index-prose', f), path.join(dir, 'index-prose', f));
      fs.copyFileSync(path.join('index-code', f), path.join(dir, 'index-code', f));
    }

    const script = path.resolve('tools/search.js');

    let res = spawnSync(process.execPath, [script, 'bitrea', '--json'], {
      cwd: dir,
      encoding: 'utf8'
    });
    const obj1 = JSON.parse(res.stdout);
    expect(obj1.code).to.have.lengthOf(0);

    res = spawnSync(process.execPath, [script, 'bitrea', '--fuzzy', '--json'], {
      cwd: dir,
      encoding: 'utf8'
    });
    const obj2 = JSON.parse(res.stdout);
    expect(obj2.code.length).to.be.greaterThan(0);
    expect(obj2.code[0]).to.have.property('score');

    res = spawnSync(process.execPath, [script, 'lemmings', '--context', '1'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.stdout).to.match(/\n\s*1\s/);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
