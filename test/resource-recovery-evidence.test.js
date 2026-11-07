import { expect } from 'chai';
import { RESOURCE_RECOVERY_CASES, summarizeResourceSamples, evaluateResourceRecoveryEvidence } from '../scripts/ResourceRecoveryEvidence.js';
const buildId = 'a'.repeat(64);
const good = () => ({ applicationBuildId: buildId, cases: RESOURCE_RECOVERY_CASES.map(spec => ({ ...spec, executionIdentity: { activeExecution: 'bound', buildId }, observedLaneCount: spec.laneCount, observedDpr: spec.dpr,
  patternLength: 64, patternLanes: spec.laneCount, terrainEditCells: 8192, cctvViews: 8, refcountSharing: true, bank: { decodedEntries: 8, activePins: 8, decodedBytes: 30720000 }, playingTickDelta: 25,
  writes: Array.from({ length: 8 }, () => ({ accepted: true, durable: true, snapshotMs: 1, transactionMaximumSliceMs: 2, maximumStoredPayloadBytes: 65536, inputCopyMaximumSliceMs: 2, resultCopyMaximumSliceMs: 2, encodeMs: 10, commitMs: 3 })), capture: { slices: 8, maximumSliceMs: 3.9 },
  samples: { clickPaintMs: Array(16).fill(1), schedulingLatenessMs: Array(32).fill(1) }, pressure: { rejectedBeforeAllocation: true, activeWorldPreserved: true, activePinsPreserved: true, continuedTicks: 1 },
  candidate: { outcome: 'committed', overlapObserved: true }, budget: { limitBytes: 1000, peakAccountedBytes: 999, estimatedOverheadBytes: 100, categoryPeakCoverage: 'complete', categoryPeaks: { candidate: 500 } },
  cleanup: { outcome: 'complete' }, pausedRecovery: { accepted: true, playing: false }, browserErrors: [] })) });
describe('combined recovery/resource evidence admission', () => {
  it('requires all six actual lane/DPR cases rather than allowing missing work to pass', () => {
    const report = good(); expect(evaluateResourceRecoveryEvidence(report).status).to.equal('measured-profile-passed'); report.cases.pop(); expect(evaluateResourceRecoveryEvidence(report).status).to.equal('not-qualified');
    expect(evaluateResourceRecoveryEvidence({ applicationBuildId: buildId, cases: [] }).failures).to.have.length(6);
  });
  for (const [field, value] of [['playingTickDelta', 0], ['cctvViews', 0], ['sampleOverflow', true], ['terrainEditCells', 0], ['executionIdentity', { activeExecution: 'unbound' }], ['capture', { slices: 1, maximumSliceMs: 4.01 }], ['cleanup', { outcome: 'unknown' }]])
    it(`does not qualify absent or failed ${field}`, () => { const report = good(); report.cases[0][field] = value; expect(evaluateResourceRecoveryEvidence(report).status).to.equal('not-qualified'); });
  it('retains tails exactly and reports empty tails as unknown, not zero', () => {
    const values = [...Array(99).fill(1), 1000], result = summarizeResourceSamples(values); expect(result.maximum).to.equal(1000); expect(result.raw).to.equal(values); expect(result.p99).to.equal(1);
    expect(summarizeResourceSamples([])).to.include({ count: 0, p99: null, maximum: null }); expect(() => summarizeResourceSamples([NaN])).to.throw();
    const report = good(); report.cases[0].samples.clickPaintMs[0] = NaN; expect(evaluateResourceRecoveryEvidence(report).status).to.equal('not-qualified');
  });
  it('accepts explicit safe capacity refusal, not an unknown candidate outcome', () => {
    const report = good(); report.cases[0].candidate = { outcome: 'refused-with-current-world-preserved' }; expect(evaluateResourceRecoveryEvidence(report).status).to.equal('measured-profile-passed');
    report.cases[0].candidate.outcome = 'unknown'; expect(evaluateResourceRecoveryEvidence(report).status).to.equal('not-qualified');
  });
});
