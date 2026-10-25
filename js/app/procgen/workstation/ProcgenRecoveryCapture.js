import { captureProcgenCheckpointCooperative } from './ProcgenCheckpoint.js';
import { createProcgenRecoveryJournal, getProcgenRecoveryJournal } from './ProcgenRecoveryJournal.js';

export async function prepareProcgenRecoveryJournal(world, { resourceBudget, signal, isCurrent, onSlice } = {}) {
  const token = {}, bytes = Math.min(128 * 1048576, 8 * 1048576 + world.laneCount * 65536);
  resourceBudget?.reserve({ token, owner: 'recovery-base', category: 'candidate', bytes, pinned: true, reloadable: false });
  const started = performance.now(), captureStats = { slices: 0, maximumSliceMs: 0, elapsedMs: 0 };
  try {
    const checkpoint = await captureProcgenCheckpointCooperative(world, { signal, isCurrent, maxGraphBytes: bytes, onSlice: slice => { captureStats.slices++; captureStats.maximumSliceMs = Math.max(captureStats.maximumSliceMs, slice.durationMs); onSlice?.(slice); } });
    captureStats.elapsedMs = performance.now() - started;
    signal?.throwIfAborted(); if (!isCurrent()) throw new Error('Recovery base source was replaced.');
    const previous = getProcgenRecoveryJournal(world);
    const current = createProcgenRecoveryJournal(world, checkpoint, { resourceBudget, baseToken: token, replace: previous, captureStats: Object.freeze(captureStats) });
    previous?.dispose(); return current;
  } catch (error) { resourceBudget?.release({ token, owner: 'recovery-base' }); throw error; }
}
