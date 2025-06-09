import { spawnSync } from 'child_process';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('merge-metrics.sh', function () {
  it('exits cleanly when the base file is invalid', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'met-'));
    const base = path.join(dir, 'base.json');
    const ours = path.join(dir, '.repoMetrics', 'metrics.json');
    const theirs = path.join(dir, 'theirs.json');
    fs.mkdirSync(path.dirname(ours), { recursive: true });
    fs.writeFileSync(ours, '{"a":{"md":1,"code":1}}');
    fs.writeFileSync(base, '{');
    const script = path.resolve('tools/merge-metrics.sh');
    const res = spawnSync('bash', [script, base, ours, theirs], { encoding: 'utf8' });
    expect(res.status).to.equal(0);
  });

  it('exits cleanly when theirs is invalid JSON', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'met-'));
    const base = path.join(dir, 'base.json');
    const ours = path.join(dir, '.repoMetrics', 'metrics.json');
    const theirs = path.join(dir, 'theirs.json');
    fs.mkdirSync(path.dirname(ours), { recursive: true });
    fs.writeFileSync(ours, '{"a":{"md":1,"code":1}}');
    fs.writeFileSync(base, '{}');
    fs.writeFileSync(theirs, '{');
    const script = path.resolve('tools/merge-metrics.sh');
    const res = spawnSync('bash', [script, base, ours, theirs], { encoding: 'utf8' });
    expect(res.status).to.equal(0);
  });

  it('removes empty objects from the merged output', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'met-'));
    const base = path.join(dir, 'base.json');
    const ours = path.join(dir, '.repoMetrics', 'metrics.json');
    const theirs = path.join(dir, 'theirs.json');
    fs.mkdirSync(path.dirname(ours), { recursive: true });
    fs.writeFileSync(base, '{"a":{}}');
    fs.writeFileSync(ours, '{"a":{}}');
    fs.writeFileSync(theirs, '{"a":{}}');
    const script = path.resolve('tools/merge-metrics.sh');
    const res = spawnSync('bash', [script, base, ours, theirs], { encoding: 'utf8' });
    expect(res.status).to.equal(0);
    const out = fs.readFileSync(ours, 'utf8').trim();
    expect(out).to.equal('{}');
  });
});
