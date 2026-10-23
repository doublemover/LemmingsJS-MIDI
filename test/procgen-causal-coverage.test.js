import { expect } from 'chai';
import { createCausalCoverageIndex, queryCausalCoverage } from '../js/app/procgen/workstation/CausalCoverage.js';

describe('bounded causal coverage intervals', () => {
  const gap = (tick, patch = {}) => ({ kind: 'movement-path', generation: 1, reason: 'endpoint-only-evidence', firstTick: tick, lastTick: tick, ...patch });
  const query = (index, first, last, kind = 'movement-path') => queryCausalCoverage({ coverage: {
    sourceRange: { firstTick: 1, lastTick: 100 }, gaps: index.snapshot() }, range: { firstTick: first, lastTick: last }, kind });
  it('unions same-tick and interleaved overlapping intervals independently of actor count', () => {
    for (const actors of [1, 2, 2048]) {
      const index = createCausalCoverageIndex();
      for (let tick = 1; tick <= 3; tick++) for (let actor = 0; actor < actors; actor++) index.add(gap(tick));
      index.add(gap(2, { reason: 'other' })); index.add(gap(2));
      expect(index.snapshot()).to.have.length(2);
      expect(index.snapshot().find(item => item.reason === 'endpoint-only-evidence')).to.include({ firstTick: 1, lastTick: 3 });
      expect(query(index, 1, 3).status).to.equal('known-missing');
      expect(query(index, 1, 3, 'MotionCommitted').status).to.equal('known-covered');
    }
  });
  it('retains an unknown suffix across reason, kind and generation changes after capacity', () => {
    const index = createCausalCoverageIndex({ maxEntries: 3 });
    index.add(gap(1)); index.add(gap(3)); index.add(gap(5));
    index.add(gap(8, { generation: 2, kind: 'physical-facts', reason: 'incomplete-source-batch' }));
    index.add(gap(1));
    expect(index.diagnostics()).to.include({ entries: 3, truncated: true });
    expect(query(index, 4, 4, 'physical-facts').status).to.equal('known-covered');
    expect(query(index, 8, 8, 'physical-facts').status).to.equal('unknown');
    expect(query(index, 80, 90, 'MotionCommitted').status).to.equal('unknown');
    expect(index.snapshot().at(-1)).to.include({ firstTick: 5, throughTick: 8, generation: null });
  });
  it('does not strengthen legacy capacity markers or missing source-range evidence', () => {
    const coverage = { sourceRange: { firstTick: 1, lastTick: 10 },
      gaps: [{ kind: 'all', firstTick: 4, lastTick: 4, generation: 1, reason: 'coverage-index-capacity' }] };
    expect(queryCausalCoverage({ coverage, generation: 2, range: { firstTick: 5, lastTick: 5 } }).status).to.equal('unknown');
    expect(queryCausalCoverage({ coverage: { gaps: [] }, range: { firstTick: 1, lastTick: 1 } }).status).to.equal('unknown');
  });
});
