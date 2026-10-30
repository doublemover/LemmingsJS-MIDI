import { expect } from 'chai';
import { INSTRUMENT_VARIATION_ALGORITHM, validateInstrumentVariation } from '../../js/midi/content/InstrumentIdentityVariation.js';
import { captureInstrumentCause, compileInstrumentPerformance } from '../../js/midi/content/InstrumentPerformance.js';

const parameters = [{ id: 'color', min: 0, max: 8, default: 2, unit: 'dimensionless', discrete: false, liveSafe: false }];
const variation = () => ({ algorithmVersion: INSTRUMENT_VARIATION_ALGORITHM, seed: 731, identityScope: 'execution-birth', amount01: 1,
  targets: [{ id: 'actor-color', parameter: 'color', unit: 'ratio', composition: 'scale', amount: 0.1, factors: [{ id: 'sibling', weight: 1 }] }],
  eventTargets: [{ id: 'strike-color', parameter: 'color', unit: 'ratio', composition: 'scale', amount: 0.05, factors: [{ id: 'strike', weight: 1 }] }] });
const patch = () => ({ id: 'fixture', revision: 1, parameters: {}, macros: [], causalBindings: [], variation: variation() });
const identity = actorId => ({ worldId: 'fixture-world', generation: 1, actorId, onsetId: 'event-' + actorId });
describe('owned deterministic onset variation', () => {
  it('reconstructs 64 actor identities across order, lane, pool-slot and source serialization changes without a cache', () => {
    const plan = compileInstrumentPerformance(patch(), parameters), records = Array.from({ length: 64 }, (_, actorId) => identity(actorId));
    const original = new Map(records.map(record => [record.actorId, plan.resolve({}, 100, record)]));
    const restored = compileInstrumentPerformance(JSON.parse(JSON.stringify(patch())), parameters);
    for (const record of [...records].reverse()) {
      const next = restored.resolve({}, 100, { ...record, laneId: 'migrated', audioPoolSlot: 0 });
      expect(next).to.deep.equal(original.get(record.actorId)); expect(next.variation).to.include({ cacheEntries: 0, physicalRandomStateConsumed: false });
    }
    expect(new Set([...original.values()].map(result => result.values.color)).size).to.equal(64);
    const zero = plan.resolve({ variationAmount01: 0 }, 100); expect(zero.values.color).to.equal(2); expect(zero.deltas).to.have.length(0);
    expect(plan.resolve({ variationSeed: 732 }, 100, identity(1)).values.color).not.to.equal(original.get(1).values.color);
  });
  it('keeps same-actor latent identity across strikes and uses an explicit event-only fallback', () => {
    const source = patch(); source.variation.eventTargets = []; const plan = compileInstrumentPerformance(source, parameters);
    expect(plan.resolve({}, 0, identity(1)).values).to.deep.equal(plan.resolve({}, 0, { ...identity(1), onsetId: 'another-strike' }).values);
    const fallback = plan.resolve({}, 0, { onsetId: 'audition-fixture' }); expect(fallback.variation.identityScope).to.equal('event-only-fallback');
    expect(() => plan.resolve({}, 0)).to.throw('identity is required');
    const invalid = variation(); invalid.targets[0].factors.push({ id: 'extra', weight: 0.5 }); expect(() => validateInstrumentVariation(invalid, parameters)).to.throw('bounded range');
  });
  it('composes macros, identity and actual completed-fact inputs before final domain safety', () => {
    const source = patch(); source.causalBindings = [{ id: 'work', sourceKind: 'TerrainWorkCommitted', payloadField: 'changedSolidCells', target: 'color',
      unit: 'cells', inputMin: 0, inputMax: 8, outputUnit: 'ratio', outputMin: 1, outputMax: 2, curve: 'linear', composition: 'scale', mode: 'onset-only', smoothingMs: 0 }];
    const plan = compileInstrumentPerformance(source, parameters), actor = identity(2), without = plan.resolve({}, 100, actor);
    const cause = captureInstrumentCause({ kind: 'TerrainWorkCommitted', eventId: actor.onsetId, physicalPayload: { changedSolidCells: 8, energy: 9000, deviceId: 'private' } });
    expect(cause.values).to.have.keys(['changedSolidCells']);
    const withWork = plan.resolve({}, 100, { ...actor, performanceCause: cause }); expect(withWork.values.color).to.equal(without.values.color * 2);
    expect(withWork.deltas.map(delta => delta.origin)).to.deep.equal(['identity', 'event-variation', 'physical']);
    expect(without.bindingOutcomes[0].state).to.equal('no-qualified-source'); expect(withWork.bindingOutcomes[0].sourceUnit).to.equal('cells');
    const bad = patch(); bad.causalBindings = [{ ...source.causalBindings[0], payloadField: 'energy', unit: 'newtons' }]; expect(() => compileInstrumentPerformance(bad, parameters)).to.throw('completed-fact binding');
  });
});
