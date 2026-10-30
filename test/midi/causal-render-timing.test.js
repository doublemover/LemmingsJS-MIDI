import { expect } from 'chai';
import { createCausalRenderTiming } from '../../js/app/midi-ui/CausalRenderTiming.js';
import { createSimScoreTimeline } from '../../js/app/procgen/workstation/SimScoreTimeline.js';

const source = timeline => ({ boundary: { state: { sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 1000,
  ...(timeline ? { timeline: { version: 1, worldId: 'world', timeline: timeline.snapshot() } } : {}) } });
const intent = (timeline, tick, subTick, sourceTimeMs, duration) => ({ worldId: 'world', scoreTime: { ...timeline.map({ epoch: 'score', simTick: tick, subTick }),
  sourceTimeMs, ...(duration == null ? {} : { sourceTickDurationMs: duration }) } });

describe('captured render time and tempo segments', () => {
  it('uses captured fractional durations and verifies score times across tempo/tick-rate changes', () => {
    const timeline = createSimScoreTimeline({ epoch: 'score', tickDurationMs: 10, tempoBpm: 120 });
    timeline.append({ simTick: 10, tickDurationMs: 20, tempoBpm: 90, discontinuityReason: 'captured-rate-change' });
    const timing = createCausalRenderTiming(source(timeline), 48000);
    expect(timing.frameFor(intent(timeline, 8, 0.25, 80, 10))).to.equal(3960);
    expect(timing.frameFor(intent(timeline, 12, 0.5, 150, null))).to.equal(7680);
    expect(timing.receipt()).to.include({ fractionalIntents: 2, capturedDurationUses: 1, timelineDurationUses: 1, scoreTimesConfirmed: 2 });
    expect(() => timing.frameFor(intent(timeline, 12, 0.5, 150, 10))).to.throw('duration disagrees');
    const wrongBeat = intent(timeline, 12, 0.5, 150, 20); wrongBeat.scoreTime.beat += 0.1;
    expect(() => timing.frameFor(wrongBeat)).to.throw('score time disagrees');
  });
  it('requires actual timing evidence for fractional ticks while preserving legacy whole-tick times', () => {
    const timing = createCausalRenderTiming(source(), 44100);
    expect(timing.frameFor({ scoreTime: { sourceTimeMs: 100, subTick: 0 } })).to.equal(4410);
    expect(() => timing.frameFor({ scoreTime: { sourceTimeMs: 100, subTick: 0.5 } })).to.throw('captured tick duration');
    expect(timing.frameFor({ scoreTime: { sourceTimeMs: 100, subTick: 0.5, sourceTickDurationMs: 10 } })).to.equal(4631);
  });
  it('adds fractional time after removing a large source origin to avoid losing sub-millisecond placement', () => {
    const origin = 2 ** 52, timing = createCausalRenderTiming({ boundary: { state: { sourceTimeMs: origin } }, finalBoundaryState: { sourceTimeMs: origin + 100 } }, 48000);
    expect(timing.frameFor({ scoreTime: { sourceTimeMs: origin + 10, subTick: 0.75, sourceTickDurationMs: 1 } })).to.equal(516);
  });
});
