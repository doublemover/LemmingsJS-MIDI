import { expect } from 'chai';
import {
  createHistoryBenchConfig,
  parseArgs,
  parseSpeedList,
  summarizeTimings,
  toBoolean,
  toPositiveNumber
} from '../scripts/bench-history-stress.js';

describe('bench-history-stress helpers', function () {
  it('parses args and number helpers safely', function () {
    const args = parseArgs(['--profile=soak', '--smoke']);
    expect(args.get('profile')).to.equal('soak');
    expect(args.get('smoke')).to.equal('true');
    expect(toPositiveNumber('30', 5)).to.equal(30);
    expect(toPositiveNumber('-1', 5)).to.equal(5);
    expect(toBoolean('off', true)).to.equal(false);
    expect(toBoolean('unknown', true)).to.equal(true);
  });

  it('parses speed lists and filters invalid entries', function () {
    expect(parseSpeedList('30, 60, bad, -2, 0, 120')).to.deep.equal([30, 60, 120]);
    expect(parseSpeedList('')).to.deep.equal([]);
  });

  it('falls back to profile speeds when provided speed list is invalid', function () {
    const warnings = [];
    const config = createHistoryBenchConfig({
      argv: ['--speeds=,,'],
      env: {},
      log: {
        warn(message) {
          warnings.push(message);
        }
      }
    });

    expect(config.speeds).to.deep.equal([30, 60]);
    expect(warnings.some((message) => String(message).includes('Invalid speed list'))).to.equal(true);
  });

  it('builds stable timing summaries for empty and populated lists', function () {
    expect(summarizeTimings([])).to.deep.equal({
      count: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      samplesMs: []
    });
    const summary = summarizeTimings([20, 10, 30]);
    expect(summary.count).to.equal(3);
    expect(summary.samplesMs).to.deep.equal([10, 20, 30]);
    expect(summary.p50Ms).to.equal(20);
    expect(summary.p95Ms).to.equal(30);
  });
});
