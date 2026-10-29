import { expect } from 'chai';
import JZZ from 'jzz';
import installSmf from 'jzz-midi-smf';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { encodePhysicalTakeMidi } from '../js/app/procgen/workstation/PhysicalTakeMidiProjection.js';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createCausalTakeRecorder, querySoundOnlyRevoiceOwned } from '../js/app/procgen/workstation/CausalTake.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { parseSmf } from './support/smf.js';
installSmf(JZZ);

const controls = { estimatedPeakBytes: 96 * 1048576, yieldControl: async () => {} };
const fixture = () => {
  const clock = createProcgenPhysicalScoreClock(), times = [0];
  clock.observe({ version: 1, worldId: 'source', generation: 1, tick: 0, sourceTimeMs: 0, tickDurationMs: 60 }, { bpm: 120 }); const initialClock = structuredClone(clock.snapshot());
  for (let tick = 1; tick <= 30; tick++) { const duration = tick <= 10 ? 60 : 30; times[tick] = times[tick - 1] + duration;
    clock.observe({ version: 1, worldId: 'source', generation: 1, tick, sourceTimeMs: times[tick], tickDurationMs: duration }, { bpm: tick < 20 ? 120 : 240 }); }
  let ordinal = 0;
  const intent = (kind, tick, voiceId, extra = {}) => ({ version: 1, kind, worldId: 'source', generation: 1, voiceId, onsetId: voiceId, intentId: 'intent-' + (++ordinal), batchId: 'batch-' + tick,
    sourceEventIds: ['fact-' + tick], laneId: 0, causalSequence: tick, pitch: { cents: 6900.12345, referenceHz: 440 }, velocity01: 0.0001, expression: {},
    scoreTime: { ...clock.map({ simTick: tick }), sourceTimeMs: times[tick] }, ...extra });
  const intents = [intent('begin', 10, 'A'), intent('begin', 10, 'B'), intent('update', 12, 'A', { causalSequence: null, expression: { pitchOffsetCents: 50, pressure01: 0.345, pan01: -0.5 } }),
    intent('end', 14, 'A'), intent('begin', 14, 'C', { pitch: { cents: 6000, referenceHz: 432 } }), intent('end', 16, 'B'), intent('end', 18, 'C')];
  const revoice = { version: 1, operation: 'sound-only-revoice', takeId: 'physical-midi', takeRevision: 1, sourceCanonicalHash: 'a'.repeat(64), sourceState: 'finalized', sourceComplete: true,
    boundary: { status: 'captured-initial-state', state: { sourceTimeMs: 0, voices: [], timeline: initialClock } }, finalBoundaryState: { sourceTimeMs: times[30], voices: [], timeline: clock.snapshot() },
    coverage: { status: 'known-covered' }, intents, intentCount: intents.length, nextSequence: null };
  return { clock, times, initialClock, intent, revoice };
};
const reject = async (work, message) => { let error; try { await work; } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error); if (message) expect(error.message).to.include(message); return error; };

