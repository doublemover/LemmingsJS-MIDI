import { spawnSync } from 'child_process';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mergeSearchHistory } from '../tools/mergeSearchHistory.js';

describe('mergeSearchHistory', function () {
  it('merges records and sorts by time', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
    const base = path.join(dir, 'base_history');
    const target = path.join(dir, '.repoMetrics', 'searchHistory');
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const rec1 = { time: '2020-01-03T00:00:00Z', query: 'A' };
    const rec2 = { time: '2020-01-01T00:00:00Z', query: 'B' };
    const rec3 = { time: '2020-01-02T00:00:00Z', query: 'C' };
    fs.writeFileSync(base, JSON.stringify(rec1) + '\n' + JSON.stringify(rec2) + '\n');
    fs.writeFileSync(target, JSON.stringify(rec3) + '\n');

    mergeSearchHistory(base, target);

    const lines = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    const times = lines.map(l => JSON.parse(l).time);
    expect(times).to.eql([rec2.time, rec3.time, rec1.time]);
  });

  it('splits concatenated records and deduplicates', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
    const base = path.join(dir, 'base_history');
    const target = path.join(dir, '.repoMetrics', 'searchHistory');
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const rec1 = { time: '2020-01-01T00:00:00Z', query: 'foo' };
    const rec2 = { time: '2020-01-02T00:00:00Z', query: 'bar' };
    fs.writeFileSync(base, JSON.stringify(rec1) + JSON.stringify(rec2) + '\n');
    fs.writeFileSync(target, JSON.stringify(rec1) + '\n');

    mergeSearchHistory(base, target);

    const lines = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(lines).to.have.length(2);
    const parsed = lines.map(l => JSON.parse(l));
    expect(parsed[0].query).to.equal('foo');
    expect(parsed[1].query).to.equal('bar');
  });

  it('does nothing when the base history file is missing', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
    const base = path.join(dir, 'base_history');
    const target = path.join(dir, '.repoMetrics', 'searchHistory');
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const rec1 = { time: '2020-01-01T00:00:00Z', query: 'foo' };
    fs.writeFileSync(target, JSON.stringify(rec1) + '\n');

    mergeSearchHistory(base, target);

    const lines = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(lines).to.have.length(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.query).to.equal('foo');
  });

  it('ignores malformed lines in the base file', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
    const base = path.join(dir, 'base_history');
    const target = path.join(dir, '.repoMetrics', 'searchHistory');
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const rec1 = { time: '2020-01-01T00:00:00Z', query: 'foo' };
    const rec2 = { time: '2020-01-02T00:00:00Z', query: 'bar' };
    fs.writeFileSync(base, 'invalid\n' + JSON.stringify(rec2) + '\n');
    fs.writeFileSync(target, JSON.stringify(rec1) + '\n');

    mergeSearchHistory(base, target);

    const lines = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(lines).to.have.length(2);
    const parsed = lines.map(l => JSON.parse(l));
    expect(parsed[0].query).to.equal('foo');
    expect(parsed[1].query).to.equal('bar');
  });

  it('works via merge-history.sh', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
    const base = path.join(dir, 'base_history');
    const ours = path.join(dir, '.repoMetrics', 'searchHistory');
    const theirs = path.join(dir, 'theirs_history');
    fs.mkdirSync(path.dirname(ours), { recursive: true });
    fs.writeFileSync(base, '');
    const rec1 = { time: '2020-01-01T00:00:00Z', query: 'foo' };
    fs.writeFileSync(ours, JSON.stringify(rec1) + '\n');
    const rec2 = { time: '2020-01-02T00:00:00Z', query: 'bar' };
    fs.writeFileSync(theirs, JSON.stringify(rec2) + '\n');
    const script = path.resolve('tools/merge-history.sh');
    const res = spawnSync('bash', [script, base, ours, theirs], { encoding: 'utf8' });
    expect(res.status).to.equal(0);
    const lines = fs.readFileSync(ours, 'utf8').trim().split(/\n/);
    const queries = lines.map(l => JSON.parse(l).query);
    expect(queries).to.eql(['foo', 'bar']);
  });

  it('deduplicates via the CLI with explicit files', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhjs-'));
    const base = path.join(dir, 'base.jsonl');
    const dest = path.join(dir, '.repoMetrics', 'hist.jsonl');
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const rec1 = { time: '2020-01-01T00:00:00Z', query: 'foo' };
    const rec2 = { time: '2020-01-02T00:00:00Z', query: 'bar' };
    fs.writeFileSync(base, JSON.stringify(rec1) + JSON.stringify(rec2) + '\n');
    fs.writeFileSync(dest, JSON.stringify(rec1) + '\n');

    const script = path.resolve('tools/mergeSearchHistory.js');
    const res = spawnSync(process.execPath, [script, base, dest], { encoding: 'utf8' });
    expect(res.status).to.equal(0);

    const lines = fs.readFileSync(dest, 'utf8').trim().split(/\n/);
    expect(lines).to.have.length(2);
    const parsed = lines.map(l => JSON.parse(l));
    expect(parsed[0].query).to.equal('foo');
    expect(parsed[1].query).to.equal('bar');
  });

  it('deduplicates via the CLI using default files', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhjs-'));
    const base = path.join(dir, 'base_history');
    const dest = path.join(dir, '.repoMetrics', 'searchHistory');
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const rec1 = { time: '2020-01-01T00:00:00Z', query: 'foo' };
    const rec2 = { time: '2020-01-02T00:00:00Z', query: 'bar' };
    fs.writeFileSync(base, JSON.stringify(rec1) + JSON.stringify(rec2) + '\n');
    fs.writeFileSync(dest, JSON.stringify(rec1) + '\n');

    const script = path.resolve('tools/mergeSearchHistory.js');
    const res = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    expect(res.status).to.equal(0);

    const lines = fs.readFileSync(dest, 'utf8').trim().split(/\n/);
    expect(lines).to.have.length(2);
    const parsed = lines.map(l => JSON.parse(l));
    expect(parsed[0].query).to.equal('foo');
    expect(parsed[1].query).to.equal('bar');
  });
});
