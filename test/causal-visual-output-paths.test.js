import { expect } from 'chai';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createSimScoreTimeline } from '../js/app/procgen/workstation/SimScoreTimeline.js';
import { createCausalIntentDispatcher } from '../js/app/procgen/workstation/CausalIntentDispatcher.js';
import { createCausalMidiSink } from '../js/app/procgen/workstation/CausalMidiSink.js';
import { createProcgenMidiPorts } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createLaneDisplayEvidence } from '../js/app/procgen/workstation/LaneDisplayEvidence.js';
import { createLaneDisplaySnapshot } from '../js/app/procgen/workstation/LaneDisplaySnapshot.js';
import { projectCausalHistory, explainCausalVisual } from '../js/app/procgen/workstation/CausalVisualProjection.js';
import { makeOutput } from './support/midi-output.js';
import { withFakeClockAndPerformance } from './support/timers.js';

function fixture(clock, { policy = 'carry', available = true, maxVoices = 8 } = {}) {
  const lanes = [{ id: 'lane-1', name: 'Origin', channel: 1, mode: 'physical', gain: 1 }, { id: 'lane-2', name: 'Destination', channel: 2, mode: 'physical', gain: 1 }], sourceKey = 'document:binding:1', calls = [];
  const store = createLaneDisplayEvidence({ historyTicks: 4 }), ports = createProcgenMidiPorts({ now: () => clock.now }), output = makeOutput([1, 2, 3], calls, 'device');
  ports.setNoteOutputs([output]); ports.setNoteOutput(output); calls.length = 0; store.setLanes(lanes.map(lane => lane.id));
  const timeline = createSimScoreTimeline({ epoch: 'producer-score', simTickOrigin: 0, scoreBeatOrigin: 0, tickDurationMs: 40, tempoBpm: 120 });
  let buffer = null, provenances = [], tick = 0;
  const onReceipt = receipt => { if (buffer) buffer.push(receipt); else store.receipt(sourceKey, receipt); };
  const engine = createCausalMusicEngine({ getGraph: () => ({ version: 1, revision: 3, instruments: [{ id: 'held', sourceKind: 'ActionEntered', pitchCents: 6000, velocity01: 0.75, route: 'local', role: 'held', actionVoicePolicy: { matchActions: ['floating'] }, voiceTransfer: { policy } }] }), scoreTimeline: timeline,
    getLaneState: () => ({ available }), onIntentProvenance: value => provenances.push(value) });
  const sink = createCausalMidiSink({ ports, getLanes: () => lanes, isEnabled: () => true, now: () => clock.now, maxVoices, onReceipt });
  const dispatcher = createCausalIntentDispatcher({ sinks: sink.sinks, executionEpoch: () => 'execution', toTargetFrame: (time, batch, intent, target) => target.toTargetFrame(time), latePolicy: context => context.sink.latePolicy(context), onReceipt });
  const consume = (facts, { missing = false, dropped = 0 } = {}) => {
    tick++; const batch = { version: 1, worldId: 'world', generation: 1, batchId: 'batch-' + tick, tick, sourceTimeMs: tick * 40, tickDurationMs: 40, completeness: { status: dropped ? 'incomplete' : 'complete', dropped },
      facts: facts.map((fact, index) => ({ actorId: 7, laneId: 0, eventId: `event-${tick}-${index}`, causalSequence: tick * 100 + index, positionAfter: { x: 20 + index, y: 20 }, ...fact })) };
    buffer = []; provenances = []; sink.observe(timeline.map({ simTick: tick }), { bpm: 120, executionEpoch: 'execution' });
    const intents = engine.processBatch(batch); dispatcher.dispatch(intents, batch);
    store.observe({ sourceKey, batch: missing ? { ...batch, facts: [] } : batch, intents, receipts: buffer, provenances, lanes }); buffer = null; return { batch, intents };
  };
  const displays = () => lanes.map((lane, index) => ({ lane, mix: { mute: index === 1, soloSuppressed: false, revision: 9 }, evidence: store.read(lane.id, sourceKey) }));
  const model = () => projectCausalHistory({ displays: displays() });
  const snapshot = index => createLaneDisplaySnapshot({ ...displays()[index], page: 'output' });
  const dispose = () => { dispatcher.dispose(); sink.dispose(); ports.dispose(); engine.dispose(); store.dispose(); };
  return { store, lanes, calls, consume, model, snapshot, dispatcher, dispose };
}
const entered = (actorId = 7) => ({ kind: 'ActionEntered', action: 'floating', actionInstanceId: 'action-' + actorId, actorId });
const transferred = () => ({ kind: 'ActorLaneTransferred', actorId: 7, previousLaneId: 0, laneId: 1, positionAfter: { x: 25, y: 120 } });

