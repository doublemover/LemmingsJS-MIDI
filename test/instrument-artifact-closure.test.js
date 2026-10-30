import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectInstrumentArtifactProfiles } from '../scripts/InstrumentArtifactClosure.js';
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
});
