import { expect } from 'chai';
import { cpSync, mkdirSync, mkdtempSync, rmSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(repository, 'scripts/check-runtime-provenance.mjs');
const copy = (target, item) => {
  const destination = path.join(target, item);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(repository, item), destination, { recursive: true });
};
const withFixture = work => {
  const target = mkdtempSync(path.join(tmpdir(), 'lemmings-provenance-'));
  try {
    const manifest = JSON.parse(readFileSync(path.join(repository, 'provenance/runtime-artifacts.json'), 'utf8'));
    const inputs = new Set(['provenance/runtime-artifacts.json', 'package.json', ...manifest.workerSources]);
    for (const component of manifest.components) for (const file of component.directory ? [component.directory] : component.files) inputs.add(file);
    for (const item of inputs) copy(target, item);
    const run = () => spawnSync(process.execPath, [checker, `--root=${target}`], { encoding: 'utf8' });
    work({ target, run });
  } finally {
    const parent = path.resolve(tmpdir()) + path.sep;
    if (!path.resolve(target).startsWith(parent + 'lemmings-provenance-')) throw new Error('Unsafe provenance fixture cleanup target');
    rmSync(target, { recursive: true, force: true });
  }
};

describe('runtime provenance gate', function() {
  this.timeout(30000);
  it('accepts the reviewed inventory and fails a modified vendored byte', () => withFixture(({ target, run }) => {
    expect(run().status).to.equal(0);
    appendFileSync(path.join(target, 'js/vendor/jquery.js'), '\n');
    expect(run().status).not.to.equal(0);
  }));

  it('fails when a new worker source is absent from the inventory', () => withFixture(({ target, run }) => {
    writeFileSync(path.join(target, 'js/app/new-worker.js'), 'new Worker("worker.js");\n');
    expect(run().status).not.to.equal(0);
  }));

  it('fails when a license notice is missing', () => withFixture(({ target, run }) => {
    rmSync(path.join(target, 'js/vendor/hqx/LICENSE'));
    expect(run().status).not.to.equal(0);
  }));
});
