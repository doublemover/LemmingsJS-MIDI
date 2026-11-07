import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OWNED_STRETCH_CORE } from '../../js/midi/content/OwnedStretchCoreIdentity.js';
import { extractPinnedStretchCore, materializePinnedStretchCore } from '../../scripts/materialize-stretch-core.mjs';
import { prepareOwnedStretchCore } from '../../js/app/resources/OwnedStretchCore.js';

const refusal = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };
describe('pinned direct stretch core material and admission (DSP qualification deferred)', () => {
  it('pins the complete compiled bytes separately from the unexecuted upstream loader', () => {
    expect(OWNED_STRETCH_CORE.wasmSha256).to.have.length(64); expect(OWNED_STRETCH_CORE.sourceSha256).not.to.equal(OWNED_STRETCH_CORE.wasmSha256); expect(OWNED_STRETCH_CORE.wasmBytes).to.equal(64494); expect(OWNED_STRETCH_CORE.wrapper).to.include('not-loaded-or-executed'); expect(OWNED_STRETCH_CORE.dependencyMeaning).to.include('source-build-reproducibility-not-established');
    expect(() => extractPinnedStretchCore(new Uint8Array(32))).to.throw('pinned byte identity'); expect(() => extractPinnedStretchCore(new Uint8Array(OWNED_STRETCH_CORE.sourceBytes))).to.throw('pinned byte identity');
  });
  it('preserves an existing mismatched output without fetching, evaluating or overwriting it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stretch-material-')); let fetched = false;
    try { const target = path.join(root, 'dist', 'assets', 'signalsmith-stretch-core.wasm'); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, 'keep this file'); expect((await refusal(() => materializePinnedStretchCore({ rootDir: root, fetchImpl: async () => { fetched = true; } }))).message).to.include('preserved'); expect(fetched).to.equal(false); expect(await fs.readFile(target, 'utf8')).to.equal('keep this file'); }
    finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('rejects output escape and bounded-source overflow without producing a partial artifact', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stretch-material-'));
    try {
      expect((await refusal(() => materializePinnedStretchCore({ rootDir: root, output: '../outside.wasm' }))).message).to.include('inside this workspace');
      const fetchImpl = async () => ({ ok: true, body: { async *[Symbol.asyncIterator]() { yield new Uint8Array(OWNED_STRETCH_CORE.sourceBytes + 1); } } }); expect((await refusal(() => materializePinnedStretchCore({ rootDir: root, fetchImpl }))).message).to.include('bounded size'); expect(await fs.stat(path.join(root, 'dist')).then(() => true, () => false)).to.equal(false);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('refuses missing workspace, foreign bytes and unsupported configuration before a core can become active', async () => {
    for (const options of [{}, { estimatedPeakBytes: 64 * 1048576, sampleRate: 32000 }, { estimatedPeakBytes: 64 * 1048576, blockFrames: 2048, intervalFrames: 100 }]) expect(await refusal(() => prepareOwnedStretchCore(new Uint8Array(OWNED_STRETCH_CORE.wasmBytes), options))).to.be.instanceOf(Error);
    expect(await refusal(() => prepareOwnedStretchCore(new Uint8Array(OWNED_STRETCH_CORE.wasmBytes), { estimatedPeakBytes: 64 * 1048576 }))).to.be.instanceOf(Error);
  });
});
