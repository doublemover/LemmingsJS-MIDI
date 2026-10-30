import { expect } from 'chai';
import { createRhythmicResponses, validateRhythmicResponse } from '../js/app/procgen/workstation/physical/RhythmicResponses.js';

const environment = { membership: () => ({ status: 'complete', includes: true }), routeCoordinate: () => null };
const instrument = (mode = 'delayed-response') => ({ id: 'crowd', sourceKind: 'CrowdArrival', pitchCents: 6000, velocity01: 0.8, response: validateRhythmicResponse({ type: 'crowdInterval', pickupId: 'gate', mode }, 'CrowdArrival') });
const batch = tick => ({ worldId: 'world', generation: 1, tick, batchId: 'batch:' + tick, facts: [], snapshot: { actors: [{ actorId: 1, laneId: 0, x: 40, y: 80 }] } });
const crossing = { kind: 'PickupCrossing', gateId: 'gate', actorId: 1, laneId: 0, direction: 'positive', fraction: 1, eventId: 'motion:1', observationId: 'pickup:1', causalSequence: 1, sourceEventIds: ['motion:1'] };
describe('bounded crowd response presentation ownership', () => {
  it('validates mode, finite delay and fold reference without changing the literal default', () => {
    expect(validateRhythmicResponse({ type: 'crowdInterval', pickupId: 'gate' }, 'CrowdArrival').mode).to.equal('literal-arrival');
    for (const invalid of [{ mode: 'pattern' }, { delayTicks: -1 }, { delayTicks: Infinity }, { delayTicks: 4097 }, { foldReferenceTicks: 0 }, { foldReferenceTicks: NaN }]) expect(() => validateRhythmicResponse({ type: 'crowdInterval', pickupId: 'gate', ...invalid }, 'CrowdArrival')).to.throw();
  });
  it('retains pending physical causes across saved state and releases the same future response', () => {
    const response = createRhythmicResponses(); response.configure([instrument()]); expect(response.expand(batch(1), [crossing], environment).facts).to.have.length(0);
    const restored = createRhythmicResponses(); restored.configure([instrument()]); restored.restore(JSON.parse(JSON.stringify(response.snapshot())));
    for (let tick = 2; tick <= 9; tick++) expect(restored.expand(batch(tick), [], environment)).to.deep.equal(response.expand(batch(tick), [], environment));
    expect(restored.diagnostics().pendingResponses).to.equal(0);
  });
  it('rejects malformed pending ownership transactionally and refuses legacy delayed state', () => {
    const response = createRhythmicResponses(); response.configure([instrument()]); response.expand(batch(1), [crossing], environment); const before = response.snapshot();
    for (const mutate of [value => { value.pending[0].dueTick = 1; }, value => { value.pending[0].bytes++; }, value => { value.pending[0].instrumentId = 'foreign'; }, value => { value.pending[0].fact.actorId = -1; }, value => { value.pending[0].fact.sourceEventIds = []; }, value => { value.pending[0].fact.responsePresentationTime.simTick++; }, value => { value.pending.push(value.pending[0]); }, value => { value.currentTick = -2; }, value => { value.version = 1; }]) {
      const changed = JSON.parse(JSON.stringify(before)); mutate(changed); expect(() => response.restore(changed)).to.throw(); expect(response.snapshot()).to.deep.equal(before);
    }
  });
  it('reports capacity and invalidates pending responses only for changed instrument ownership or epoch', () => {
    const full = createRhythmicResponses({ maxPending: 0 }); full.configure([instrument()]); expect(full.expand(batch(1), [crossing], environment).completeness.reason).to.equal('crowd-response-pending-capacity');
    const response = createRhythmicResponses(); response.configure([instrument()]); response.expand(batch(1), [crossing], environment); response.configure([instrument('literal-arrival')]); expect(response.snapshot().pending).to.have.length(0);
    response.configure([instrument()]); response.expand(batch(2), [crossing], environment); response.expand({ ...batch(3), generation: 2 }, [], environment); expect(response.snapshot().pending).to.have.length(0);
  });
});
