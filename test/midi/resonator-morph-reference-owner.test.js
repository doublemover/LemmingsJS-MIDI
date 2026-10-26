import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createResonatorMorphReferenceOwner } from '../../js/app/midi-ui/ResonatorMorphReferenceOwner.js';
import { createResonatorMorphMap } from '../../js/midi/content/ResonatorMorph.js';
import { prepareResonatorMorphKernelProfile, RESONATOR_MORPH_KERNEL_REVISION } from '../../js/app/midi-ui/worklet/ResonatorMorphKernel.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createOwnedResourceReservation } from '../../js/app/resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { sharedContentJobsFor } from '../../js/app/resources/SharedContentJobs.js';

const buildId = 'a'.repeat(64), identity = () => ({ activeExecution: 'bound', buildId });
const fixture = async () => { const { input } = JSON.parse(await fs.readFile(new URL('../../content/morphs/dry-bright-proof.json', import.meta.url), 'utf8')), map = await createResonatorMorphMap({ a: input.a, b: input.b, pairs: input.anchors, siteCorrespondence: input.siteCorrespondence, reviewed: true, transitionPolicy: 'paired-synthetic-held' }); return { revision: 1, a: input.a, b: input.b, map }; };
const settle = async ready => { for (let turn = 0; turn < 100; turn++) { if (ready()) return; await new Promise(resolve => setTimeout(resolve, 0)); } throw new Error('Controlled reference fixture did not settle.'); };
// These zero-PCM envelopes test leases and publication only. They are not DSP or acoustic evidence.
const makeJobs = (budget, { gate = null, wrongBuild = false, unknownRelease = false } = {}) => {
  const stats = { computes: 0, released: 0, computed: 0 }, jobs = { async compute(options) {
    stats.computes++; const workspace = createOwnedResourceReservation({ budget, owner: 'reference-contract-fixture', kind: 'controlled-worker-result', bytes: 64 * 1048576 }); let phase = 'computed';
    try {
      const input = await options.prepareInput(), profile = await prepareResonatorMorphKernelProfile(input.map, input.a, input.b, input.sampleRate), frames = input.sampleRate * 6; let pcm = new Uint8Array(frames * 8); const pcmHash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', pcm))].map(value => value.toString(16).padStart(2, '0')).join('');
      const manifest = { schema: 'lemmings-resonator-morph-control-render/v1', rendererRevision: RESONATOR_MORPH_KERNEL_REVISION, applicationBuildId: input.applicationBuildId, mapHash: input.map.hash, profileHash: profile.identity, sampleRate: input.sampleRate, frames, channels: 2, sampleFormat: 'ieee-float32-le', pcmHash, program: input.program, physicalTakeEvidence: false, acousticQualification: false, body: { profileHash: profile.identity, mapHash: input.map.hash, frame: frames - 1, modes: profile.slots.length, faults: 0 }, testEvidence: 'controlled-zero-PCM-owner-contract-fixture;not-a-rendered-body' }, bytes = encodeOwnedAudioWav(pcm, frames, input.sampleRate, manifest); pcm = null; workspace.resize(bytes.length + 65536); stats.computed++; options.releasePreparedInput?.(); if (gate) await gate;
      return { value: { bytes, manifest }, signal: new AbortController().signal, receipt: { method: 'dedicated-worker', kind: options.kind, sourceRevision: options.sourceRevision, executionIdentity: { activeExecution: 'bound', buildId: wrongBuild ? 'b'.repeat(64) : buildId } }, release() { if (phase !== 'released') { workspace.release(); phase = 'released'; stats.released++; } return unknownRelease ? false : undefined; }, retirementState: () => ({ phase }) };
    } catch (error) { workspace.release(); throw error; }
  } }; return { jobs, stats };
};
const fakeAudio = (budget, { prepareGate = null } = {}) => {
  const stats = { prepared: 0, starts: [], sourceStops: 0 }, context = { state: 'running', sampleRate: 48000 }, monitor = { mode: 'rehearsal', state: 'ready', revision: 1 };
  return { stats, context, monitor, getAudioContext: () => context, getMonitorRouteState: () => ({ ...monitor }), getState: () => ({ enabled: true }), async acquireAudition() { let closed = false; return { isCurrent: () => !closed, markReady() {}, markPlaying() {}, close() { closed = true; } }; }, createSession() {
    const cues = [], scope = createProcgenRetirementScope(); return { enable: async () => true, async preparePcmCue(options) { const storage = createOwnedResourceReservation({ budget, owner: 'controlled-cue', kind: 'decoded-source-double', bytes: options.manifest.frames * 8 }); stats.prepared++; let resolve; const completion = new Promise(done => { resolve = done; }), cueScope = createProcgenRetirementScope(); const cue = { completion, play() { stats.starts.push(options.manifest.program); return { status: 'accepted', acousticReceipt: false }; }, dispose() { const receipt = cueScope.retire([{ name: 'controlled-native-cue', run: () => { storage.release(); stats.sourceStops++; } }]); receipt.completion.then(resolve); return receipt; } }; cues.push(cue);
      try { if (prepareGate) await prepareGate; options.signal.throwIfAborted(); if (!options.isCurrent()) throw new Error('Stale controlled cue source.'); return cue; } catch (error) { await cue.dispose().completion; throw error; }
    }, dispose: () => scope.retire(cues.map((cue, index) => ({ name: 'controlled-cue-' + index, run: cue.dispose }))) };
  } };
};
const setup = async options => { const budget = createResourceBudget({ limitBytes: 128 * 1048576 }), worker = makeJobs(budget, options), holder = { source: await fixture() }, audio = options?.audioFactory?.(budget) || null, owner = createResonatorMorphReferenceOwner({ getSource: () => holder.source, audio, resourceBudget: budget, jobs: worker.jobs, getExecutionIdentity: identity }); return { owner, holder, budget, worker, audio, async close() { const receipt = owner.dispose(); await receipt.completion; sharedContentJobsFor(worker.jobs).dispose(); return receipt; } }; };
describe('morph reference cache, cue and export ownership (controlled envelopes; runtime/DSP/device evidence deferred)', function() {
  this.timeout(60000);
  it('reuses exact complete inputs, bounds the cache to three and exports an independent WAV', async () => {
    const f = await setup(); try { await f.owner.prepare('endpoint-a-v1'); await f.owner.prepare('endpoint-a-v1'); expect(f.worker.stats.computes).to.equal(1); await f.owner.prepare('endpoint-b-v1'); await f.owner.prepare('held-out-and-back-v1'); expect(f.owner.state().cacheCount).to.equal(3); await f.owner.prepare('endpoint-a-v1', 44100); expect(f.owner.state().cacheCount).to.equal(3); expect(f.worker.stats.released).to.equal(1); const artifact = f.owner.prepareExport('endpoint-a-v1', 44100), loan = artifact.borrow(); expect(loan.blob.size).to.be.greaterThan(44100 * 6 * 8); loan.release(); artifact.discard(); await artifact.digest(); }
    finally { expect((await f.close()).outcome).to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('never publishes an old computed source after draft replacement', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; }), f = await setup({ gate }); try { const work = f.owner.prepare().catch(error => error); await settle(() => f.worker.stats.computed > 0); f.holder.source = null; f.owner.invalidate(); expect(await work).to.be.instanceOf(Error); expect(f.owner.state().cacheCount).to.equal(0); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); release(); await settle(() => f.worker.stats.released > 0); }
    finally { release(); await f.close(); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('holds cue preparation/storage until the stopped producer actually settles and starts no late source', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; }), f = await setup({ audioFactory: budget => fakeAudio(budget, { prepareGate: gate }) }); try { await f.owner.prepare(); const play = f.owner.play().catch(error => error); await settle(() => f.audio.stats.prepared > 0); expect(f.owner.state().playing).to.equal(false); const receipt = f.owner.stop(); await new Promise(resolve => setTimeout(resolve, 0)); expect(receipt.outcome).not.to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(8 * 1048576); release(); expect(await play).to.be.instanceOf(Error); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.audio.stats.starts).to.have.length(0); }
    finally { release(); await f.close(); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('lets the latest explicit cue request replace pending preparation without an old attack', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; }), f = await setup({ audioFactory: budget => fakeAudio(budget, { prepareGate: gate }) }); try { await f.owner.prepare('endpoint-a-v1'); await f.owner.prepare('endpoint-b-v1'); const first = f.owner.play('endpoint-a-v1').catch(error => error); await settle(() => f.audio.stats.prepared > 0); const second = f.owner.play('endpoint-b-v1'); release(); expect(await first).to.be.instanceOf(Error); expect((await second).physicalTakeEvidence).to.equal(false); expect(f.audio.stats.starts).to.deep.equal(['endpoint-b-v1']); await f.owner.stop().completion; }
    finally { release(); await f.close(); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('stops on source invalidation and reuses frozen data only after a fresh reviewed request', async () => {
    const f = await setup({ audioFactory: fakeAudio }); try { await f.owner.prepare(); await f.owner.play(); const original = f.holder.source; f.holder.source = null; f.owner.invalidate(); await f.owner.stop().completion; expect(f.owner.state().references).to.have.length(0); expect(f.audio.stats.starts).to.have.length(1); f.holder.source = { ...original, revision: 2 }; await f.owner.prepare(); expect(f.worker.stats.computes).to.equal(1); expect(f.audio.stats.starts).to.have.length(1); await f.owner.play(); expect(f.audio.stats.starts).to.have.length(2); }
    finally { await f.close(); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('rejects a foreign worker build and preserves unknown cache-retirement storage', async () => {
    const bad = await setup({ wrongBuild: true }); let error; try { await bad.owner.prepare(); } catch (value) { error = value; } expect(error?.message).to.include('identity'); expect(bad.owner.state().cacheCount).to.equal(0); await bad.close(); expect(bad.budget.diagnostics().accountedBytes).to.equal(0);
    const unknown = await setup({ unknownRelease: true }); await unknown.owner.prepare(); expect((await unknown.close()).outcome).not.to.equal('complete'); expect(unknown.owner.state().unknownRetirement).to.be.greaterThan(0); expect(unknown.budget.diagnostics().accountedBytes).to.be.greaterThan(48000 * 6 * 8);
  });
});
