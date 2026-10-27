import { createQuarryBody } from '../../js/midi/content/DubQuarryRack.js';
import { expect } from 'chai';
import fs from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { planCausalOwnedRender, renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { CAUSAL_RENDER_SOURCES } from '../../js/app/midi-ui/CausalTakeAudioRender.js';
import { renderOwnedSourceControls } from '../../js/app/midi-ui/OwnedSourceControlRender.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { hashData } from '../../js/core/CanonicalData.js';

const cause = (id, displacement, height) => ({ sourceKind: 'MotionCommitted', eventId: id, evidence: 'completed-world-fact', values: {
  displacementPixels: { value: displacement, unit: 'world-pixel' }, positionYWorldPixels: { value: height, unit: 'world-pixel' }
} });
const intent = (kind, time, serial, extras = {}) => ({ version: 1, kind, worldId: 'world:owned-render', generation: 1, voiceId: 'actor-one', onsetId: 'onset-one', actorId: 1,
  intentId: 'intent:' + serial, sourceEventIds: ['cause:' + serial], laneId: 0, pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.6, expression: {},
  scoreTime: { sourceTimeMs: time, subTick: 0, simTick: serial }, ...extras });
const revoice = () => ({ operation: 'sound-only-revoice', version: 1, takeId: 'take:owned', takeRevision: 1, sourceCanonicalHash: 'b'.repeat(64), sourceState: 'finalized', nextSequence: null,
  sourceVersions: { physical: 1, intent: 1 }, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { sourceTimeMs: 0, voices: [] } }, finalBoundaryState: { sourceTimeMs: 1000 },
  intents: [intent('begin', 100, 1, { performanceCause: cause('cause:1', 1, 10) }), intent('update', 300, 2, { performanceCause: cause('cause:2', 6, 256) }), intent('end', 600, 3)] });
