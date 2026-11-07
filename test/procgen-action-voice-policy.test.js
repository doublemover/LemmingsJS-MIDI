import { expect } from 'chai';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { validateActionVoicePolicy } from '../js/app/procgen/workstation/physical/ActionVoicePolicy.js';
import { validVoiceTransition, transitionAttackSeconds } from '../js/app/midi-ui/VoiceTransition.js';
import { createCausalIntentDispatcher } from '../js/app/procgen/workstation/CausalIntentDispatcher.js';

const batch = (tick, facts) => ({ version: 1, worldId: 'scene', generation: 1, tick, batchId: `scene:1:${tick}`, completeness: { status: 'complete', dropped: 0 },
  facts: facts.map((fact, index) => ({ actorId: 7, laneId: 0, eventId: `event:${tick}:${index}`, causalSequence: tick * 100 + index, ...fact })) });
const entry = (action, actionInstanceId) => ({ kind: 'ActionEntered', action, actionInstanceId });
const exit = (action, actionInstanceId) => ({ kind: 'ActionExited', action, actionInstanceId });
const graph = (policy = {}, voiceTransfer = null) => ({ version: 1, revision: 1, instruments: [{ id: 'voice', sourceKind: 'ActionEntered', pitchCents: 6000, velocity01: 0.8, route: 'local', role: 'held',
  actionVoicePolicy: { matchActions: ['falling', 'floating', 'walking', 'blocking'], ...policy }, ...(voiceTransfer ? { voiceTransfer } : {}) }] });

