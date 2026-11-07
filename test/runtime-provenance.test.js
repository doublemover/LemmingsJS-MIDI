import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { verifyRuntimeProvenance } from '../scripts/RuntimeProvenance.js';
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

function withSharedArtifactFixture(work) {
  const target = mkdtempSync(path.join(tmpdir(), 'lemmings-artifact-provenance-'));
  try {
    mkdirSync(path.join(target, 'js')); mkdirSync(path.join(target, 'provenance'));
    for (const name of ['first', 'second', 'shared']) writeFileSync(path.join(target, 'js', name + '.js'), 'export const value = 1;\n');
    const component = (id, files) => {
      const hash = createHash('sha256'); for (const file of files) hash.update(file).update('\0').update(readFileSync(path.join(target, file))).update('\0');
      return { id, upstream: 'https://github.com/doublemover/LemmingsJS-MIDI', license: 'NOASSERTION', reproductionStatus: 'fixture-source-closure', classification: 'source', inventoryScope: 'first-party-artifact', entryPoints: [files[0]], files, fileCount: files.length, sha256: hash.digest('hex') };
    };
    const manifest = { version: 1, selectedBackends: { browserMidi: 'fixture', nativeUmp: 'fixture', audioRuntime: 'fixture', optionalAudioBank: 'none' }, workerSources: [], components: [
      component('first-worker', ['js/first.js', 'js/shared.js']), component('second-worker', ['js/second.js', 'js/shared.js'])
    ] };
    const save = () => writeFileSync(path.join(target, 'provenance/runtime-artifacts.json'), JSON.stringify(manifest));
    save(); work({ target, manifest, save, verify: () => verifyRuntimeProvenance({ rootDir: target }) });
  } finally {
    if (!path.resolve(target).startsWith(path.resolve(tmpdir()) + path.sep + 'lemmings-artifact-provenance-')) throw new Error('Unsafe artifact fixture cleanup target');
    rmSync(target, { recursive: true, force: true });
  }
}
describe('shared first-party artifact source integrity', () => {
  it('binds each complete artifact to shared bytes and rejects a changed common dependency', () => withSharedArtifactFixture(({ target, verify }) => {
    const actual = verify(); expect(actual.components).to.have.length(2); expect(actual.files.filter(file => file.path === 'js/shared.js')).to.have.length(1);
    appendFileSync(path.join(target, 'js/shared.js'), 'export const changed = true;\n'); expect(verify).to.throw('hash or inventory changed');
  }));
  it('retains the within-artifact duplicate refusal even with explicit shared scope', () => withSharedArtifactFixture(({ manifest, save, verify }) => {
    manifest.components[1].files.push('js/shared.js'); save(); expect(verify).to.throw('invalid files');
  }));
  it('does not let a vendor or unscoped component borrow the shared-source exception', () => withSharedArtifactFixture(({ manifest, save, verify }) => {
    delete manifest.components[1].inventoryScope; save(); expect(verify).to.throw('duplicate file');
    manifest.components[1].inventoryScope = 'first-party-artifact'; manifest.components[1].upstream = 'https://example.com/vendor'; save(); expect(verify).to.throw('invalid shared artifact scope');
  }));
});