const pcm = file => {
  const bytes = file.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let at = 12; at < bytes.length;) { const id = new TextDecoder().decode(bytes.subarray(at, at + 4)), length = view.getUint32(at + 4, true);
    if (id === 'data') return bytes.subarray(at + 8, at + 8 + length); at += 8 + length + length % 2; }
};
// Authored for the final runtime pass, with source ownership tested separately.
describe('owned-source causal revoice rendering', function() {
  this.timeout(30000);
  it('retains onset lanes under inventory reorder and moves donors only on an explicit carried transfer', async () => {
    const definition = structuredClone(CAUSAL_RENDER_SOURCES.find(source => source.id === 'worklet-sine').definition);
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const take = revoice(); take.intents = [intent('begin', 100, 1), intent('update', 200, 2), intent('update', 300, 3, { articulationState: { transfer: true } }), intent('end', 600, 4)];
    take.laneRouting = { schema: 'lemmings-captured-lane-routing/v1', covered: true, initial: [{ id: 'a', sourceIndex: 0 }, { id: 'b', sourceIndex: 1 }],
      changes: [{ beforeIntent: 1, upserts: [{ id: 'a', sourceIndex: 1 }, { id: 'b', sourceIndex: 0 }], removed: [] }] };
    const input = { definition, descriptor, revoice: take, sampleRate: 48000, startSeconds: 0.303, endSeconds: 0.7, stemLaneIds: ['a', 'b'] };
    const plan = await planCausalOwnedRender(input);
    expect(plan.derivedLaneTransfers).to.equal(1); expect([...plan.voices.values()][0].laneId).to.equal('a');
    expect(plan.events.filter(event => event.kind === 'lane').map(event => [event.frame, event.laneId])).to.deep.equal([[14400, 'b']]);
    const rendered = await renderCausalOwnedTake(input, { yieldControl: async () => {} });
    const restored = await renderCausalOwnedTake({ ...input, restorationMode: 'owned-state-cut' }, { yieldControl: async () => {} });
    expect(restored.files.map(file => file.manifest.pcmHash)).to.deep.equal(rendered.files.map(file => file.manifest.pcmHash));
    expect(rendered.manifest.commands).to.include({ capturedBegins: 1, capturedUpdates: 2, capturedEnds: 1, derivedLaneTransfers: 1 });
    const data = rendered.files.map(file => pcm(file)).map(bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    let lateB = false;
    for (let frame = 0; frame < rendered.manifest.frames; frame++) for (let channel = 0; channel < 2; channel++) {
      const at = (frame * 2 + channel) * 4, dry = data[0].getFloat32(at, true), a = data[1].getFloat32(at, true), b = data[2].getFloat32(at, true);
      expect(a + b).to.be.closeTo(dry, 1e-7); if (frame >= 512) { expect(a).to.equal(0); if (b !== 0) lateB = true; }
    }
    expect(lateB).to.equal(true);
    const overlap = structuredClone(take); overlap.intents.splice(3, 0, intent('update', 301, 5, { laneId: 1, articulationState: { transfer: true } }));
    let error; try { await planCausalOwnedRender({ ...input, revoice: overlap }); } catch (value) { error = value; }
    expect(error?.code).to.equal('lane-transfer-capacity');
  });

  it('exports complete dry PCM history for native bodies with the same source samples as a normal crop', async () => {
    for (const engineId of ['worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum']) for (const sampleRate of [44100, 48000, 96000]) {
      const definition = structuredClone(CAUSAL_RENDER_SOURCES.find(source => source.id === engineId).definition); definition.voicePolicy.maxVoices = 2;
      const [descriptor] = await describeNativeInstrumentEngines([{ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
      const input = { definition, descriptor, revoice: revoice(), sampleRate, startSeconds: 0.303, endSeconds: 0.7, stemLaneIds: ['0'] };
      const dry = await renderCausalOwnedTake(input, { yieldControl: async () => {} });
      const raw = await renderCausalOwnedTake({ ...input, outputMode: 'source-pcm', effectGraph: createQuarryBody({ send01: 0.3 }), effectReturnNodeIds: ['return'] }, { yieldControl: async () => {} });
      expect(raw.schema).to.equal('lemmings-causal-source-pcm/v1'); expect(raw.files).to.equal(undefined);
      expect(raw.frames).to.equal(Math.round(0.7 * sampleRate)); expect(raw.channels).to.equal(4);
      expect(raw.manifest.timelineZeroSourceFrame).to.equal(Math.round(0.303 * sampleRate)); expect(raw.manifest.effectGraph.latencyFrames).to.equal(null);
      expect(raw.planes.every(plane => plane.byteOffset === 0 && plane.buffer.byteLength === plane.byteLength)).to.equal(true);
      const start = raw.manifest.timelineZeroSourceFrame;
      for (let file = 0; file < dry.files.length; file++) {
        const bytes = pcm(dry.files[file]), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let mismatches = 0;
        for (let frame = 0; frame < dry.manifest.frames; frame++) for (let channel = 0; channel < 2; channel++)
          if (raw.planes[file * 2 + channel][start + frame] !== view.getFloat32((frame * 2 + channel) * 4, true)) mismatches++;
        expect(mismatches, engineId + ' at ' + sampleRate + ', tap ' + file).to.equal(0);
      }
      const cut = await renderCausalOwnedTake({ ...input, outputMode: 'source-pcm', restorationMode: 'owned-state-cut', effectGraph: createQuarryBody({ send01: 0.3 }), effectReturnNodeIds: ['return'] }, { yieldControl: async () => {} });
      expect(cut.planeByteHashes).to.deep.equal(raw.planeByteHashes);
      expect(cut.manifest.restoration.stateCut.effects).to.equal('native-body-reconstructed-from-complete-source-history-not-an-effect-state-cut');
    }
  });
  it('admits non-PCM null descriptors in direct default control/state-cut renders independently of the content compiler', async () => {
    for (const engineId of ['worklet-pluck', 'worklet-choir', 'worklet-spectrum']) {
      const definition = structuredClone(CAUSAL_RENDER_SOURCES.find(source => source.id === engineId).definition); definition.voicePolicy.maxVoices = 2;
      const [descriptor] = await describeNativeInstrumentEngines([{ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
      const definitionHash = await hashData(definition), result = await renderOwnedSourceControls({ definition, descriptor, pcm: null,
        source: { packId: 'fixture.footprint', packVersion: '1.0.0', contentHash: 'b'.repeat(64), patchIdentity: definition.id + '@' + definition.revision, definitionHash, attribution: 'Direct source-footprint regression fixture.' } }, { yieldControl: async () => {} });
      expect(result.manifest.sourceTypedBytes).to.equal(getOwnedSourceProfile(engineId).sourceBytes({ sampleRate: 48000, pcm: null, voices: 2 }));
      const cropped = await renderCausalOwnedTake({ definition, descriptor, revoice: revoice(), pcm: null, sampleRate: 48000, startSeconds: 0.303, endSeconds: 1, restorationMode: 'owned-state-cut' }, { yieldControl: async () => {} });
      expect(cropped.manifest.restoration.stateCut).to.include({ frame: 14544, mutableState: 'independent-staged-copy' });
      expect(cropped.files[0].manifest.statistics.peak).to.be.greaterThan(0);
    }
  });
  for (const [file, engineId] of [['plucked-garden.json', 'worklet-pluck'], ['artificial-choir.json', 'worklet-choir'], ['liquid-drawbars.json', 'worklet-spectrum']]) {
    it('retains source timing and physical updates for ' + engineId + ' with simultaneous dry stems and exact crop preroll', async () => {
      const descriptors = await describeNativeInstrumentEngines([{ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
      const source = JSON.parse(await fs.readFile(new URL('../../content/sounds/' + file, import.meta.url), 'utf8'));
      const compiled = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) });
      const input = { definition: compiled.prepared.patches[0].archivedDefinition, descriptor: descriptors[0], revoice: revoice(), sampleRate: 48000, endSeconds: 1, stemLaneIds: ['0'] };
      const plan = await planCausalOwnedRender(input);
      expect(plan.owned.id).to.equal(engineId); expect(plan.sourceControls.observedPhysicalUpdates).to.equal(1);
      expect(plan.sourceControls.appliedPhysicalUpdates).to.equal(1); expect(plan.events).to.have.length(3);
      const full = await renderCausalOwnedTake(input, { yieldControl: async () => {} }), cropped = await renderCausalOwnedTake({ ...input, startSeconds: 0.2 }, { yieldControl: async () => {} });
      expect(full.manifest.engineRequirement.engineId).to.equal(engineId); expect(full.manifest.commands).to.include({ capturedBegins: 1, capturedUpdates: 1, capturedEnds: 1, applied: 3 });
      expect(Buffer.from(pcm(full.files[0]))).to.deep.equal(Buffer.from(pcm(full.files[1])));
      expect(Buffer.from(pcm(cropped.files[0]))).to.deep.equal(Buffer.from(pcm(full.files[0]).subarray(9600 * 8)));
      expect(full.manifest.realization.sourceControls.observedKinds).to.deep.equal(['MotionCommitted']);
      expect(full.manifest.acousticReceipt).to.equal(false);
      const cutFrame = Math.round(0.303 * 48000), restored = await renderCausalOwnedTake({ ...input, startSeconds: 0.303, restorationMode: 'owned-state-cut' }, { yieldControl: async () => {} });
      expect(Buffer.from(pcm(restored.files[0]))).to.deep.equal(Buffer.from(pcm(full.files[0]).subarray(cutFrame * 8)));
      expect(Buffer.from(pcm(restored.files[1]))).to.deep.equal(Buffer.from(pcm(full.files[1]).subarray(cutFrame * 8)));
      expect(restored.manifest.restoration).to.include({ mode: 'forward-preroll-and-owned-state-cut', prerollFrames: cutFrame });
      expect(restored.manifest.restoration.stateCut).to.include({ frame: cutFrame, mutableState: 'independent-staged-copy', plannerContinuation: 'same-admitted-immutable-intent-plan' });
      expect(restored.manifest.restoration.stateCut.stateHash).to.match(/^[a-f0-9]{64}$/);
    });
  }
});
