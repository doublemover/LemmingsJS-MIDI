import { expect } from 'chai';
import { evaluateSmokeResults } from '../scripts/bench-smoke.js';

describe('bench smoke gates', function () {
  const thresholds = {
    perfP95FrameMsMax: 250,
    perfP50TpsMin: 15,
    historySpanRatioMin: 0.5,
    antsAvgMsMax: 250
  };

  it('passes when all smoke metrics are within thresholds', function () {
    const gate = evaluateSmokeResults({
      performance: {
        filteredFrameStats: { p95: 120 },
        filteredTpsStats: { p50: 45 }
      },
      history: {
        results: [{ maxSpanTicks: 24000, targetSpanTicks: 30000 }]
      },
      hotpaths: {
        marchingAnts: { avgMs: 90 }
      }
    }, thresholds);

    expect(gate.ok).to.equal(true);
    expect(gate.failures).to.deep.equal([]);
  });

  it('fails when any benchmark gate regresses', function () {
    const gate = evaluateSmokeResults({
      performance: {
        filteredFrameStats: { p95: 500 },
        filteredTpsStats: { p50: 5 }
      },
      history: {
        results: [{ maxSpanTicks: 2000, targetSpanTicks: 30000 }]
      },
      hotpaths: {
        marchingAnts: { avgMs: 1000 }
      }
    }, thresholds);

    expect(gate.ok).to.equal(false);
    expect(gate.failures.length).to.be.greaterThanOrEqual(4);
  });
});
