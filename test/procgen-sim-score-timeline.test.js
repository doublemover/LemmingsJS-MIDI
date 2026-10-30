import { expect } from 'chai';
import { createSimScoreTimeline } from '../js/app/procgen/workstation/SimScoreTimeline.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';

const factBatch = tick => ({ version: 1, worldId: 'scene', generation: 1, tick, batchId: `scene:1:${tick}:0`,
  sourceTimeMs: tick * 60, completeness: { status: 'complete', dropped: 0 },
  facts: [{ causalSequence: tick, eventId: `scene:1:${tick}:0:1`, kind: 'ContactResolved', actorId: tick,
    causeKind: 'wall', precision: 'tick', subTick: 0 }] });

describe('simulation to score timeline', () => {
  it('maps catch-up batches by committed source tick instead of callback arrival or lookahead pulse', () => {
    const timeline = createSimScoreTimeline();
    const graph = { version: 1, revision: 1, instruments: [{ id: 'wall', sourceKind: 'ContactResolved',
      causeKind: 'wall', pitchCents: 6000, velocity01: 0.5, route: 'local', role: 'percussion' }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph, scoreTimeline: timeline });
    const run = sizes => {
      const result = [];
      let tick = 0;
      for (const size of sizes) for (let i = 0; i < size; i++) {
        tick++;
        result.push(engine.processBatch(factBatch(tick))[0].scoreTime.beat);
      }
      return result;
    };
    expect(run([1, 1, 1, 1])).to.deep.equal([0.12, 0.24, 0.36, 0.48]);
    expect(timeline.map({ simTick: 12 }).beat - timeline.map({ simTick: 10 }).beat).to.be.closeTo(0.24, 1e-12);
  });

  it('keeps elapsed score positions on tempo edits and restores a complete segment map', () => {
    const timeline = createSimScoreTimeline();
    const before = timeline.map({ simTick: 10 }).beat;
    timeline.append({ simTick: 11, tickDurationMs: 30, tempoBpm: 120, discontinuityReason: 'game-speed' });
    timeline.append({ simTick: 20, tickDurationMs: 30, tempoBpm: 240, discontinuityReason: 'tempo' });
    expect(timeline.map({ simTick: 10 }).beat).to.equal(before);
    expect(timeline.map({ simTick: 20 }).beat).to.be.closeTo(1.86, 1e-12);
    const restored = createSimScoreTimeline(); restored.restore(JSON.parse(JSON.stringify(timeline.snapshot())));
    expect(restored.map({ simTick: 25 })).to.deep.equal(timeline.map({ simTick: 25 }));
    expect(() => restored.append({ simTick: 20, tickDurationMs: 60, tempoBpm: 120 })).to.throw('segment');
    expect(() => restored.map({ simTick: -1 })).to.throw('uncovered');
    restored.resetEpoch({ epoch: 'seek-2', simTickOrigin: 25, tickDurationMs: 60, tempoBpm: 120, discontinuityReason: 'seek' });
    expect(restored.map({ simTick: 25 })).to.include({ epoch: 'seek-2', beat: 0 });
    expect(() => restored.map({ simTick: 24 })).to.throw('uncovered');
    expect(restored.map({ epoch: 'initial', simTick: 25 })).to.deep.equal(timeline.map({ simTick: 25 }));
  });

  it('records committed speed and tempo segments and retains prior generations', () => {
    const clock = createProcgenPhysicalScoreClock();
    const batch = (tick, generation, tickDurationMs) => ({ version: 1, worldId: 'scene', generation, tick,
      sourceTimeMs: tick * 60, tickDurationMs });
    expect(clock.observe(batch(1, 1, 20), { bpm: 120 }).beat).to.equal(0.04);
    expect(clock.observe(batch(2, 1, 20), { bpm: 120 }).beat).to.equal(0.08);
    expect(clock.observe(batch(3, 1, 10), { bpm: 120 }).beat).to.equal(0.12);
    expect(clock.observe(batch(4, 1, 10), { bpm: 240 }).beat).to.be.closeTo(0.14, 1e-12);
    const oldTime = clock.map({ simTick: 2 });
    const reset = clock.observe(batch(4, 2, 10), { bpm: 240 });
    expect(reset.beat).to.equal(0);
    const restored = createProcgenPhysicalScoreClock(); restored.restore(JSON.parse(JSON.stringify(clock.snapshot())));
    expect(restored.map({ epoch: oldTime.epoch, simTick: 2 })).to.deep.equal(oldTime);
    expect(restored.observe(batch(5, 2, 10), { bpm: 240 }).beat).to.equal(0.04);
    expect(() => restored.observe(batch(6, 2, 10), { bpm: Infinity })).to.throw('Invalid');
  });
});
