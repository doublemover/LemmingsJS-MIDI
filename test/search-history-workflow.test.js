import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mergeSearchHistory } from '../tools/mergeSearchHistory.js';

describe('mergeSearchHistory', function () {
  it('merges records and sorts by time', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
    const base = path.join(dir, 'base_history');
    const target = path.join(dir, '.searchMetrics', 'searchHistory');
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
    const target = path.join(dir, '.searchMetrics', 'searchHistory');
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
});
