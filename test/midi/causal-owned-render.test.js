import { expect } from 'chai';
import fs from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { planCausalOwnedRender, renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';

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
describe('owned-source causal revoice rendering', () => {
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
