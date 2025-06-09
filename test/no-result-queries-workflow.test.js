import { spawnSync } from 'child_process';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mergeNoResultQueries } from '../tools/mergeNoResultQueries.js';

describe('mergeNoResultQueries', function () {
  it('appends missing lines from the base file', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nores-'));
    const base = path.join(dir, 'base_no_results');
    const target = path.join(dir, '.repoMetrics', 'noResultQueries');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(base, 'a\nb\nc\n');
    fs.writeFileSync(target, 'b\nc\nd\n');

    mergeNoResultQueries(base, target);

    const result = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(result).to.eql(['b', 'c', 'd', 'a']);
  });

  it('creates the target file when it does not exist', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nores-'));
    const base = path.join(dir, 'base_no_results');
    const target = path.join(dir, '.repoMetrics', 'noResultQueries');
    fs.writeFileSync(base, 'a\nb\n');

    mergeNoResultQueries(base, target);

    expect(fs.existsSync(target)).to.be.true;
    const result = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(result).to.eql(['a', 'b']);
  });

  it('ignores missing base file', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nores-'));
    const base = path.join(dir, 'base_no_results');
    const target = path.join(dir, '.repoMetrics', 'noResultQueries');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x\ny\n');

    mergeNoResultQueries(base, target);

    const result = fs.readFileSync(target, 'utf8');
    expect(result).to.equal('x\ny\n');
  });

  it('filters out empty array and object lines', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nores-'));
    const base = path.join(dir, 'base_no_results');
    const target = path.join(dir, '.repoMetrics', 'noResultQueries');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(base, '[]\n{}\nfoo\n');
    fs.writeFileSync(target, '');

    mergeNoResultQueries(base, target);

    const lines = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(lines).to.eql(['foo']);
  });

  it('works via merge-no-results.sh', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nores-'));
    const base = path.join(dir, 'base_no_results');
    const ours = path.join(dir, '.repoMetrics', 'noResultQueries');
    const theirs = path.join(dir, 'theirs_no_results');
    fs.mkdirSync(path.dirname(ours), { recursive: true });
    fs.writeFileSync(base, '');
    fs.writeFileSync(ours, 'x\n');
    fs.writeFileSync(theirs, 'y\n');

    const script = path.resolve('tools/merge-no-results.sh');
    const res = spawnSync('bash', [script, base, ours, theirs], { encoding: 'utf8' });
    expect(res.status).to.equal(0);

    const result = fs.readFileSync(ours, 'utf8').trim().split(/\n/);
    expect(result).to.eql(['x', 'y']);
  });

  it('creates the target file when ours is missing via merge-no-results.sh', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nores-'));
    const base = path.join(dir, 'base_no_results');
    const ours = path.join(dir, '.repoMetrics', 'noResultQueries');
    const theirs = path.join(dir, 'theirs_no_results');
    fs.writeFileSync(theirs, 'a\n');
    const script = path.resolve('tools/merge-no-results.sh');
    const res = spawnSync('bash', [script, base, ours, theirs], { encoding: 'utf8' });
    expect(res.status).to.equal(0);
    const lines = fs.readFileSync(ours, 'utf8').trim().split(/\n/);
    expect(lines).to.eql(['a']);
  });

  it('leaves ours unchanged when theirs file is missing via merge-no-results.sh', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nores-'));
    const base = path.join(dir, 'base_no_results');
    const ours = path.join(dir, '.repoMetrics', 'noResultQueries');
    fs.mkdirSync(path.dirname(ours), { recursive: true });
    fs.writeFileSync(ours, 'a\n');
    const script = path.resolve('tools/merge-no-results.sh');
    const res = spawnSync('bash', [script, base, ours, path.join(dir, 'missing')], { encoding: 'utf8' });
    expect(res.status).to.equal(0);
    const lines = fs.readFileSync(ours, 'utf8').trim().split(/\n/);
    expect(lines).to.eql(['a']);
  });
});