describe('actor-owned action voice policies', () => {
  it('matches actual shared action names without changing physical facts or accepting countdown as an action', () => {
    expect(validateActionVoicePolicy({ matchActions: ['walk', 'hoist', 'jump', 'shrugging', 'oh-no', 'splatter', 'exiting'] }).matchActions).to.deep.equal(['walking', 'hoisting', 'jumping', 'shrug', 'ohno', 'splatting', 'exiting']);
    expect(() => validateActionVoicePolicy({ matchActions: ['walk', 'walking'] })).to.throw();
    expect(() => validateActionVoicePolicy({ matchActions: ['countdown'] })).to.throw();
  });
  it('holds one voice for 1000 static ticks then ends once at the declared safety bound', () => {
    const engine = createCausalMusicEngine({ getGraph: () => graph({ maximumHoldTicks: 1000 }) });
    const [start] = engine.processBatch(batch(1, [entry('blocking', 'block:7')])); expect(start.kind).to.equal('begin');
    for (let tick = 2; tick <= 1000; tick++) expect(engine.processBatch(batch(tick, []))).to.have.length(0);
    const end = engine.processBatch(batch(1001, [])); expect(end).to.have.length(1); expect(end[0]).to.include({ kind: 'end', voiceId: start.voiceId, terminationReason: 'maximum-hold' });
    expect(engine.processBatch(batch(1002, []))).to.have.length(0);
  });
  it('keeps immutable onset identity across explicit legato action transitions', () => {
    const current = graph({ transitionPolicy: 'legato' }), engine = createCausalMusicEngine({ getGraph: () => current });
    const [first] = engine.processBatch(batch(1, [entry('falling', 'fall:7')]));
    const next = engine.processBatch(batch(2, [exit('falling', 'fall:7'), entry('floating', 'float:7')]));
    expect(next.map(intent => intent.kind)).to.deep.equal(['update']); expect(next[0]).to.include({ voiceId: first.voiceId, onsetId: first.onsetId, actionInstanceId: 'float:7' });
    const restored = createCausalMusicEngine({ getGraph: () => current }); restored.restore(engine.snapshot());
    const landing = batch(3, [exit('floating', 'float:7'), entry('walking', 'walk:7')]); expect(restored.processBatch(landing)).to.deep.equal(engine.processBatch(landing));
  });
  it('does not admit a motion-gated voice from assignment alone and preserves its pending cause on restore', () => {
    const current = graph({ beginCondition: 'motion' }), engine = createCausalMusicEngine({ getGraph: () => current });
    expect(engine.processBatch(batch(1, [entry('walking', 'walk:7')]))).to.have.length(0);
    const restored = createCausalMusicEngine({ getGraph: () => current }); restored.restore(engine.snapshot());
    const source = batch(2, [{ kind: 'MotionCommitted', actionInstanceId: 'walk:7', positionBefore: { x: 0, y: 0 }, positionAfter: { x: 1, y: 0 }, physicalPayload: { displacementPixels: 1 } }]);
    const result = engine.processBatch(source); expect(restored.processBatch(source)).to.deep.equal(result); expect(result).to.have.length(1);
    expect(result[0].sourceEventIds).to.deep.equal(['event:1:0', 'event:2:0']);
  });
  it('crossfades actual action owners with declared attack/release seconds, not a fake new physical event', () => {
    const engine = createCausalMusicEngine({ getGraph: () => graph({ transitionPolicy: 'crossfade', crossfadeSeconds: 0.2 }) });
    const [first] = engine.processBatch(batch(1, [entry('falling', 'fall:7')]));
    const result = engine.processBatch(batch(2, [exit('falling', 'fall:7'), entry('floating', 'float:7')]));
    expect(result.map(intent => intent.kind)).to.deep.equal(['end', 'begin']); expect(result[1].voiceId).not.to.equal(first.voiceId);
    expect(result.every(intent => intent.voiceTransition.seconds === 0.2 && intent.voiceTransition.fromVoiceId === first.voiceId)).to.equal(true);
    expect(transitionAttackSeconds(result[1], 0.01)).to.equal(0.2); expect(validVoiceTransition({ kind: 'crossfade', seconds: NaN, fromVoiceId: 'x' })).to.equal(false);
    const ends = [], dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'sink', route: 'local', backend: { begin: () => ({ status: 'accepted' }), end: (...args) => { ends.push(args); return { status: 'accepted' }; } } }], toTargetFrame: () => 100 });
    dispatcher.dispatch(result, { generation: 1, batchId: 'test' }); expect(ends[0][1]).to.include({ seconds: 0.2, transitionPolicy: 'crossfade' });
  });
  it('bounds changed expression updates independently for same-pitch actor voices', () => {
    const policy = { updateEveryTicks: 2, expressionDeadband: 0.1, expressionMappings: [{ source: 'displacementPixels', target: 'pressure01', scale: 0.1 }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph(policy) }); engine.processBatch(batch(1, [entry('walking', 'walk:7'), { ...entry('walking', 'walk:8'), actorId: 8 }]));
    const motion = actorId => ({ kind: 'MotionCommitted', actorId, physicalPayload: { displacementPixels: 2 }, positionAfter: { x: 2, y: 0 } });
    expect(engine.processBatch(batch(2, [motion(7), motion(8)])).filter(intent => intent.kind === 'update')).to.have.length(2);
    expect(engine.processBatch(batch(3, [motion(7), motion(8)]))).to.have.length(0);
    const terminated = engine.processBatch(batch(4, [{ kind: 'ActorTerminated', actorId: 7, terminationReason: 'removed' }])); expect(terminated).to.have.length(1); expect(engine.snapshot().active[0].actorId).to.equal(8);
  });
  for (const policy of ['carry', 'revoice', 'releaseAndAttack', 'silentHandoff']) it(`applies ${policy} at one actual destination transfer without reusing actor identity`, () => {
    const engine = createCausalMusicEngine({ getGraph: () => graph({}, { policy }), getLaneState: () => ({ available: true }) });
    const [first] = engine.processBatch(batch(1, [entry('floating', 'float:7')]));
    const result = engine.processBatch(batch(2, [{ kind: 'ActorLaneTransferred', actorId: 7, previousLaneId: 0, laneId: 1, birthLaneId: 0 }]));
    expect(result.map(intent => intent.kind)).to.deep.equal(policy === 'carry' ? ['update'] : policy === 'silentHandoff' ? ['end'] : ['end', 'begin']);
    if (policy === 'carry') expect(engine.snapshot().active[0]).to.include({ voiceId: first.voiceId, laneId: 1 });
    else if (policy !== 'silentHandoff') expect(result[1].articulationState.transfer.previousVoiceId).to.equal(first.voiceId);
    expect(engine.processBatch(batch(3, [{ kind: 'ActorLaneTransferred', actorId: 7, previousLaneId: 0, laneId: 1 }]))).to.have.length(0);
  });
  it('silences a muted or missing destination and rejects malformed restores without changing active state', () => {
    const current = graph({}, { policy: 'revoice' }), engine = createCausalMusicEngine({ getGraph: () => current, getLaneState: () => ({ available: false }) });
    engine.processBatch(batch(1, [entry('floating', 'float:7')])); const before = engine.snapshot(), invalid = structuredClone(before); invalid.actionAdmission.version = 99;
    expect(() => engine.restore(invalid)).to.throw(); expect(engine.snapshot()).to.deep.equal(before);
    expect(engine.processBatch(batch(2, [{ kind: 'ActorLaneTransferred', laneId: 1 }])).map(intent => intent.kind)).to.deep.equal(['end']);
    expect(engine.snapshot().active).to.have.length(0);
    expect(() => validateActionVoicePolicy({ matchActions: ['walking'], expressionMappings: [{ source: 'wall-clock', target: 'pressure01' }] })).to.throw();
  });
});
