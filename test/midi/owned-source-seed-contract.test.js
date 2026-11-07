import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { ownedSourceSeed, resolveOwnedSourceSeed } from '../../js/app/midi-ui/OwnedSourceSeed.js';
import { createOwnedControlKernel } from '../../js/app/resources/OwnedControlKernel.js';
import { ownedSourceBankIds } from '../../js/app/midi-ui/OwnedSourceBankDependencies.js';
import { fixedSourceBank } from './fixed-source-bank-fixture.js';
import { seedLayerDefinition, seedLayerPCM } from '../helpers/seedLayers.js';
import { BEGIN, END, PANIC, REJECTED, FAULTED } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

const engines = ['worklet-pluck', 'worklet-choir', 'worklet-granular', 'worklet-seed-layers', 'worklet-wind', 'worklet-friction', 'worklet-texture', 'worklet-spectrum'];
const identity = { engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 1 };
const actor = index => ({ worldId: 'seed-corpus-world', generation: 3, actorId: 'actor-' + index, onsetId: 'onset-' + index, voiceId: 'voice-' + index });
const performance = { variation: { seed: 73 } };
const digest = values => { const bytes = Buffer.alloc(values.length * 4); values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4)); return createHash('sha256').update(bytes).digest('hex'); };
const golden = {
  'worklet-pluck': 'ed02ef57fb1bada0e7cbf6fa64d6557a602df8647174ef3903f25982b7f46259',
  'worklet-choir': 'd80aecc725c67821bf7f3526778698a1652aa6df5bfeee2201dfd0353f797ede',
  'worklet-granular': 'b00a55d0cf976b66472e5af58e0bf0419003d569d52c9a70b43be49d3c3c66bd',
  'worklet-seed-layers': '806e4845395baafdfc1ba6f4d1e788c181a48b14ef3d06a22f16e24bcda32693',
  'worklet-wind': '5ecb213245422fedfbf022e5f2be6e42af218ffd3b20a03670e7490d693fe8d9',
  'worklet-friction': '1af820cc658780ccb5f386d5b0a7e8bdc3715c0c5434b38b7e944dad4a6b7b88',
  'worklet-texture': '660201a5e73f320e57857433e6a89612ea6eea1e33b9c90e365b9bedcfec05a1',
  'worklet-spectrum': '3fa2e8a67f15a155ab18396d381fa5d1b47e797dd55916f166f647e343a565c7'
};
const render = (kernel, frames, block = 128) => {
  const result = new Float32Array(frames * 2);
  for (let first = 0; first < frames; first += block) {
    const count = Math.min(block, frames - first), left = new Float32Array(count), right = new Float32Array(count);
    kernel.render(left, right, kernel.lastFrame);
    for (let index = 0; index < count; index++) { result[(first + index) * 2] = left[index]; result[(first + index) * 2 + 1] = right[index]; }
  }
  return result;
};
const noFaults = kernel => {
  for (let index = 0; index < kernel.receiptCount; index++) expect([REJECTED, FAULTED], JSON.stringify(Array.from(kernel.receipts.subarray(index * 6, index * 6 + 6)))).not.to.include(kernel.receipts[index * 6]);
};

