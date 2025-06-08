import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mergeSearchHistory } from '../tools/mergeSearchHistory.js';

describe('mergeSearchHistory', function () {
  it('appends missing lines from the base file', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
    const base = path.join(dir, 'base_history');
    const target = path.join(dir, '.searchMetrics', 'searchHistory');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(base, 'a\nb\nc\n');
    fs.writeFileSync(target, 'b\nc\nd\n');

    mergeSearchHistory(base, target);

    const result = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(result).to.eql(['b', 'c', 'd', 'a']);
  });

  it('deduplicates JSON records and preserves valid output', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
    const base = path.join(dir, 'base_history');
    const target = path.join(dir, '.searchMetrics', 'searchHistory');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const rec1 = { query: 'foo' };
    const rec2 = { query: 'bar' };
    fs.writeFileSync(
      base,
      JSON.stringify(rec1) + '\n' + JSON.stringify(rec1) + '\n' + JSON.stringify(rec2) + '\n'
    );
    fs.writeFileSync(target, JSON.stringify(rec1) + '\n');

    mergeSearchHistory(base, target);

    const lines = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(lines).to.have.length(2);
    expect(JSON.parse(lines[0])).to.eql(rec1);
    expect(JSON.parse(lines[1])).to.eql(rec2);
  });
});
