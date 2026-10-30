import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { planCausalSineRender, renderCausalSineTake } from '../../js/app/midi-ui/CausalSineRender.js';
import { createProcgenCausalJournal } from '../../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createCausalTakeRecorder, querySoundOnlyRevoice } from '../../js/app/procgen/workstation/CausalTake.js';
import { createMemoryCausalStore } from '../helpers/causalJournalStore.js';

const chunks = bytes => {
  const found = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let at = 12; at < bytes.length;) { const name = new TextDecoder().decode(bytes.subarray(at, at + 4)), size = view.getUint32(at + 4, true);
    found.set(name, bytes.subarray(at + 8, at + 8 + size)); at += 8 + size + size % 2; } return found;
};
const pcm = file => { const bytes = chunks(file.bytes).get('data'); return new DataView(bytes.buffer, bytes.byteOffset, bytes.length); };
const rejectCode = async (promise, code) => { let caught; try { await promise; } catch (error) { caught = error; } expect(caught?.code).to.equal(code); };
const intent = (tick, sourceMs, kind, voiceId, laneId, expression = {}) => ({ version: 1, kind, worldId: 'world:render', batchId: 'batch:' + tick,
  generation: 1, voiceId, onsetId: voiceId, intentId: `intent:${tick}:${voiceId}:${kind}`, laneId, actorId: voiceId === 'a' ? 1 : 2,
  sourceEventIds: ['cause:' + tick], scoreTime: { sourceTimeMs: sourceMs, simTick: tick, subTick: 0, precision: 'tick' },
  pitch: { cents: 6012.34567, referenceHz: 440 }, velocity01: 0.65, expression });
const source = async (rows = [
  [intent(1, 100, 'begin', 'a', 0, { pan01: -0.5 }), intent(1, 100, 'begin', 'b', 1, { pan01: 0.5 })],
  [intent(2, 250, 'update', 'a', 0, { pressure01: 0.25001, pitchOffsetCents: 11.4321 })], [intent(3, 350, 'end', 'a', 0)], [intent(4, 500, 'end', 'b', 1)]
]) => {
  const { storage } = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage });
  const recorder = await createCausalTakeRecorder({ journal, takeId: 'take:render', documentId: 'doc:render', sourceVersions: { physical: 1, intent: 1 },
    mapping: { version: 1, revision: 1, instruments: [] }, initialCheckpoint: { tick: 0 }, boundaryState: { sourceTimeMs: 0, voices: [] } });
  for (let index = 0; index < rows.length; index++) {
    const tick = index + 1; recorder.recordCommittedBatch({ batch: { version: 1, worldId: 'world:render', generation: 1, tick,
      batchId: 'batch:' + tick, sourceTimeMs: rows[index][0]?.scoreTime.sourceTimeMs ?? tick * 100, facts: [], completeness: { status: 'complete', dropped: 0 } }, intents: rows[index] });
  }
  await recorder.stop({ boundaryState: { sourceTimeMs: 1000, voices: [] } });
  const manifest = await journal.openTake('take:render');
  return { journal, manifest, revoice: await querySoundOnlyRevoice({ journal, takeId: 'take:render', soundPatch: { id: 'explicit-sine-revoice' }, executionEpoch: 'render:isolated' }) };
};

