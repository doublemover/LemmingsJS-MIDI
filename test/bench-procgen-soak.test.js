import { expect } from 'chai';
import {
  buildUrl,
  admitProcgenSoakMeasurement,
  createProcgenSoakConfig,
  parseArgs,
  summarize,
  toBoolean,
  toPositiveNumber
} from '../scripts/bench-procgen-soak.js';
import { installProcgenSoakProbe } from '../scripts/ProcgenSoakProbe.js';

describe('bench-procgen-soak helpers', function () {
  it('parses CLI args and normalizes numeric/boolean values', function () {
    const args = parseArgs(['--duration=1200', '--headless=false', '--smoke']);
    expect(args.get('duration')).to.equal('1200');
    expect(args.get('headless')).to.equal('false');
    expect(args.get('smoke')).to.equal('true');

    expect(toPositiveNumber('10', 5)).to.equal(10);
    expect(toPositiveNumber('-1', 5)).to.equal(5);
    expect(toPositiveNumber(Symbol('duration'), 5)).to.equal(5);
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
      'https://example.test/procgen.html?foo=1&e2e=1&workstation=1'
    );
    expect(buildUrl('not-a-valid-url')).to.equal('https://localhost:8080/dist/browser/procgen.html?e2e=1&workstation=1');
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
  it('refuses an unbounded host receipt or an impossible timing window before launching a browser', () => {
    for (const argv of [['--sample=1'], ['--duration=3600001'], ['--duration=3600000', '--sample=10'], ['--maxRuntime=100']])
      expect(() => createProcgenSoakConfig({ argv, env: {} })).to.throw('finite receipt');
    expect(createProcgenSoakConfig({ argv: ['--name=rook'], env: {} }).name).to.equal('rook');
  });
});

const probeFixture = () => {
  let clock = 0, ordinal = 0, observer, disconnected = 0; const frames = new Map();
  const world = { workstationEnabled: true, generation: 1, tickIndex: 0, activeCount: 1, spawnedTotal: 1, actors: [{}], step() { clock += 2; this.tickIndex++; } };
  const renderer = { render() { clock += 3; return true; } }, scope = { __PROCGEN_STUDIO__: { play() {} }, __PROCGEN_LANES__: { world, renderer },
    performance: { now: () => clock }, requestAnimationFrame: callback => { frames.set(++ordinal, callback); return ordinal; }, cancelAnimationFrame: id => frames.delete(id),
    PerformanceObserver: class { static supportedEntryTypes = ['longtask']; constructor(callback) { observer = callback; } observe() {} disconnect() { disconnected++; } } };
  return { world, renderer, scope, frames, get disconnected() { return disconnected; },
    frame(stamp) { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(stamp); }, longTask(duration) { observer({ getEntries: () => [{ duration }] }); } };
};
describe('actual workstation completed-work soak ownership', () => {
  it('measures completed steps and all renders, bounds rolling samples and separates actual RAF gaps from requested frame time', () => {
    const f = probeFixture(), originalStep = f.world.step, originalRender = f.renderer.render, probe = installProcgenSoakProbe({ scope: f.scope, capacity: 16 });
    try {
      f.world.timer = { frameTime: 9876 }; f.frame(0);
      for (let index = 0; index < 100; index++) { f.world.step(); f.renderer.render(); f.frame((index + 1) * 16); }
      f.longTask(100); const report = probe.report();
      expect(report).to.include({ completedTicks: 100, worldTickDelta: 100, observedStepCalls: 100, failedSteps: 0 });
      expect(report.stepMs).to.include({ samples: 100, retainedSamples: 16, overwritten: 84, mean: 2, p99: 2, percentileScope: 'last-bounded-window' });
      expect(report.renderMs.mean).to.equal(3); expect(report.rafIntervalMs.p95).to.equal(16); expect(report.longTaskMs.maximum).to.equal(100);
      expect(admitProcgenSoakMeasurement(report)).to.equal(true);
      expect(() => admitProcgenSoakMeasurement({ ...report, rafIntervalMs: {} })).to.throw('completed-work');
      probe.resetWindow(); expect(probe.report().completedTicks).to.equal(0); expect(probe.sample().tick).to.equal(100);
      expect(() => admitProcgenSoakMeasurement(probe.report())).to.throw('completed-work');
    } finally { probe.dispose(); }
    expect(f.world.step).to.equal(originalStep); expect(f.renderer.render).to.equal(originalRender); expect(f.frames.size).to.equal(0); expect(f.disconnected).to.equal(1);
    probe.dispose(); expect(f.disconnected).to.equal(1); expect(() => probe.sample()).to.throw('ownership');
  });
  it('refuses a retired classic adapter, stale generations and replaced workstation owners', () => {
    expect(() => installProcgenSoakProbe({ scope: { __E2E__: { getState: () => ({ game: {} }) } } })).to.throw('actual ProcGen');
    const f = probeFixture(), probe = installProcgenSoakProbe({ scope: f.scope, capacity: 16 });
    f.world.generation++; expect(() => probe.sample()).to.throw('ownership'); f.world.generation--;
    f.scope.__PROCGEN_STUDIO__ = { play() {} }; expect(() => probe.report()).to.throw('ownership'); probe.dispose();
    for (const capacity of [0, 15, 16385, Infinity]) expect(() => installProcgenSoakProbe({ scope: f.scope, capacity })).to.throw('capacity');
  });
  it('retains an actual step failure and never clobbers a later wrapper on disposal', () => {
    const f = probeFixture(), failure = new Error('physical step failed'); f.world.step = () => { throw failure; };
    const probe = installProcgenSoakProbe({ scope: f.scope, capacity: 16 }), measured = f.world.step;
    expect(() => f.world.step()).to.throw(failure); expect(probe.report().failedSteps).to.equal(1);
    const later = (...args) => measured(...args); f.world.step = later; probe.dispose(); expect(f.world.step).to.equal(later);
    expect(() => f.world.step()).to.throw(failure);
  });
});
