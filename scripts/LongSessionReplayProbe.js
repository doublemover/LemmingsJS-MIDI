// Self-contained so Playwright can serialize this exact function into the page.
export function runLongSessionReplayProbe({ minimumHistoryTicks = 64 } = {}, api = globalThis.window?.__E2E__) {
  const now = () => globalThis.performance?.now?.() ?? Date.now(), startedAtMs = now();
  let stage = 'preflight', wasRunning = null, current = null, target = null;
  const result = fields => ({ ...fields, startedAtMs, endedAtMs: now(), wasRunning, currentTick: current, targetTick: target });
  try {
    const before = api?.getState?.()?.game, history = before?.history;
    if (!before?.timer || typeof before.timer.running !== 'boolean' || !history || ['getDelta', 'seek', 'resume', 'pause'].some(name => typeof api[name] !== 'function') || !Number.isSafeInteger(minimumHistoryTicks) || minimumHistoryTicks < 2)
      throw new Error('Replay transport/history evidence is unavailable.');
    wasRunning = before.timer.running; current = before.timer.tickIndex;
    const min = history.minTick, max = history.maxTick;
    if (!Number.isSafeInteger(current) || current < 0 || min != null && (!Number.isSafeInteger(min) || min < 0) || max != null && (!Number.isSafeInteger(max) || max < 0)) throw new Error('Replay history bounds are invalid.');
    if (min == null || max == null || max - min + 1 < minimumHistoryTicks || current - min < minimumHistoryTicks)
      return result({ status: 'warming-history', checked: false, hashMatch: null });
    if (max < min || max - min > 100000 || current > max + 1) throw new Error('Replay history does not cover the current tick.');
    target = Math.max(min, current - Math.max(2, Math.floor((current - min) / 4)));
    const hashText = text => { let value = 2166136261; for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); } return (value >>> 0).toString(16).padStart(8, '0'); };
    const physicalText = game => JSON.stringify({ tickIndex: game.timer?.tickIndex, state: game.state, finalGameState: game.finalGameState, victory: game.victory, skills: game.skills,
      lemmingManager: game.lemmingManager, lemmings: game.lemmings, triggers: game.triggers, objects: game.objects, steel: game.steel,
      level: game.level ? { releaseRate: game.level.releaseRate, releaseCount: game.level.releaseCount, entrances: game.level.entrances } : null });
    const historyHash = () => {
      let value = 2166136261, deltas = 0;
      for (let tick = min; tick <= max; tick++) {
        const delta = api.getDelta(tick); if (!delta) continue; deltas++;
        const text = JSON.stringify([tick, delta]);
        for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
      }
      if (deltas < minimumHistoryTicks) throw new Error('Replay probe lacks enough materialized history deltas.');
      return { hash: (value >>> 0).toString(16).padStart(8, '0'), deltas };
    };
    const beforeText = physicalText(before); stage = 'pause';
    if (wasRunning && (api.pause() !== true || api.getState()?.game?.timer?.running !== false)) throw new Error('Replay probe could not suspend its forward workload.');
    const hashBefore = historyHash(); stage = 'seek-target';
    if (api.seek(target) !== true || api.getState()?.game?.timer?.tickIndex !== target || api.getState()?.game?.timer?.running !== false) throw new Error('Replay target seek was incomplete.');
    stage = 'seek-return';
    if (api.seek(current) !== true) throw new Error('Replay return seek was rejected.');
    const restored = api.getState()?.game, afterText = physicalText(restored), hashAfter = historyHash();
    if (restored?.timer?.tickIndex !== current || restored?.timer?.running !== false || afterText !== beforeText || hashBefore.hash !== hashAfter.hash || hashBefore.deltas !== hashAfter.deltas) throw new Error('Replay did not restore its tick, exposed physical state and retained history.');
    stage = 'resume';
    if (wasRunning && (api.resume() !== true || api.getState()?.game?.timer?.running !== true)) throw new Error('Replay probe failed to resume the forward workload.');
    return result({ status: 'complete', checked: true, hashMatch: true, hashBefore: hashBefore.hash, hashAfter: hashAfter.hash, stateHash: hashText(beforeText),
      stateEvidence: 'exact-exposed-physical-projection-excludes-terrain-bytes', historyEvidence: 'fnv32-of-materialized-delta-json', deltaCount: hashBefore.deltas,
      transportRestored: api.getState()?.game?.timer?.running === wasRunning });
  } catch (error) {
    // Failure leaves the transaction stopped/uncertain. Never resume from an
    // incomplete seek or keep collecting an idle run as throughput evidence.
    try { api?.pause?.(); } catch { /* Browser cleanup remains independent. */ }
    return result({ status: 'failed', checked: false, hashMatch: false, transportRestored: false, stage, error: error?.message || String(error) });
  }
}
