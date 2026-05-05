import { expect } from 'chai';
import {
  canMeasurePerformance,
  recordPerformanceMeasure,
  resetPerformanceMeasureCounts
} from '../js/util/performanceInstrumentation.js';

describe('performanceInstrumentation', function () {
  afterEach(function () {
    resetPerformanceMeasureCounts();
  });

  it('detects measure support from an injected performance object', function () {
    expect(canMeasurePerformance({ now() {}, measure() {} })).to.equal(true);
    expect(canMeasurePerformance({ now() {} })).to.equal(false);
  });

  it('clears retained measures on a bounded cadence', function () {
    const calls = [];
    const perf = {
      measure(name, options) { calls.push(['measure', name, options.start]); },
      clearMeasures(name) { calls.push(['clear', name]); }
    };

    expect(recordPerformanceMeasure('hot-path', { start: 1 }, {
      performanceRef: perf,
      retention: 2
    })).to.equal(true);
    expect(recordPerformanceMeasure('hot-path', { start: 2 }, {
      performanceRef: perf,
      retention: 2
    })).to.equal(true);
    expect(recordPerformanceMeasure('hot-path', { start: 3 }, {
      performanceRef: perf,
      retention: 2
    })).to.equal(true);

    expect(calls).to.deep.equal([
      ['measure', 'hot-path', 1],
      ['measure', 'hot-path', 2],
      ['clear', 'hot-path'],
      ['measure', 'hot-path', 3]
    ]);
  });
});
