export function installHistoryReplayEvidence({ samples = 4, maximumBytes = 32 * 1048576 } = {}, scope = globalThis) {
  const key = '__LEMMINGS_HISTORY_REPLAY_EVIDENCE__', api = scope.__E2E__;
  scope[key]?.dispose();
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 32 || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 32 * 1048576 ||
      typeof api?.getState !== 'function' || typeof api.getBuffer !== 'function' || typeof api.seek !== 'function') throw new Error('Independent replay evidence is unavailable or excessive.');
  const maximumCheckpoints = samples * 2 + 2;
  let checkpoints = [], retainedBytes = 0, disposed = false;
  const now = () => scope.performance.now();
  const counters = game => {
    const history = game?.history;
    if (!['coldBlockDecodes', 'coldBlockCacheHits', 'coldDecodedBytes'].every(name => Number.isSafeInteger(history?.[name]) && history[name] >= 0)) throw new Error('Cold replay work counters are unavailable.');
    return { decodes: history.coldBlockDecodes, cacheHits: history.coldBlockCacheHits, decodedBytes: history.coldDecodedBytes };
  };
  const capture = (game = api.getState()?.game) => {
    if (!Number.isSafeInteger(game?.timer?.tickIndex) || game.timer.tickIndex < 0) throw new Error('Replay state boundary is unavailable.');
    const width = game.level?.width, height = game.level?.height, pixels = width * height;
    const terrainStringBytes = 2 * (4 * Math.ceil(pixels / 3) + 4 * Math.ceil(pixels * 4 / 3));
    if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 || !Number.isSafeInteger(pixels) || terrainStringBytes > maximumBytes) throw new Error('Independent replay checkpoint exceeds its storage bound.');
    const buffers = ['ground-mask', 'ground-image'].map(name => {
      const buffer = api.getBuffer(name);
      if (buffer?.encoding !== 'base64' || typeof buffer.data !== 'string' || !buffer.data.length || buffer.width !== width || buffer.height !== height ||
          buffer.byteLength !== pixels * (name === 'ground-image' ? 4 : 1)) throw new Error('Authoritative replay terrain is unavailable.');
      return buffer;
    });
    const manager = game.lemmingManager;
    const text = JSON.stringify({ tick: game.timer.tickIndex, state: game.state, finalGameState: game.finalGameState,
      victory: game.victory, skills: game.skills, lemmings: game.lemmings, triggers: game.triggers, objects: game.objects, steel: game.steel,
      manager: manager ? { spawnTotal: manager.spawnTotal, releaseTickIndex: manager.releaseTickIndex, mmTickCounter: manager.mmTickCounter,
        activeCount: manager.activeCount, totalCount: manager.totalCount, nukeTargets: manager.nukeTargets } : null,
      level: game.level ? { name: game.level.name, width: game.level.width, height: game.level.height,
        releaseRate: game.level.releaseRate, releaseCount: game.level.releaseCount, entrances: game.level.entrances } : null, buffers });
    if (text.length * 2 > maximumBytes) throw new Error('Independent replay checkpoint exceeds its storage bound.');
    return { tick: game.timer.tickIndex, text, bytes: text.length * 2 };
  };
  const owner = {
    capture(game) {
      if (disposed) throw new Error('Replay evidence is disposed.');
      const checkpoint = capture(game);
      if (checkpoints.at(-1)?.tick === checkpoint.tick) return;
      while (checkpoints.length >= maximumCheckpoints || retainedBytes + checkpoint.bytes > maximumBytes) retainedBytes -= checkpoints.shift().bytes;
      checkpoints.push(checkpoint); retainedBytes += checkpoint.bytes;
    },
    probe() {
      const observations = [], seekMs = [];
      let start = null, stage = 'preflight';
      try {
        const game = api.getState()?.game;
        if (game?.timer?.running !== false) throw new Error('Replay benchmark must be paused before seeking.');
        start = capture(game);
        const min = game.history?.minTick, max = game.history?.maxTick;
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || start.tick > max + 1) throw new Error('Retained history does not cover the actual starting state boundary.');
        const targets = checkpoints.filter(point => point.tick >= min && point.tick < start.tick);
        if (targets.length < samples) throw new Error('Insufficient independently observed forward checkpoints.');
        const selected = Array.from({ length: samples }, (_, index) => targets[Math.floor(index * targets.length / samples)]);
        const seek = (expected, phase) => {
          const before = counters(api.getState()?.game), started = now();
          const accepted = api.seek(expected.tick);
          const durationMs = now() - started, afterGame = api.getState()?.game, after = counters(afterGame), actual = capture(afterGame);
          const row = { phase, targetTick: expected.tick, observedTick: actual.tick, accepted: accepted === true, durationMs,
            exactStateMatch: actual.text === expected.text, coldDecodes: after.decodes - before.decodes,
            coldCacheHits: after.cacheHits - before.cacheHits, coldDecodedBytes: after.decodedBytes - before.decodedBytes };
          if (phase === 'first-touch') row.phase = row.coldDecodes > 0 ? 'first-touch-cold' : 'already-warm';
          else if (phase === 'warm-repeat' && row.coldDecodes > 0) row.phase = 'repeat-cold';
          observations.push(row); seekMs.push(durationMs);
          if (!row.accepted || !row.exactStateMatch || actual.tick !== expected.tick || afterGame.timer.running !== false || row.coldDecodes < 0) throw new Error('Replay did not apply the independently observed state and terrain.');
        };
        for (const target of selected) {
          stage = 'first-touch'; seek(target, 'first-touch');
          stage = 'return'; seek(start, 'return');
          stage = 'warm-repeat'; seek(target, 'warm-repeat');
          stage = 'return'; seek(start, 'return');
        }
        return { status: 'complete', evidence: 'exact-forward-state-and-base64-terrain', deltaAvailable: true, hashMatch: true,
          minTick: min, maxTick: max, startTick: start.tick, restoredTick: api.getState()?.game?.timer?.tickIndex,
          startRestored: true, observations, seekMs, retainedOracleBytes: retainedBytes, maximumOracleBytes: maximumBytes };
      } catch (error) {
        try { api.pause?.(); } catch {}
        return { status: 'failed', evidence: 'exact-forward-state-and-base64-terrain', deltaAvailable: checkpoints.length > 0,
          hashMatch: false, startRestored: false, startTick: start?.tick ?? null, observations, seekMs, stage, error: error?.message || String(error) };
      }
    },
    dispose() { disposed = true; checkpoints = []; retainedBytes = 0; if (scope[key] === owner) delete scope[key]; }
  };
  scope[key] = owner;
  return { maximumCheckpoints, maximumBytes };
}