describe('captured physical take MIDI1 projection', () => {
  it('preserves same-pitch voices, captured timing, safe same-tick reuse and trailing crop silence with independent SMF parsing', async () => {
    const f = fixture(), result = await encodePhysicalTakeMidi({ revoice: f.revoice, options: { program: 24 } }, controls), parsed = parseSmf(result.bytes);
    const on = parsed.filter(row => (row.status & 0xf0) === 0x90), off = parsed.filter(row => (row.status & 0xf0) === 0x80);
    expect(on.map(row => row.status & 15)).to.deep.equal([0, 1, 0]); expect(on.map(row => row.data[1])).to.deep.equal([1, 1, 1]);
    expect(off.map(row => row.status & 15)).to.deep.equal([0, 1, 0]);
    expect(on[0].tick).to.equal(Math.round(f.clock.map({ simTick: 10 }).beat * 960));
    expect(parsed.at(-1).tick).to.equal(Math.round(f.clock.map({ simTick: 30 }).beat * 960)); expect(parsed.at(-1).tick).to.be.greaterThan(off.at(-1).tick);
    const sameTick = parsed.filter(row => row.tick === on[2].tick && row.status < 0xf0); expect(sameTick[0].status).to.equal(0x80);
    expect(sameTick.findIndex(row => (row.status & 0xf0) === 0x90)).to.be.greaterThan(sameTick.findIndex(row => (row.status & 0xf0) === 0xe0));
    const independent = new JZZ.MIDI.SMF(result.bytes), raw = Array.from(independent[0]).filter(row => row[0] < 0xf0);
    expect(raw.filter(row => (row[0] & 0xf0) === 0x90).map(row => row.tt)).to.deep.equal(on.map(row => row.tick));
    expect(Array.from(raw[0])).to.deep.equal([0xb0, 101, 0]); expect(raw.some(row => row[0] === 0xc0 && row[1] === 24)).to.equal(true);
    expect(result.manifest.lowering.peakVoices).to.equal(2); expect(result.manifest.lowering.losses.minimumNonzeroVelocity).to.equal(3);
    expect(result.manifest.lowering.losses.maximumVelocityError).to.be.closeTo(1 / 127 - 0.0001, 1e-12);
    expect(result.manifest.timing.ordering).to.include('canonical-intent-order'); expect(result.manifest.lowering.losses.sourceIntentsWithoutFactSequence).to.equal(1);
    expect(result.manifest.lowering.losses.maximumPitchErrorCents).to.be.lessThan(0.025);
    expect((await encodePhysicalTakeMidi({ revoice: f.revoice, options: { program: 24 } }, controls)).bytes).to.deep.equal(result.bytes);
  });
  it('reports pressure/pan/pitch reduction and preserves extrema and center without sharing expressive channels', async () => {
    const f = fixture(); f.revoice.intents[0].expression = { pan01: 0, pressure01: 1, pitchOffsetCents: 0 };
    f.revoice.intents[1].expression = { pan01: 1, pressure01: 0, pitchOffsetCents: -100 };
    const result = await encodePhysicalTakeMidi({ revoice: f.revoice }, controls), parsed = parseSmf(result.bytes);
    expect(parsed.some(row => row.status === 0xb0 && row.data[0] === 10 && row.data[1] === 64)).to.equal(true);
    expect(parsed.some(row => row.status === 0xb1 && row.data[0] === 10 && row.data[1] === 127)).to.equal(true);
    expect(result.manifest.lowering.losses.pressure7bit).to.equal(1); expect(result.manifest.lowering.losses.maximumPanError).to.equal(0);
  });
  it('refuses exhausted capacity, unknown expression, silent onsets, unsupported bodies and excess bend', async () => {
    await reject(encodePhysicalTakeMidi({ revoice: fixture().revoice, options: { channels: [1] } }, controls), 'capacity exhausted');
    for (const [change, message] of [[row => { row.expression = { brightness01: 0.5 }; }, 'unsupported'], [row => { row.velocity01 = 0; }, 'silent'],
      [row => { row.route = 'prepared-body'; }, 'unsupported'], [row => { row.expression = { pitchOffsetCents: 500 }; }, 'pitch-bend range']]) {
      const f = fixture(); change(f.revoice.intents[0]); await reject(encodePhysicalTakeMidi({ revoice: f.revoice }, controls), message);
    }
    await reject(encodePhysicalTakeMidi({ revoice: fixture().revoice, options: { sourceLayer: 'api-accepted' } }, controls), 'explicit melodic');
  });
  it('rejects unobserved/open boundaries, partial paging, absent coverage and inconsistent source time instead of repairing history', async () => {
    for (const change of [source => { source.boundary.state.voices = [{}]; }, source => { source.finalBoundaryState.voices = [{}]; }, source => { source.nextSequence = 99; },
      source => { source.coverage.status = 'unknown'; }, source => { source.intents[0].scoreTime.beat = 999; }, source => { source.intents[0].scoreTime.epoch = 'foreign'; }]) {
      const f = fixture(); change(f.revoice); await reject(encodePhysicalTakeMidi({ revoice: f.revoice }, controls));
    }
    const f = fixture(); f.revoice.intents.splice(-1); f.revoice.intentCount--; await reject(encodePhysicalTakeMidi({ revoice: f.revoice }, controls), 'open semantic voices');
    await reject(encodePhysicalTakeMidi({ revoice: fixture().revoice, options: { origin: { epoch: fixture().clock.snapshot().timeline.currentEpoch, simTick: 11 } } }, controls), 'inside the declared crop');
  });
  it('cancels between bounded lowering slices without a published byte file', async () => {
    const f = fixture(), intents = [];
    for (let index = 0; index < 128; index++) intents.push(f.intent('begin', 10, 'voice-' + index), f.intent('end', 10, 'voice-' + index));
    f.revoice.intents = intents; f.revoice.intentCount = intents.length; const controller = new AbortController(); let slices = 0;
    await reject(encodePhysicalTakeMidi({ revoice: f.revoice }, { ...controls, signal: controller.signal, yieldControl: async () => { slices++; controller.abort(new Error('physical source replaced')); } }), 'physical source replaced'); expect(slices).to.equal(1);
  });
  it('reads a finalized journal revision through the production owned semantic source and admitted worker', async () => {
    const f = fixture(), { storage } = createMemoryCausalStore(), budget = createResourceBudget(), jobs = createTestBackgroundJobs();
    const journal = createProcgenCausalJournal({ storage, resourceBudget: budget, jobs }), recorder = await createCausalTakeRecorder({ journal, takeId: 'physical-midi', documentId: 'doc', sourceVersions: { source: 1 },
      mapping: { version: 1, revision: 1, instruments: [] }, initialCheckpoint: { tick: 0 }, boundaryState: f.revoice.boundary.state });
    for (let tick = 1; tick <= 30; tick++) recorder.recordCommittedBatch({ batch: { version: 1, worldId: 'source', generation: 1, tick, batchId: 'batch-' + tick, facts: [], completeness: { status: 'complete', dropped: 0 } },
      intents: f.revoice.intents.filter(intent => intent.scoreTime.simTick === tick) });
    await recorder.stop({ boundaryState: f.revoice.finalBoundaryState }); let source, result;
    try {
      source = await querySoundOnlyRevoiceOwned({ journal, resourceBudget: budget, jobs, takeId: 'physical-midi', soundPatch: { id: 'midi1', revision: 1 }, executionEpoch: 'export-test', maxIntents: 8192 });
      result = await jobs.compute({ kind: 'encode-physical-take-midi', ownerId: 'physical-midi', ownerEpoch: 1, sourceRevision: source.value.sourceCanonicalHash, inputBytes: 4 * 1048576,
        estimatedPeakBytes: controls.estimatedPeakBytes, budgetAdapter: budget, prepareInput: () => ({ revoice: source.value }) });
      expect(result.value.manifest.lowering.begins).to.equal(3); expect(result.receipt.method).to.equal('dedicated-worker');
      expect(result.receipt.outputTransport.ownedTransferredBytes).to.equal(result.value.bytes.length);
    } finally { result?.release(); source?.release(); jobs.dispose(); }
  });
});
