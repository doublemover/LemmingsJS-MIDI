import { expect } from 'chai';
import { installBrowserWorkObservation } from '../scripts/BrowserWorkObservation.js';

const fixture = () => {
  let now = 0, tick = 0, requestedTps = 30, observer, nextFrame = 0;
  const frames = new Map();
  const scope = { performance: { now: () => now },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id),
    PerformanceObserver: class {
      constructor(callback) { this.callback = callback; this.entries = []; observer = this; }
      observe() {} takeRecords() { return this.entries.splice(0); } disconnect() { this.disconnected = true; }
    },
    __E2E__: { getBenchMetrics: () => ({ active: true, mode: 'bench', tps: requestedTps }),
      getState: () => ({ ready: true, game: { timer: { tickIndex: tick, running: true, tps: requestedTps, frameTime: 1000 / requestedTps, speedFactor: 1 },
        level: { entrances: Array(30).fill({}) }, lemmingManager: { activeCount: 30 }, timeTravel: { isReversing: false } } }) }
  };
  installBrowserWorkObservation(scope);
  return { scope, frames, observer: () => observer, advance(ms, completed) { now += ms; tick += completed; }, target(value) { requestedTps = value; },
    frame(at) { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(at); } };
};

describe('browser completed-work benchmark observation', () => {
  it('measures completions and actual durations independently of a requested timer rate', () => {
    const f = fixture(); f.frame(0); f.frame(16);
    f.observer().entries.push({ name: 'Game runGameLogic', duration: 3 }, { name: 'GameDisplay render', duration: 4 });
    f.advance(500, 15);
    const first = f.scope.__LEMMINGS_BENCH_OBSERVATION__.sample();
    expect(first).to.include({ completedTicks: 15, measurementElapsedMs: 500, tps: 30, targetTps: 30, activeActors: 30, entrances: 30 });
    expect(first.frameGapsMs).to.deep.equal([16]); expect(first.tickExecutionMs).to.deep.equal([3]); expect(first.renderExecutionMs).to.deep.equal([4]);
    f.target(10000); f.advance(500, 0);
    expect(f.scope.__LEMMINGS_BENCH_OBSERVATION__.sample()).to.include({ completedTicks: 0, tps: 0, targetTps: 10000 });
    f.scope.__LEMMINGS_BENCH_OBSERVATION__.dispose(); expect(f.frames.size).to.equal(0); expect(f.observer().disconnected).to.equal(true);
  });

  it('bounds instrumentation storage and reports overflow instead of silently qualifying a partial distribution', () => {
    const f = fixture();
    f.observer().entries = Array.from({ length: 17000 }, () => ({ name: 'Game runGameLogic', duration: 1 }));
    f.advance(500, 15);
    const sample = f.scope.__LEMMINGS_BENCH_OBSERVATION__.sample();
    expect(sample.overflow).to.equal(true); expect(sample.tickExecutionMs).to.have.length(16384);
    f.scope.__LEMMINGS_BENCH_OBSERVATION__.dispose();
  });
});
