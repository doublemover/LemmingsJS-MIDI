import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { resolveCircularSpectrum, circularSpectrumWeight, planCircularTravel } from '../../js/midi/content/CircularSpectrum.js';
import { OwnedCircularPartials } from '../../js/app/midi-ui/worklet/OwnedCircularPartials.js';
import { OwnedSpectrumKernel } from '../../js/app/midi-ui/worklet/OwnedSpectrumProcessor.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { validateInstrumentPatchV2 } from '../../js/midi/content/InstrumentPatchV2.js';
import { renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { BEGIN, UPDATE, REJECTED, RECEIPT_WIDTH } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { fixedSourceBank } from './fixed-source-bank-fixture.js';
import { sampleMotionBatch, sampleTravelGraph } from '../helpers/sampleTraversal.js';

const sineAt = phase => Math.sin(phase * 2 * Math.PI), profile = getOwnedSourceProfile('worklet-spectrum');
const parameters = () => ({ ...Object.fromEntries(Object.entries(profile.fields).map(([id, spec]) => [id, spec[2]])), sourceMode: 2 });
const definition = () => ({ schemaVersion: 2, id: 'circular.fixture', revision: 1, name: 'Circular fixture', author: 'Fixture', tags: [], engineId: 'worklet-spectrum', engineVersion: 1,
  parameters: { sourceMode: 2, attackSeconds: 0.005, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.01 }, sampleRefs: [], modulations: [], macros: [], causalBindings: [],
  voicePolicy: { maxVoices: 2, steal: 'reject' }, mix: { gain01: 0.7, pan01: 0 } });

describe('travel-owned octave circular spectra (deferred runtime qualification)', () => {
  it('resolves the lattice reference separately from the Gaussian center and rejects unsupported periods', () => {
    const a = resolveCircularSpectrum({}, 48000), b = resolveCircularSpectrum({ frequencyCenterHz: 1000 }, 48000), c = resolveCircularSpectrum({ referenceFrequencyHz: 27.5 }, 48000);
    expect(a.referenceFrequencyHz).to.equal(b.referenceFrequencyHz); expect(a.frequencyCenterHz).to.equal(c.frequencyCenterHz);
    expect(circularSpectrumWeight(a, 700)).to.be.closeTo(1, 1e-12);
    expect(circularSpectrumWeight(a, 700 * 2 ** 1.2)).to.be.closeTo(Math.exp(-0.5), 1e-12);
    expect(() => resolveCircularSpectrum({ periodRatio: 3 }, 48000)).to.throw('only octave');
    const negative = new OwnedCircularPartials(a); negative.reset(-0.25, 7);
    for (let slot = 0; slot < a.partialCountCap; slot++) expect(negative.partials[slot * 6 + 2]).to.be.closeTo(55 * 2 ** (negative.partials[slot * 6] + 0.75), 1e-9);
  });
  for (const rate of [44100, 48000, 96000]) it('preserves in-band phase through a wrap, holds distance phase for ten seconds and reverses at ' + rate + ' Hz', () => {
    const recipe = resolveCircularSpectrum({}, rate), source = new OwnedCircularPartials(recipe); source.reset(0.99999, 193);
    expect(source.setSegment(0.99999, 1.00001, 2)).to.equal(true); source.sample(sineAt, 0);
    const slot = 4, before = source.partials[slot * 6 + 1], oldIndex = source.partials[slot * 6]; source.sample(sineAt, 1);
    expect(source.partials[slot * 6]).to.equal(oldIndex + 1);
    const expected = before + 55 * 2 ** (oldIndex + 1) / rate;
    expect(source.partials[slot * 6 + 1]).to.be.closeTo(expected - Math.floor(expected), 1e-10);
    const held = source.state[0]; let peak = 0;
    for (let frame = 2; frame < rate * 10; frame++) peak = Math.max(peak, Math.abs(source.sample(sineAt, frame)));
    expect(source.state[0]).to.equal(held); expect(peak).to.be.at.most(0.800000001);
    expect(source.setSegment(held, held - 1, rate, rate * 10)).to.equal(true);
    for (let frame = rate * 10; frame < rate * 11; frame++) expect(Number.isFinite(source.sample(sineAt, frame))).to.equal(true);
    expect(source.state[0]).to.equal(held - 1);
  });
  it('maps 1024 canonical world pixels to two cycles without a camera or elapsed-time distance source', () => {
    const engine = createCausalMusicEngine({ getGraph: () => sampleTravelGraph() }), batch = sampleMotionBatch(1, 0, 1024); batch.tickDurationMs = 1000;
    const intent = engine.processBatch(batch)[0], p = parameters();
    for (const rate of [44100, 48000, 96000]) {
      const plan = planCircularTravel(p, intent, 0, rate); expect(plan.from).to.equal(0); expect(plan.to).to.equal(2); expect(plan.endFrame).to.equal(rate);
      const reversed = structuredClone(intent); reversed.articulationState.travel.from.signedDistancePixels = 1024; reversed.articulationState.travel.to.signedDistancePixels = 0;
      expect(planCircularTravel(p, reversed, rate, rate).to).to.equal(0);
      expect(() => planCircularTravel({ ...p, circularRequireSegments: 1 }, intent, 0, rate)).to.throw('precision');
    }
    engine.dispose();
  });
  it('restores a pending circular segment through the actual shared spectral kernel without resetting partials', () => {
    const rate = 48000, bank = fixedSourceBank('spectrum-v1'), source = new OwnedSpectrumKernel(rate, 2, bank), p = parameters();
    const row = new Float64Array(profile.width); row.set([1, 0, 1, BEGIN, 0, 1, 261.6255653005986, 0.5, 1, 0, 0, 0, 1, 480, 0, 0, rate * 3, 1]);
    for (const [key, value] of Object.entries(profile.beginFields(p, 193))) row[Number(key)] = value;
    source.accept(row, 1); const update = new Float64Array(profile.width); update.set([1, 0, 2, UPDATE, 0, 1]); update[17] = 1; update[15] = 64; update[25] = 0; update[26] = 0.3; update[27] = 12000; source.accept(update, 1);
    source.render(new Float32Array(7000), new Float32Array(7000), 0);
    const identity = { engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 1 }, bytes = new Uint8Array(source.stateByteLength()); source.snapshotInto(bytes, identity);
    const restored = new OwnedSpectrumKernel(rate, 2, bank); restored.restoreFrom(bytes, identity);
    const a = [new Float32Array(6000), new Float32Array(6000)], b = [new Float32Array(6000), new Float32Array(6000)]; source.render(...a, 7000); restored.render(...b, 7000);
    expect(a).to.deep.equal(b); expect(source.source.circular[0].state[0]).to.equal(0.3);
    expect(Array.from({ length: source.receiptCount }, (_, i) => source.receipts[i * RECEIPT_WIDTH]).includes(REJECTED)).to.equal(false);
  });
  it('compiles the original four-control recipes and renders the same canonical circular history through a state cut', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-spectrum', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const raw = JSON.parse(await readFile(new URL('../../content/sounds/circular-travel.json', import.meta.url), 'utf8'));
    const content = await compileSoundContent(raw, { targets: [{ descriptor }] }); expect(content.prepared.patches).to.have.length(5);
    expect(content.prepared.patches[0].definition.macros.map(macro => macro.name)).to.have.members(['CLIMB', 'WINDOW', 'CENTER', 'WEIGHT']);
    expect(() => validateInstrumentPatchV2({ ...definition(), parameters: { sourceMode: 2, circularPeriodRatio: 3 } }, descriptor)).to.throw('only octave');
    const engine = createCausalMusicEngine({ getGraph: () => sampleTravelGraph() }), intents = [engine.processBatch(sampleMotionBatch(1, 0, 1))[0], engine.processBatch(sampleMotionBatch(2, 1, 1))[0], engine.processBatch(sampleMotionBatch(3, 1, 0))[0]];
    intents.push({ ...intents[2], kind: 'end', intentId: 'circular:end', articulationState: null, scoreTime: { ...intents[2].scoreTime, sourceTimeMs: 180 } });
    const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'take:circular', takeRevision: 1, sourceCanonicalHash: 'c'.repeat(64), sourceState: 'finalized', nextSequence: null,
      sourceVersions: { physicalMusic: 9 }, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { voices: [], sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 500 }, intents };
    const input = { definition: definition(), descriptor, revoice, sampleRate: 48000, startSeconds: 0.08, endSeconds: 0.3, tail: { mode: 'bounded-natural', maxSeconds: 1 } };
    const a = await renderCausalOwnedTake(input, { yieldControl: async () => {} }), b = await renderCausalOwnedTake({ ...input, restorationMode: 'owned-state-cut' }, { yieldControl: async () => {} });
    expect(a.manifest.realization.circularTravel).to.include({ voices: 1, segments: 3 }); expect(a.manifest.commands.capturedBegins).to.equal(1);
    expect(b.files.map(file => file.manifest.pcmHash)).to.deep.equal(a.files.map(file => file.manifest.pcmHash)); engine.dispose();
  });
  it('samples only real completed contact coordinates for stepping-stone onsets and retains negative phase', () => {
    const graph = { version: 1, revision: 3, instruments: [{ id: 'stones', sourceKind: 'ContactResolved', causeKind: 'wall', pitchCents: 6000, velocity01: 0.7, role: 'pulse', route: 'local' }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph });
    const point = x => {
      const batch = sampleMotionBatch(1, x, x); batch.facts[0] = { ...batch.facts[0], kind: 'ContactResolved', contactId: 'contact-a', causeKind: 'wall', positionAfter: { x, y: 40 } };
      return batch;
    };
    const intent = engine.processBatch(point(-64)).find(intent => intent.kind === 'begin'), p = { ...parameters(), circularControlMode: 1, circularPixelsPerCycle: 256 };
    expect(intent.articulationState.contactCoordinate.coordinate).to.deep.equal({ x: -64, y: 40 });
    const plan = planCircularTravel(p, intent, 100, 48000); expect(plan).to.include({ from: -0.25, to: -0.25, firstFrame: 100, endFrame: 101 });
    expect(plan.receipt).to.include({ schema: 'lemmings-circular-contact-receipt/v1', graphRevision: 3, coordinateMeaning: 'actor-position-at-resolved-contact', precision: 'completed-contact-coordinate' });
    expect(() => planCircularTravel(p, { ...intent, sourceEventIds: [] }, 100, 48000)).to.throw('matching completed contact');
    expect(() => planCircularTravel(p, { ...intent, articulationState: null }, 100, 48000)).to.throw('matching completed contact');
    expect(() => planCircularTravel({ ...p, circularRequireSegments: 1 }, intent, 100, 48000)).to.throw('precision');
    expect(planCircularTravel(p, { controlFixture: true }, 100, 48000)).to.equal(null); engine.dispose();
  });
  it('revoices one contact as one onset with a constant coordinate-selected phase', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-spectrum', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const graph = { version: 1, revision: 1, instruments: [{ id: 'stones', sourceKind: 'ContactResolved', causeKind: 'wall', pitchCents: 6000, velocity01: 0.7, role: 'pulse', route: 'local' }] }, engine = createCausalMusicEngine({ getGraph: () => graph });
    const batch = sampleMotionBatch(1, 128, 128); batch.facts[0] = { ...batch.facts[0], kind: 'ContactResolved', contactId: 'contact-a', causeKind: 'wall' };
    const intents = engine.processBatch(batch), revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'take:stones', takeRevision: 1, sourceCanonicalHash: 'c'.repeat(64), sourceState: 'finalized', nextSequence: null,
      sourceVersions: { physicalMusic: 9 }, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { voices: [], sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 500 }, intents };
    const patch = definition(); patch.parameters.circularControlMode = 1; patch.parameters.circularPixelsPerCycle = 256;
    const result = await renderCausalOwnedTake({ definition: patch, descriptor, revoice, sampleRate: 48000, startSeconds: 0, endSeconds: 0.3, tail: { mode: 'bounded-natural', maxSeconds: 1 } }, { yieldControl: async () => {} });
    expect(result.manifest.commands.capturedBegins).to.equal(1); expect(result.manifest.realization.circularTravel.policy).to.include('observed-contact-coordinate');
    expect(result.manifest.realization.circularTravel).to.include({ voices: 1, segments: 1 }); engine.dispose();
  });

});
