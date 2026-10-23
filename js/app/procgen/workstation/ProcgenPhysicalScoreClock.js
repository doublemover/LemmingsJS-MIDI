import { createSimScoreTimeline } from './SimScoreTimeline.js';

// Observe only committed batches. Transport pulses may lead physics, so their
// current playhead is never used as an event timestamp.
export function createProcgenPhysicalScoreClock({ maxSegments = 2048 } = {}) {
  let timeline = null, worldId = null, generation = null, lastTick = -1, lastSourceTimeMs = -1;
  const observe = (batch, { bpm } = {}) => {
    if (batch?.version !== 1 || typeof batch.worldId !== 'string' || !batch.worldId ||
        !Number.isSafeInteger(batch.generation) || !Number.isSafeInteger(batch.tick) || batch.tick < 0 ||
        !Number.isFinite(batch.sourceTimeMs) || batch.sourceTimeMs < 0 ||
        !Number.isFinite(batch.tickDurationMs) || batch.tickDurationMs <= 0 || batch.tickDurationMs > 60000 ||
        !Number.isFinite(bpm) || bpm <= 0 || bpm > 1000000) throw new Error('Invalid physical score clock input.');
    if (worldId !== null && batch.worldId !== worldId) throw new Error('Physical score clock belongs to a different world.');
    if (batch.tick < lastTick || batch.sourceTimeMs < lastSourceTimeMs) throw new Error('Physical source time moved backward.');
    if (!timeline) {
      timeline = createSimScoreTimeline({ epoch: `${batch.worldId}:${batch.generation}:0`,
        simTickOrigin: Math.max(0, batch.tick - 1), tickDurationMs: batch.tickDurationMs, tempoBpm: bpm, maxSegments });
      worldId = batch.worldId; generation = batch.generation;
    } else if (batch.generation !== generation) {
      if (batch.tick !== lastTick) throw new Error('Generation changed outside a committed boundary.');
      const epoch = `${batch.worldId}:${batch.generation}:${timeline.epochCount()}`;
      timeline.resetEpoch({ epoch, simTickOrigin: batch.tick, tickDurationMs: batch.tickDurationMs,
        tempoBpm: bpm, discontinuityReason: 'generation' });
      generation = batch.generation;
    } else {
      const last = timeline.currentSegment();
      if (batch.tick > lastTick && (last.tickDurationMs !== batch.tickDurationMs || last.tempoBpm !== bpm)) {
        timeline.append({ simTick: batch.tick, tickDurationMs: batch.tickDurationMs, tempoBpm: bpm,
          discontinuityReason: last.tickDurationMs !== batch.tickDurationMs ? 'game-speed' : 'tempo' });
      }
    }
    lastTick = batch.tick; lastSourceTimeMs = batch.sourceTimeMs;
    return timeline.map({ simTick: batch.tick });
  };
  const snapshot = () => timeline ? Object.freeze({ version: 1, worldId, generation, lastTick, lastSourceTimeMs,
    timeline: timeline.snapshot() }) : null;
  const restore = saved => {
    if (saved?.version !== 1 || typeof saved.worldId !== 'string' || !saved.worldId ||
        !Number.isSafeInteger(saved.generation) || !Number.isSafeInteger(saved.lastTick) || saved.lastTick < 0 ||
        !Number.isFinite(saved.lastSourceTimeMs) || saved.lastSourceTimeMs < 0) throw new Error('Invalid physical score clock checkpoint.');
    const next = createSimScoreTimeline({ maxSegments }); next.restore(saved.timeline);
    if (!next.snapshot().currentEpoch.startsWith(`${saved.worldId}:${saved.generation}:`) ||
        next.snapshot().epochs.at(-1).segments.at(-1).simTickOrigin > saved.lastTick) throw new Error('Physical score clock checkpoint does not match its world.');
    timeline = next; worldId = saved.worldId; generation = saved.generation;
    lastTick = saved.lastTick; lastSourceTimeMs = saved.lastSourceTimeMs;
  };
  const map = time => {
    if (!timeline) throw new Error('No physical score timeline has been observed.');
    return timeline.map(time);
  };
  return { observe, snapshot, restore, map };
}