describe('canonical producer through output ownership into causal explanations', () => {
  for (const policy of ['carry', 'revoice', 'releaseAndAttack', 'silentHandoff']) it(`retains exact ${policy} transfer ownership, producer time and target mix`, () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock, { policy });
    try {
      const initial = f.consume([entered()]); clock.tick(40); const result = f.consume([transferred()]); clock.tick(24);
      expect(result.intents.map(intent => intent.kind)).to.deep.equal(policy === 'carry' ? ['update'] : policy === 'silentHandoff' ? ['end'] : ['end', 'begin']);
      const cause = f.model().causes.find(cause => cause.eventId === result.batch.facts[0].eventId); expect(cause).to.include({ actorId: 7, laneIndex: 1 });
      const index = cause.intents.findIndex(event => event.kind === (policy === 'carry' ? 'update' : policy === 'silentHandoff' ? 'end' : 'begin')), event = cause.intents[index], text = explainCausalVisual(cause, index);
      expect(event.scoreTime).to.include({ epoch: 'producer-score', simTick: 2, subTick: 0, beat: 0.16, sourceTimeMs: 80, sourceTickDurationMs: 40 }); expect(event).to.include({ graphRevision: 3, mappingRevision: 3, actorId: 7, laneId: 'lane-2' });
      expect(text).to.include('target lane lane-2').and.include('Current lane mix: muted; target lane-2; mix revision 9').and.include('simulation tick 2 + 0; beat 0.16').and.include('API submission is not acoustic evidence');
      if (policy !== 'silentHandoff') { expect(event.transfer).to.include({ policy, previousLaneId: 0, laneId: 1, previousVoiceId: initial.intents[0].voiceId }); expect(text).to.include('Source transfer: ' + policy); }
      if (policy === 'revoice') { expect(event.voiceTransition.fromVoiceId).to.equal(initial.intents[0].voiceId); expect(text).to.include('Applied crossfade/render evidence remains separate'); expect(event.voiceId).not.to.equal(initial.intents[0].voiceId); }
      if (policy !== 'carry') expect(cause.intents.find(event => event.kind === 'end').terminationReason).to.equal('voice-transfer');
      expect(f.snapshot(1).detail).to.include('producer-score').and.include('Source coverage: complete');
    } finally { f.dispose(); }
  }));
  it('retains a destination-unavailable termination without inventing a replacement voice or borrowing current controls', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock, { policy: 'revoice', available: false });
    try { const first = f.consume([entered()]); clock.tick(40); const result = f.consume([transferred()]); expect(result.intents.map(intent => intent.kind)).to.deep.equal(['end']);
      const cause = f.model().causes.find(cause => cause.eventId === result.batch.facts[0].eventId); expect(cause.intents[0]).to.include({ voiceId: first.intents[0].voiceId, terminationReason: 'transfer-destination-unavailable' }); expect(cause.suppressed).to.equal(true); expect(explainCausalVisual(cause)).to.include('Producer suppression: transfer-destination-unavailable'); expect(f.snapshot(1)).to.include({ evidenceClass: 'suppressed', glyph: '∅' });
    } finally { f.dispose(); }
  }));
  it('keeps an actual owned-voice budget rejection separate from the other actor driver submission', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock, { maxVoices: 1 });
    try { const { intents } = f.consume([entered(7), entered(9)]); expect(intents).to.have.length(2); clock.tick(24); const causes = f.model().causes;
      expect(causes.map(cause => cause.outcome)).to.deep.equal(['api-submitted', 'rejected']); expect(f.calls.filter(call => call.type === 'noteOn')).to.have.length(1);
      const text = explainCausalVisual(causes[1]); expect(text).to.include('causal-midi-voice-capacity').and.include(intents[1].intentId).and.include('target 24000 performance-microseconds').and.include('voice owner actor 9').and.include('individual eligibility receipt unrecorded');
      expect(explainCausalVisual(causes[0])).to.include('Receiver/measured sink: unrecorded');
    } finally { f.dispose(); }
  }));
  for (const submitted of [false, true]) it(`shows ${submitted ? 'API release after driver submission' : 'queued cancellation'} with exact original ownership and no receiver inference`, () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock);
    try { const { intents } = f.consume([entered()]); if (submitted) clock.tick(24); f.dispatcher.cancelGeneration(1); clock.tick(100);
      const outcome = submitted ? 'api-release-submitted' : 'cancelled', cause = f.model().causes[0]; expect(cause.outcome).to.equal(outcome); expect(cause.intents[0].voiceId).to.equal(intents[0].voiceId); expect(f.calls.filter(call => call.type === 'noteOn')).to.have.length(submitted ? 1 : 0);
      const snapshot = f.snapshot(0); expect(snapshot).to.include({ evidenceClass: outcome, glyph: submitted ? '↘' : '⊘' }); expect(snapshot.bottom).to.include(submitted ? 'MIDI release API submitted; receiver unknown' : 'Cancelled:'); expect(explainCausalVisual(cause)).to.include('Admission/scheduling: ' + outcome).and.include('physical-execution-retired').and.include('API submission is not acoustic evidence'); if (submitted) expect(f.calls.filter(call => call.type === 'noteOff')).to.have.length(1);
    } finally { f.dispose(); }
  }));
  it('keeps an observer-missing physical trace explicit after actual driver submission, then expires the retained reference', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock);
    try { f.consume([entered()], { missing: true }); clock.tick(24); const cause = f.model().causes[0]; expect(cause).to.include({ recorded: false, actorId: null, point: null, outcome: 'api-submitted' });
      expect(explainCausalVisual(cause)).to.include('reference only; fact not retained').and.include('Source coverage: complete; producer reports 0 dropped facts').and.include('no nearest-actor fallback').and.include('Missing trace is not evidence');
      for (let tick = 0; tick < 5; tick++) f.consume([]); expect(f.model().causes).to.have.length(0); expect(f.store.read(f.lanes[0].id, 'document:binding:1').historyExpired).to.equal(1);
    } finally { f.dispose(); }
  }));
  it('retains an actual incomplete-source recovery end as an unrooted intent instead of inventing a physical event or losing its reason', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock);
    try { f.consume([entered()]); clock.tick(24); const result = f.consume([], { dropped: 5 }); clock.tick(24); expect(result.intents).to.have.length(1);
      const model = f.model(), reference = model.causes.find(cause => cause.referenceKind === 'intent-only'); expect(model.summary.unrooted).to.equal(1); expect(reference).to.include({ eventId: null, recorded: false, actorId: null, point: null }); expect(reference.intents[0]).to.include({ kind: 'end', terminationReason: 'incomplete-source' });
      const text = explainCausalVisual(reference); expect(text).to.include('unrooted intent reference; no physical event is invented').and.include('Source coverage: incomplete; producer reports 5 dropped facts').and.include('termination incomplete-source'); expect(f.snapshot(0).detail).to.include('reports 5 dropped facts');
    } finally { f.dispose(); }
  }));
});
