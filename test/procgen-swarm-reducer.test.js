import { expect } from 'chai';
import { createSwarmReducer, validateSwarmReducer, SWARM_REDUCER_LIMITS } from '../js/app/procgen/workstation/physical/SwarmReducer.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
const policy = (representation = 'densityCloud', extra = {}) => ({ version: 1, representation, groupBy: ['cohort'], maxVoices: 64, windowInSimTime: 54, priorityRules: [{ match: { role: 'accent' }, priority: 100 }], ...extra });
const actors = Array.from({ length: 4096 }, (_, actorId) => ({ actorId, laneId: actorId % 1024, x: actorId % 128, y: 0, action: 'walking', birthCohortId: `c:${actorId % 128}` }));
const batch = (tick, population = actors) => ({ version: 1, worldId: 'world', generation: 1, batchId: `b:${tick}`, tick, sourceTimeMs: tick * 17, tickDurationMs: 17, completeness: { status: 'complete', dropped: 0 }, snapshot: { actors: population, revision: tick }, facts: [] });
const intent = (actorId, tick = 1, kind = 'begin', extra = {}) => ({ version: 1, intentId: `i:${tick}:${actorId}:${kind}`, voiceId: `voice:${actorId}`, onsetId: `voice:${actorId}`, worldId: 'world', generation: 1, batchId: `b:${tick}`, kind, actorId, laneId: actorId % 1024, route: 'local', mappingId: 'strikes', role: actorId === 4095 ? 'accent' : 'texture', sourceEventIds: [`event:${tick}:${actorId}`], physicalSourceKind: 'ContactResolved', scoreTime: { simTick: tick, subTick: 0 }, pitch: { cents: 4800 + actorId % 24 * 100, referenceHz: 440 }, velocity01: 0.6, expression: {}, ...(kind === 'end' ? { terminationReason: 'one-shot' } : {}), ...extra });
const strikes = tick => actors.flatMap(actor => [intent(actor.actorId, tick), intent(actor.actorId, tick, 'end')]);
const make = config => { const reducer = createSwarmReducer(); reducer.configure(config); return reducer; };
const auditOwnership = (live, output) => { for (const item of output) { if (item.kind === 'begin') { expect(live.has(item.voiceId)).to.equal(false); live.add(item.voiceId); } else if (item.kind === 'end') { expect(live.has(item.voiceId)).to.equal(true); live.delete(item.voiceId); } else expect(live.has(item.voiceId)).to.equal(true); } };
describe('semantic swarm reduction before backend capacity', () => {
  it('rejects unbounded windows, nondeterministic choices and executable salience', () => {
    for (const value of [policy('unknown'), policy('individual', { maxVoices: 0 }), policy('densityCloud', { windowInSimTime: 601 }), policy('densityCloud', { groupBy: ['callback'] }), policy('densityCloud', { priorityRules: [{ match: { code: 'eval' }, priority: 1 }] })]) expect(() => validateSwarmReducer(value)).to.throw();
  });
  for (const representation of ['individual', 'centroidChord', 'densityCloud', 'representativeStrikes']) it(`represents 4096 strikes over 1024 lanes deterministically within 64 voices: ${representation}`, () => {
    const config = policy(representation), a = make(config), b = make(config), source = batch(1), raw = strikes(1), before = JSON.stringify(source), left = a.reduce(source, raw), right = b.reduce({ ...source, snapshot: { ...source.snapshot, actors: [...actors].reverse() } }, [...raw].reverse());
    expect(right).to.deep.equal(left); expect(left.intents.filter(value => value.kind === 'begin')).to.have.length.at.most(64); expect(left.summary.requestedEventCount).to.equal(4096); expect(left.summary.rawFactsModified).to.equal(false); expect(JSON.stringify(source)).to.equal(before); expect(left.intents.filter(value => value.kind === 'begin').some(value => value.role === 'accent')).to.equal(true); expect(a.snapshot().audible).to.have.length(0);
    if (representation !== 'individual') expect(left.intents.every(value => value.swarm.exactIndividualReplay === false)).to.equal(true);
  });
  it('uses source group fairness rather than input order while preserving authored structural priority', () => {
    const reducer = make(policy('representativeStrikes', { groupBy: ['lane'], maxVoices: 64 })), coverage = new Set();
    for (let tick = 1; tick <= 32; tick++) { const result = reducer.reduce(batch(tick), strikes(tick)); for (const item of result.intents.filter(value => value.kind === 'begin')) coverage.add(item.laneId); expect(result.summary.fallbackReasons).to.include('group-capacity'); }
    expect(coverage.size).to.equal(1024); expect(reducer.snapshot().groups.length).to.be.at.most(SWARM_REDUCER_LIMITS.groups);
  });
  it('ends individual owners before aggregate handover and retains exact end ownership when reduction is disabled', () => {
    const reducer = make(policy('individual', { groupBy: ['role'], maxVoices: 4 })), live = new Set();
    auditOwnership(live, reducer.reduce(batch(1), [intent(1), intent(2)]).intents); expect(live.size).to.equal(2);
    reducer.configure(policy('densityCloud', { groupBy: ['role'], maxVoices: 4 })); const aggregate = reducer.reduce(batch(2), []); auditOwnership(live, aggregate.intents); expect(live.size).to.equal(1); expect(aggregate.intents.filter(value => value.kind === 'begin')[0].swarm.handover).to.equal(true);
    reducer.configure(null); auditOwnership(live, reducer.reduce(batch(3), []).intents); expect(live.size).to.equal(2);
    auditOwnership(live, reducer.reduce(batch(4), [intent(1, 4, 'end'), intent(2, 4, 'end')]).intents); expect(live.size).to.equal(0); expect(reducer.snapshot().held).to.have.length(0);
  });
  it('does not resurrect an omitted held voice just because a slot opens', () => {
    const reducer = make(policy('individual', { groupBy: ['role'], maxVoices: 1 })); const first = reducer.reduce(batch(1), [intent(1), intent(2)]); expect(first.intents.filter(value => value.kind === 'begin')).to.have.length(1);
    const ended = reducer.reduce(batch(2), [intent(1, 2, 'end')]); expect(ended.intents.filter(value => value.kind === 'begin')).to.have.length(0); expect(reducer.reduce(batch(3), []).intents).to.have.length(0);
    const last = reducer.reduce(batch(4), [intent(2, 4, 'end')]); expect(last.summary.lifecycleEnds).to.equal(1); expect(reducer.snapshot().held).to.have.length(0);
  });
  it('keeps the aggregate alive until its last physical source ends and sends pitch expression, not an old physical-control cause', () => {
    const reducer = make(policy('densityCloud', { groupBy: ['role'] })), live = new Set(); auditOwnership(live, reducer.reduce(batch(1), [intent(1, 1, 'begin', { performanceCause: { kind: 'ContactResolved' } }), intent(2)]).intents);
    const changed = reducer.reduce(batch(2), [intent(1, 2, 'update', { expression: { pitchOffsetCents: 50 } })]); auditOwnership(live, changed.intents); expect(changed.intents[0].performanceCause).to.equal(undefined); expect(changed.intents[0].expression.pitchOffsetCents).to.be.a('number');
    auditOwnership(live, reducer.reduce(batch(3), [intent(1, 3, 'end')]).intents); expect(live.size).to.equal(1); auditOwnership(live, reducer.reduce(batch(4), [intent(2, 4, 'end')]).intents); expect(live.size).to.equal(0);
  });
  it('restores pending policy boundaries, bounded windows and live ownership without aliasing the snapshot', () => {
    const config = policy(), a = make(config), initial = a.snapshot(), b = make(config); b.restore(initial); expect(b.reduce(batch(1), [intent(1)])).to.deep.equal(a.reduce(batch(1), [intent(1)]));
    const saved = a.snapshot(), c = make(config); c.restore(saved); expect(c.reduce(batch(2), [intent(1, 2, 'end')])).to.deep.equal(a.reduce(batch(2), [intent(1, 2, 'end')])); expect(saved.held).to.have.length(1);
    const bad = JSON.parse(JSON.stringify(saved)); bad.audible[0][1].members = ['unowned']; expect(() => c.restore(bad)).to.throw(); expect(c.snapshot().held).to.have.length(0);
  });
  it('retires rolling groups after the simulation window, not wall-clock lifetime', () => {
    const reducer = make(policy('representativeStrikes', { groupBy: ['cohort'], windowInSimTime: 3 }));
    for (let tick = 1; tick <= 2000; tick++) reducer.reduce(batch(tick, [{ ...actors[0], birthCohortId: `epoch:${tick}` }]), [intent(0, tick), intent(0, tick, 'end')]);
    expect(reducer.snapshot().groups.length).to.be.at.most(3); for (let tick = 2001; tick <= 2004; tick++) reducer.reduce(batch(tick, []), []); expect(reducer.snapshot().groups).to.have.length(0); expect(reducer.snapshot().audible).to.have.length(0);
  });
  it('keeps disabled-mode audible ownership within the continuation limit', () => {
    const reducer = make(null), result = reducer.reduce(batch(1), actors.slice(0, 1024).map(actor => intent(actor.actorId)));
    expect(result.summary.fallbackReasons).to.include('disabled-owner-capacity'); expect(reducer.snapshot().audible.length).to.be.at.most(512);
    const restored = make(null); restored.restore(reducer.snapshot()); expect(restored.snapshot()).to.deep.equal(reducer.snapshot());
  });
  it('leaves raw facts intact and captures the same semantic decisions when the delivery backend fails', () => {
    const graph = { version: 1, revision: 1, swarm: policy('densityCloud', { groupBy: ['cohort'] }), instruments: [{ id: 'contacts', sourceKind: 'ContactResolved', pitchCents: 6000, velocity01: 0.6, route: 'local', role: 'texture' }] }, a = createCausalMusicEngine({ getGraph: () => graph }), b = createCausalMusicEngine({ getGraph: () => graph, deliver() { throw new Error('backend rejected'); } });
    const source = batch(1); source.facts = actors.map((actor, index) => ({ kind: 'ContactResolved', actorId: actor.actorId, laneId: actor.laneId, causeKind: 'wall', eventId: `e:${index}`, causalSequence: index + 1 })); const reference = source.facts, before = JSON.stringify(source);
    expect(b.processBatch(source)).to.deep.equal(a.processBatch(source)); expect(a.physicalAnalysis().swarm.requestedEventCount).to.equal(4096); expect(a.physicalAnalysis().swarm.emittedVoices).to.equal(64); expect(source.facts).to.equal(reference); expect(JSON.stringify(source)).to.equal(before);
  });
});