describe('journal-backed causal sine PCM rendering', () => {
  let definition, descriptor;
  before(async () => {
    const descriptors = await describeNativeInstrumentEngines(['native-oscillator', 'worklet-sine'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })));
    const compiled = await compileSoundContent(JSON.parse(await fs.readFile(new URL('../../content/sounds/native.json', import.meta.url), 'utf8')),
      { targets: descriptors.map(descriptor => ({ descriptor })) });
    definition = compiled.prepared.patches.find(entry => entry.identity === 'foundation.held-sine@2').archivedDefinition;
    descriptor = descriptors.find(entry => entry.engineId === 'worklet-sine');
  });
  for (const sampleRate of [44100, 48000, 96000]) {
    it(`renders captured intent times, leading silence and simultaneous recombinable dry stems at ${sampleRate} Hz`, async () => {
      const { revoice, journal, manifest } = await source(), result = await renderCausalSineTake({ revoice, definition, descriptor, sampleRate,
        endSeconds: 1, stemLaneIds: ['0', '1'] }, { yieldControl: async () => {} });
      expect(result.files).to.have.length(3); expect(result.manifest).to.include({ frames: sampleRate, sourceCanonicalHash: manifest.canonicalHash, mode: 'intent-render', acousticReceipt: false });
      expect(result.manifest.commands).to.include({ capturedBegins: 2, capturedUpdates: 1, capturedEnds: 2, submitted: 5, applied: 5, peakVoices: 2 });
      expect(result.manifest.stems).to.include({ allCapturedLanesIncluded: true, mode: 'simultaneous-dry-lane-taps' });
      const master = pcm(result.files[0]), a = pcm(result.files[1]), b = pcm(result.files[2]); let peakError = 0;
      for (let at = 0; at < master.byteLength; at += 4) peakError = Math.max(peakError, Math.abs(master.getFloat32(at, true) - a.getFloat32(at, true) - b.getFloat32(at, true)));
      expect(peakError).to.be.lessThan(1e-6);
      for (let frame = 0; frame < Math.round(sampleRate * 0.1); frame++) expect(master.getFloat32(frame * 8, true)).to.equal(0);
      for (const file of result.files) { const inventory = chunks(file.bytes), embedded = JSON.parse(new TextDecoder().decode(inventory.get('lmjs')));
        expect(embedded).to.deep.equal(file.manifest); expect(createHash('sha256').update(inventory.get('data')).digest('hex')).to.equal(embedded.pcmHash); }
      expect(await journal.openTake(manifest.takeId)).to.deep.equal(manifest);
    });
  }
  it('prerolls the same complete graph so a mid-held crop matches the uninterrupted PCM exactly', async () => {
    const { revoice } = await source(), input = { revoice, definition, descriptor, sampleRate: 48000, endSeconds: 0.8 };
    const complete = await renderCausalSineTake(input, { yieldControl: async () => {} }), cropped = await renderCausalSineTake({ ...input, startSeconds: 0.2 }, { yieldControl: async () => {} });
    const full = chunks(complete.files[0].bytes).get('data'), selected = chunks(cropped.files[0].bytes).get('data');
    expect(selected).to.deep.equal(full.subarray(Math.round(0.2 * 48000) * 8)); expect(cropped.manifest.restoration).to.include({ mode: 'deterministic-preroll', prerollFrames: 9600 });
  });
  it('preserves stem routing when different lanes reuse a slot within one nominal render block', async () => {
    const rows = [[intent(1, 100, 'begin', 'a', 0)], [intent(2, 200, 'end', 'a', 0)], [intent(3, 203, 'begin', 'b', 1)], [intent(4, 300, 'end', 'b', 1)]];
    const { revoice } = await source(rows), patch = { ...definition, parameters: { ...definition.parameters, releaseSeconds: 0.002 }, voicePolicy: { ...definition.voicePolicy, maxVoices: 1 } };
    const result = await renderCausalSineTake({ revoice, definition: patch, descriptor, sampleRate: 48000, endSeconds: 0.5, stemLaneIds: ['0', '1'] }, { yieldControl: async () => {} });
    expect(result.manifest.commands.peakVoices).to.equal(1); const first = pcm(result.files[1]), second = pcm(result.files[2]);
    for (let frame = 0; frame < Math.round(0.203 * 48000); frame++) expect(second.getFloat32(frame * 8, true)).to.equal(0);
    for (let frame = Math.round(0.203 * 48000); frame < result.manifest.frames; frame++) expect(first.getFloat32(frame * 8, true)).to.equal(0);
  });
  it('admits a complete fractional-time voice set independently of its source actor traversal order', async () => {
    const phase = (kind, voice, fraction) => { const value = intent(1, 100, kind, voice, voice === 'a' ? 0 : 1);
      value.scoreTime = { ...value.scoreTime, subTick: fraction, sourceTickDurationMs: 50 }; return value; };
    const { revoice } = await source([[phase('begin', 'a', 0.9), phase('end', 'a', 0.95), phase('begin', 'b', 0.1), phase('end', 'b', 0.2)]]);
    const patch = { ...definition, parameters: { ...definition.parameters, releaseSeconds: 0.002 }, voicePolicy: { ...definition.voicePolicy, maxVoices: 1 } };
    const result = await renderCausalSineTake({ revoice, definition: patch, descriptor, endSeconds: 0.5 }, { yieldControl: async () => {} });
    expect(result.manifest.commands).to.include({ capturedBegins: 2, peakVoices: 1 }); expect(result.manifest.timing.fractionalIntents).to.equal(4);
  });
  it('distinguishes unknown natural release, deliberate boundary release, missing ancestry, memory denial and cancellation', async () => {
    const { revoice } = await source([[intent(1, 100, 'begin', 'a', 0)]]), input = { revoice, definition, descriptor, sampleRate: 48000, endSeconds: 0.5 };
    await rejectCode(planCausalSineRender({ ...input, tail: { mode: 'bounded-natural' } }), 'unknown-natural-release');
    const derived = await renderCausalSineTake({ ...input, tail: { mode: 'boundary-release', maxSeconds: 4 } }, { yieldControl: async () => {} });
    expect(derived.manifest.tail).to.include({ derivedBoundaryReleases: 1, truncated: false }); expect(derived.manifest.commands.capturedEnds).to.equal(0);
    await rejectCode(renderCausalSineTake(input, { maxWorkingBytes: 4096 }), 'render-memory-capacity');
    await rejectCode(planCausalSineRender({ ...input, revoice: { ...revoice, boundary: { ...revoice.boundary, state: { ...revoice.boundary.state, voices: [{ voiceId: 'held-before-record' }] } } } }), 'source-preflight');
    const controller = new AbortController(); let error;
    try { await renderCausalSineTake(input, { signal: controller.signal, yieldControl: async () => controller.abort(new Error('cancel-owned-render')) }); } catch (caught) { error = caught; }
    expect(error.message).to.equal('cancel-owned-render');
  });
});
