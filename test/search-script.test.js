import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import '../js/LogHandler.js';

describe('tools/search.js', function () {
  it('writes search history under .repoMetrics', function () {
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

    const hist = path.join(dir, '.repoMetrics', 'searchHistory');
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

  it('--human output shows section headers', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
    for (const sub of ['index-prose', 'index-code']) {
      fs.mkdirSync(path.join(dir, sub));
    }
    for (const f of ['sparse_postings.json', 'chunk_meta.json']) {
      fs.copyFileSync(path.join('index-prose', f), path.join(dir, 'index-prose', f));
      fs.copyFileSync(path.join('index-code', f), path.join(dir, 'index-code', f));
    }

    const script = path.resolve('tools/search.js');
    const res = spawnSync(process.execPath, [script, 'lemmings', '--human'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    expect(res.stdout).to.include('--- Markdown Results ---');

    const metrics = path.join(dir, '.repoMetrics', 'metrics.json');
    const history = path.join(dir, '.repoMetrics', 'searchHistory');
    expect(fs.existsSync(metrics)).to.be.true;
    expect(fs.existsSync(history)).to.be.true;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('--human-json output has friendly structure', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
    for (const sub of ['index-prose', 'index-code']) {
      fs.mkdirSync(path.join(dir, sub));
    }
    for (const f of ['sparse_postings.json', 'chunk_meta.json']) {
      fs.copyFileSync(path.join('index-prose', f), path.join(dir, 'index-prose', f));
      fs.copyFileSync(path.join('index-code', f), path.join(dir, 'index-code', f));
    }

    const script = path.resolve('tools/search.js');
    const res = spawnSync(process.execPath, [script, 'lemmings', '--human', '--human-json'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    const out = JSON.parse(res.stdout);
    expect(out).to.have.keys(['markdown', 'more_md', 'code', 'more_code']);
    if (out.markdown.length) {
      expect(out.markdown[0]).to.have.all.keys('file', 'path', 'hits', 'lines', 'function');
    }

    const metrics = path.join(dir, '.repoMetrics', 'metrics.json');
    expect(fs.existsSync(metrics)).to.be.true;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('--stats prints summary numbers', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
    for (const sub of ['index-prose', 'index-code']) {
      fs.mkdirSync(path.join(dir, sub));
    }
    for (const f of ['sparse_postings.json', 'chunk_meta.json']) {
      fs.copyFileSync(path.join('index-prose', f), path.join(dir, 'index-prose', f));
      fs.copyFileSync(path.join('index-code', f), path.join(dir, 'index-code', f));
    }

    const script = path.resolve('tools/search.js');
    const res = spawnSync(process.execPath, [script, 'lemmings', '--stats'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    expect(res.stdout).to.include('--stats--');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('errors when indexes are missing', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
    const script = path.resolve('tools/search.js');
    const res = spawnSync(process.execPath, [script, 'lemmings'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.not.equal(0);
    expect(res.stderr).to.include('Missing index files');
    expect(fs.existsSync(path.join(dir, '.repoMetrics'))).to.be.false;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records queries with no results', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
    for (const sub of ['index-prose', 'index-code']) {
      fs.mkdirSync(path.join(dir, sub));
      for (const f of ['sparse_postings.json', 'chunk_meta.json']) {
        fs.writeFileSync(path.join(dir, sub, f), '[]');
      }
    }
    const script = path.resolve('tools/search.js');
    const res = spawnSync(process.execPath, [script, 'zzzz', '--json'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    const noRes = path.join(dir, '.repoMetrics', 'noResultQueries');
    expect(fs.existsSync(noRes)).to.be.true;
    const lines = fs.readFileSync(noRes, 'utf8').trim().split(/\n/);
    expect(lines).to.have.lengthOf(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.query).to.equal('zzzz');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails when no query is provided', function () {
    const script = path.resolve('tools/search.js');
    const res = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(res.status).to.equal(1);
    expect(res.stderr).to.match(/usage: search/);
  });
});
