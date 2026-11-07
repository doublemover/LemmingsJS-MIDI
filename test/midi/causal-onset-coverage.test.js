import { expect } from 'chai';
import { createCausalOnsetCoverage, cropCausalOnsetCoverage } from '../../js/midi/content/CausalOnsetCoverage.js';

const source = { firstFrame: 100, frames: 1000, sampleRate: 48000, takeId: 'take:lesson', takeRevision: 3, sourceCanonicalHash: 'a'.repeat(64) };
const voice = (id, start, laneId = 0, count = 1) => ({ start, laneId, begin: { intentId: 'intent:' + id, worldId: 'world:lesson', generation: 7,
  sourceEventIds: Array.from({ length: count }, (_, index) => 'cause:' + id + ':' + index) } });
describe('bounded rendered semantic-onset coverage', () => {
  it('keeps exact source identity and local frame crops without labeling baked transients new causes', () => {
    const all = createCausalOnsetCoverage({ ...source, voices: [voice(1, 50), voice(2, 100), voice(3, 200), voice(4, 1099), voice(5, 1100)] });
    expect(all).to.include({ complete: true, total: 3, omitted: 0, frames: 1000 });
    expect(all.entries.map(entry => entry.frame)).to.deep.equal([0, 100, 999]);
    const crop = cropCausalOnsetCoverage(all, 100, 1000);
    expect(crop.entries.map(entry => [entry.intentId, entry.frame])).to.deep.equal([['intent:3', 0], ['intent:4', 899]]);
    expect(crop).to.include({ complete: true, total: 2, frames: 900, takeId: source.takeId, sourceCanonicalHash: source.sourceCanonicalHash });
    expect(all.entries).to.have.length(3);
  });
  it('keeps lane/panic boundaries and omitted lineage honest under the hard annotation budget', () => {
    const limited = createCausalOnsetCoverage({ ...source, voices: Array.from({ length: 20 }, (_, index) => voice(index, 100 + index)) });
    expect(limited.entries).to.have.length(16); expect(limited).to.include({ complete: false, total: 20, omitted: 4 });
    const crop = cropCausalOnsetCoverage(limited, 0, 1); expect(crop.complete).to.equal(false); expect(crop.omitted).to.equal(4);
    const lane = createCausalOnsetCoverage({ ...source, voices: [voice(1, 120, 0), voice(2, 150, 1), voice(3, 200, 1)], laneId: 1, panicFrame: 200 });
    expect(lane.entries.map(entry => entry.intentId)).to.deep.equal(['intent:2']);
    const missing = createCausalOnsetCoverage({ ...source, voices: [voice(1, 120, 0, 9)] });
    expect(missing).to.include({ complete: false, total: 1, omitted: 1 });
  });
  it('refuses substituted frame domains, duplicate source identities and nonfinite bounds', () => {
    const all = createCausalOnsetCoverage({ ...source, voices: [voice(1, 100)] });
    expect(() => cropCausalOnsetCoverage(all, 0, 1001)).to.throw('inventory');
    expect(() => cropCausalOnsetCoverage({ ...all, entries: [all.entries[0], all.entries[0]], total: 2 }, 0, 1000)).to.throw('inventory');
    expect(() => createCausalOnsetCoverage({ ...source, frames: NaN, voices: [] })).to.throw('inventory');
    expect(cropCausalOnsetCoverage(null, 0, 1000)).to.equal(null);
  });
});