describe('owned source seed and continuation contracts', function() {
  this.timeout(30000);
  const fixtures = new Map(), banks = new Map();
  before(async () => {
    const layered = await seedLayerPCM();
    const pcm = { descriptor: { schema: 'lemmings-owned-pcm-bank/v1', assetHash: 'a'.repeat(64), pcmHash: 'b'.repeat(64), bankHash: 'c'.repeat(64), format: 'float32-planar-le',
      sampleRate: 32000, sourceSampleRate: 32000, sourceFrames: 16000, frames: 16000, channels: 2, bytes: 128000, peak: 0.2 },
    planes: [Float32Array.from({ length: 16000 }, (_, index) => Math.sin(index * 0.05) * 0.2), Float32Array.from({ length: 16000 }, (_, index) => Math.cos(index * 0.05) * 0.2)] };
    for (const id of engines) {
      const profile = getOwnedSourceProfile(id), patch = id === 'worklet-seed-layers' ? seedLayerDefinition() : { id: 'seed-corpus', revision: 1,
        parameters: Object.fromEntries(Object.entries(profile.fields).map(([key, field]) => [key, field[2]])) };
      if (id === 'worklet-granular') Object.assign(patch.parameters, { densityHz: 48, grainMilliseconds: 20, activity01: 1 });
      if (id === 'worklet-friction') Object.assign(patch.parameters, { frictionKind: 2, frictionPressure01: 0.5 });
      if (id === 'worklet-texture') Object.assign(patch.parameters, { textureKind: 2, textureBodySeconds: 0.05 });
      const material = id === 'worklet-seed-layers' ? layered : id === 'worklet-granular' ? pcm : null;
      const ids = ownedSourceBankIds(profile, patch.parameters);
      for (const bank of ids) if (!banks.has(bank)) banks.set(bank, fixedSourceBank(bank));
      const create = () => createOwnedControlKernel(profile, 48000, 2, { patch, pcm: material, sourceBank: banks.get(ids[0]), auxiliarySourceBanks: Object.fromEntries(ids.slice(1).map(bank => [bank, banks.get(bank)])) });
      const begin = (index, frame = 0, slot = 0, token = 1, lease = 8192) => {
        const packet = new Float64Array(profile.width), resolved = resolveOwnedSourceSeed(profile, patch, actor(index), performance);
        packet.set([1, frame, token, BEGIN, slot, token, id === 'worklet-seed-layers' ? 440 : 220, 0.5, 1, 0, 24, 0, 1, 128, 0, 0, frame + lease, 3]);
        const travelFrames = Math.min(2048, lease - 1);
        Object.assign(packet, profile.beginFields(patch.parameters, resolved.seed, material?.descriptor, null, { from: 0, to: 16 / 128 * travelFrames / 2048, firstFrame: frame, endFrame: frame + travelFrames }));
        return packet;
      };
      fixtures.set(id, { profile, patch, create, begin });
    }
  });
  for (const id of engines) {
    it('preserves the original 64-actor ' + id + ' seed sequence through reordered, restored and migrated reads', () => {
      const { profile } = fixtures.get(id), patch = { id: 'seed-corpus', revision: 1 }, originals = Array.from({ length: 64 }, (_, index) => resolveOwnedSourceSeed(profile, patch, actor(index), performance));
      expect(digest(originals.map(value => value.seed))).to.equal(golden[id]); expect(new Set(originals.map(value => value.seed)).size).to.equal(64);
      for (let index = 63; index >= 0; index--) {
        const restored = JSON.parse(JSON.stringify(actor(index))), actual = resolveOwnedSourceSeed(profile, patch, { ...restored, laneId: 'migrated', poolSlot: 1 }, performance);
        expect(actual).to.deep.equal(originals[index]); expect(actual.seed).to.equal(ownedSourceSeed(profile, patch, restored, performance));
        expect(actual.receipt.identityScope).to.equal('execution-birth'); expect(Object.isFrozen(actual.receipt.inputs[3])).to.equal(true);
        expect(actual.receipt.contract.restoration).to.include({ capability: 'exactSnapshot', qualification: 'declared-source-capability;not-a-PCM-equivalence-receipt' });
      }
    });
    it('owns same-frame ' + id + ' choices and restores the actual continued kernel through a different block partition', async () => {
      const { create, begin } = fixtures.get(id), original = await create();
      const first = begin(0, 0, 0, 1), second = begin(1, 0, 1, 2), packet = new Float64Array(first.length * 2); packet.set(first); packet.set(second, first.length);
      original.accept(packet, 2); render(original, 256); noFaults(original); expect(original.active[0]).to.equal(1); expect(original.active[1]).to.equal(1); expect(first[18]).not.to.equal(second[18]);
      const bytes = new Uint8Array(original.stateByteLength()); original.snapshotInto(bytes, identity); const transferred = structuredClone(bytes, { transfer: [bytes.buffer] }); expect(bytes.byteLength).to.equal(0);
      const restored = await create(); restored.restoreFrom(transferred, identity);
      expect(render(restored, 1024, 23)).to.deep.equal(render(original, 1024, 128)); noFaults(restored); noFaults(original);
      expect(restored.active).to.deep.equal(original.active);
      const actorA = await create(), actorB = await create(); actorA.accept(begin(0), 1); actorB.accept(begin(1), 1);
      expect(render(actorA, 2048)).not.to.deep.equal(render(actorB, 2048)); noFaults(actorA); noFaults(actorB);
    });
  }
  for (const id of engines) {
    it('keeps 64 actual ' + id + ' onsets stable across completed slot reuse and canceled queued preparation', async () => {
      const { profile, create, begin } = fixtures.get(id), reused = await create();
      for (let index = 0; index < 64; index++) {
        const frame = reused.lastFrame, queued = begin(1000 + index, frame + 4096, 0, index * 4 + 1);
        reused.accept(queued, 1); const panic = new Float64Array(profile.width); panic.set([1, frame, index * 4 + 2, PANIC, 0, 0]); reused.accept(panic, 1); render(reused, 128);
        const start = reused.lastFrame, fresh = await create(); render(fresh, start); const onset = begin(index, start, 0, index * 4 + 3, 512);
        reused.accept(onset, 1); fresh.accept(onset, 1);
        const end = new Float64Array(profile.width); end.set([1, start + 128, index * 4 + 4, END, 0, index * 4 + 3]); end[13] = 64; end[17] = 3;
        reused.accept(end, 1); fresh.accept(end, 1);
        expect(render(reused, 64, 23)).to.deep.equal(render(fresh, 64, 17));
        const state = new Uint8Array(reused.stateByteLength()); reused.snapshotInto(state, identity);
        const transfer = structuredClone(state, { transfer: [state.buffer] }), resumed = await create(); expect(state.byteLength).to.equal(0); resumed.restoreFrom(transfer, identity);
        const continued = render(reused, 448, 128); expect(continued).to.deep.equal(render(fresh, 448, 23)); expect(continued).to.deep.equal(render(resumed, 448, 17));
        noFaults(reused); noFaults(fresh); noFaults(resumed); expect(reused.active.some(Boolean)).to.equal(false);
        reused.receiptCount = 0;
      }
    });
  }
  it('reports event-only and partial legacy inputs honestly and keeps sample-zone selection separate', () => {
    const profile = getOwnedSourceProfile('worklet-pluck'), patch = { id: 'seed-corpus', revision: 1 };
    expect(resolveOwnedSourceSeed(profile, patch, { onsetId: 'event', actorId: null }, performance).receipt.identityScope).to.equal('event-only');
    expect(resolveOwnedSourceSeed(profile, patch, { onsetId: 'event', actorId: 4 }, performance).receipt.identityScope).to.equal('partial-birth-input');
    expect(resolveOwnedSourceSeed(profile, patch, { ...actor(0), generation: NaN }, performance).receipt.identityScope).to.equal('partial-birth-input');
    for (const id of ['worklet-sine', 'worklet-sample']) expect(resolveOwnedSourceSeed(getOwnedSourceProfile(id), patch, actor(0), performance).receipt).to.equal(null);
    const a = resolveOwnedSourceSeed(profile, patch, actor(0), performance), b = resolveOwnedSourceSeed(profile, patch, { ...actor(0), onsetId: 'next' }, performance);
    expect(a.seed).not.to.equal(b.seed); expect(a.receipt.contract).to.equal(b.receipt.contract); expect(Object.isFrozen(a.receipt.contract.source)).to.equal(true);
    const spectrum = getOwnedSourceProfile('worklet-spectrum'); expect(resolveOwnedSourceSeed(spectrum, patch, actor(0), { ...performance, values: { sourceMode: 2 } }).receipt.contract.algorithm).to.equal('u32-indexed-circular-phase-v1');
    const mutable = { ...profile, runtime: { ...profile.runtime } }, before = resolveOwnedSourceSeed(mutable, patch, actor(0), performance); mutable.runtime.buildId = 'controlled-revision';
    const after = resolveOwnedSourceSeed(mutable, patch, actor(0), performance); expect(before.receipt.contract.source.buildId).not.to.equal(after.receipt.contract.source.buildId);
  });
});
