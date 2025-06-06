import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mergeSearchHistory } from '../tools/mergeSearchHistory.js';

describe('mergeSearchHistory', function () {
  it('appends missing lines from the base file', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
    const base = path.join(dir, 'base_history');
    const target = path.join(dir, '.searchHistory');
    fs.writeFileSync(base, 'a\nb\nc\n');
    fs.writeFileSync(target, 'b\nc\nd\n');

    mergeSearchHistory(base, target);

    const result = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(result).to.eql(['b', 'c', 'd', 'a']);
  });
});
