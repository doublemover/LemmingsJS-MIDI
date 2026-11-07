import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectInstrumentArtifactProfiles } from '../scripts/InstrumentArtifactClosure.js';
import { collectRuntimeSourceClosure } from '../scripts/RuntimeSourceClosure.js';
import { computeInstrumentArtifacts, INSTRUMENT_ARTIFACT_ROOTS } from '../js/runtime/InstrumentArtifactManifest.js';

describe('renderer artifact code closure', () => {
  let root;
  const write = async (file, text) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); };
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-instrument-closure-'));
    for (const entry of Object.values(INSTRUMENT_ARTIFACT_ROOTS)) await write(entry, 'import "./shared.js"; export const renderer = 1;');
    await write('js/app/midi-ui/shared.js', 'export const shared = 1;');
  });
  afterEach(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('lemmings-instrument-closure-')) throw new Error('Unexpected artifact fixture cleanup target.');
    await fs.rm(root, { recursive: true, force: true });
  });
  const collect = async () => {
    const closure = await collectInstrumentArtifactProfiles({ rootDir: root });
    return { ...closure, artifacts: await computeInstrumentArtifacts(closure.files, closure.profiles) };
  };
  it('keeps content edits outside code identity while binding transitive renderer changes', async () => {
    const before = await collect(); await write('content/sounds/a.json', '{"label":"Renamed"}');
    expect((await collect()).artifacts).to.deep.equal(before.artifacts);
    await write('js/app/midi-ui/shared.js', 'export const shared = 2;');
    const changed = await collect();
    for (let index = 0; index < changed.artifacts.length; index++) expect(changed.artifacts[index].artifactHash).not.to.equal(before.artifacts[index].artifactHash);
    expect(await computeInstrumentArtifacts([...changed.files].reverse(), changed.profiles)).to.deep.equal(changed.artifacts);
  });
  it('rejects incomplete application inventories and missing profile sources', async () => {
    const closure = await collect(); let error;
    try { await collectInstrumentArtifactProfiles({ rootDir: root, inventory: closure.files.filter(file => !file.path.endsWith('shared.js')) }); } catch (failure) { error = failure; }
    expect(error.message).to.include('differs from its application inventory');
    try { await computeInstrumentArtifacts(closure.files.slice(1), closure.profiles); } catch (failure) { error = failure; }
    expect(error.message).to.include('missing or duplicate source');
  });
  it('rejects computed source imports instead of declaring a partial renderer artifact', async () => {
    await write(INSTRUMENT_ARTIFACT_ROOTS['native-oscillator'], 'const source = "./shared.js"; import(source);'); let error;
    try { await collect(); } catch (failure) { error = failure; }
    expect(error.message).to.include('Computed runtime module import');
  });
  it('reads shared cyclic code once while preserving independent per-renderer reachability', async () => {
    await write('js/app/midi-ui/shared.js', 'import "./cycle.js"; export const shared = 1;');
    await write('js/app/midi-ui/cycle.js', 'import "./shared.js"; export const cycle = 1;');
    const entries = Object.entries(INSTRUMENT_ARTIFACT_ROOTS).sort(([a], [b]) => a < b ? -1 : 1), [isolatedId, isolatedEntry] = entries[0], reads = new Map();
    await write(isolatedEntry, 'import "./isolated.js"; export const renderer = 2;'); await write('js/app/midi-ui/isolated.js', 'export const isolated = 1;');
    const actual = await collectInstrumentArtifactProfiles({ rootDir: root, fsImpl: { ...fs, readFile: async (filename, ...args) => { reads.set(filename, (reads.get(filename) || 0) + 1); return fs.readFile(filename, ...args); } } });
    expect(reads.get(path.join(root, 'js/app/midi-ui/shared.js'))).to.equal(1); expect(reads.get(path.join(root, 'js/app/midi-ui/cycle.js'))).to.equal(1);
    expect([...reads.values()].every(count => count === 1)).to.equal(true);
    const expectedProfiles = [], expectedSources = new Map();
    // Separate serial root traversals retain the previous collector's reference.
    for (const [engineId, entry] of entries) {
      const closure = await collectRuntimeSourceClosure({ rootDir: root, entries: [entry] });
      expectedProfiles.push({ engineId, engineVersion: 1, entry, files: closure.files.map(file => file.path) });
      for (const file of closure.files) expectedSources.set(file.path, file);
    }
    expect(actual.profiles).to.deep.equal(expectedProfiles); expect(actual.files).to.deep.equal([...expectedSources.values()].sort((a, b) => a.path < b.path ? -1 : 1));
    expect(actual.profiles.find(profile => profile.engineId === isolatedId).files).not.to.include('js/app/midi-ui/shared.js');
  });
  it('reports a package dependency against its owning renderer without adding unrelated roots to the profile', async () => {
    const [engineId, entry] = Object.entries(INSTRUMENT_ARTIFACT_ROOTS).sort(([a], [b]) => a < b ? -1 : 1)[0];
    await write(entry, 'import "unreviewed-package";'); let error;
    try { await collect(); } catch (failure) { error = failure; }
    expect(error?.message).to.equal('Instrument artifact has unresolved package dependencies: ' + engineId);
  });
  it('returns an empty admitted profile set without probing unselected renderer sources', async () => {
    const actual = await collectInstrumentArtifactProfiles({ rootDir: root, inventory: [], fsImpl: { readFile() { throw new Error('Unselected source read'); } } });
    expect(actual).to.deep.equal({ profiles: [], files: [] });
  });
  it('exposes literal/resource edges only on request and retains explicit byte limits', async () => {
    const entry = INSTRUMENT_ARTIFACT_ROOTS['native-oscillator']; await write('js/app/midi-ui/shared.js', 'export const data = new URL("./data.json", import.meta.url);'); await write('js/app/midi-ui/data.json', '{}');
    const plain = await collectRuntimeSourceClosure({ rootDir: root, entries: [entry] }); expect(plain).not.to.have.property('graph');
    const graph = await collectRuntimeSourceClosure({ rootDir: root, entries: [entry], includeGraph: true });
    expect(graph.graph.find(row => row.path === entry).imports).to.deep.equal(['js/app/midi-ui/shared.js']);
    expect(graph.graph.find(row => row.path === 'js/app/midi-ui/shared.js').imports).to.deep.equal(['js/app/midi-ui/data.json']);
    expect(graph.graph.find(row => row.path === 'js/app/midi-ui/data.json')).to.deep.equal({ path: 'js/app/midi-ui/data.json', imports: [], dependencies: [] });
    for (const limits of [{ includeGraph: 1 }, { maxFileBytes: 0 }, { maxBytes: 8, maxFileBytes: 16 }, { maxFileBytes: 8 }]) {
      let error; try { await collectRuntimeSourceClosure({ rootDir: root, entries: [entry], ...limits }); } catch (failure) { error = failure; }
      expect(error).to.be.instanceOf(Error);
    }
  });
});
