import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mergeNoResultQueries } from '../tools/mergeNoResultQueries.js';

describe('mergeNoResultQueries', function () {
  it('appends missing lines from the base file', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nores-'));
    const base = path.join(dir, 'base_no_results');
    const target = path.join(dir, '.searchMetrics', 'noResultQueries');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(base, 'a\nb\nc\n');
    fs.writeFileSync(target, 'b\nc\nd\n');

    mergeNoResultQueries(base, target);

    const result = fs.readFileSync(target, 'utf8').trim().split(/\n/);
    expect(result).to.eql(['b', 'c', 'd', 'a']);
  });
});
