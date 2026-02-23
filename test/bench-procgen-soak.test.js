import { expect } from 'chai';
import {
  buildUrl,
  createProcgenSoakConfig,
  parseArgs,
  summarize,
  toBoolean,
  toPositiveNumber
} from '../scripts/bench-procgen-soak.js';

describe('bench-procgen-soak helpers', function () {
  it('parses CLI args and normalizes numeric/boolean values', function () {
    const args = parseArgs(['--duration=1200', '--headless=false', '--smoke']);
    expect(args.get('duration')).to.equal('1200');
    expect(args.get('headless')).to.equal('false');
    expect(args.get('smoke')).to.equal('true');

    expect(toPositiveNumber('10', 5)).to.equal(10);
    expect(toPositiveNumber('-1', 5)).to.equal(5);
    expect(toBoolean('off', true)).to.equal(false);
    expect(toBoolean('enabled', false)).to.equal(true);
  });

  it('builds soak config from argv/env with safe fallbacks', function () {
    const config = createProcgenSoakConfig({
      argv: ['--duration=-5', '--sample=250', '--headless=no'],
      env: {
        LEMMINGS_PROCGEN_URL: 'https://example.test/procgen.html',
        PROCGEN_SOAK_WARMUP_MS: 'not-a-number',
        PROCGEN_SOAK_OP_TIMEOUT_MS: '0',
        PROCGEN_SOAK_HEAP_LIMIT_MB: '128'
      }
    });

    expect(config.baseUrl).to.equal('https://example.test/procgen.html');
    expect(config.durationMs).to.equal(60000);
    expect(config.sampleMs).to.equal(250);
    expect(config.warmupMs).to.equal(5000);
    expect(config.opTimeoutMs).to.equal(30000);
    expect(config.headless).to.equal(false);
    expect(config.heapLimitMb).to.equal(128);
    expect(config.maxRuntimeMs).to.be.greaterThan(config.durationMs);
  });

  it('normalizes procgen URLs and tolerates invalid url inputs', function () {
    expect(buildUrl('https://example.test/procgen.html?foo=1')).to.equal(
      'https://example.test/procgen.html?foo=1&e2e=1'
    );
    expect(buildUrl('not-a-valid-url')).to.equal('https://localhost:8080/procgen.html?e2e=1');
  });

  it('summarizes numeric samples deterministically', function () {
    expect(summarize([])).to.deep.equal({
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      avg: 0
    });
    const stats = summarize([8, 2, Number.NaN, 4, 10]);
    expect(stats.min).to.equal(2);
    expect(stats.max).to.equal(10);
    expect(stats.p50).to.equal(4);
    expect(stats.p95).to.equal(8);
    expect(stats.avg).to.equal(6);
  });
});
