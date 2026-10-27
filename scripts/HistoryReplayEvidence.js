export function installHistoryReplayEvidence({ samples = 4, maximumBytes = 32 * 1048576 } = {}, scope = globalThis) {
  const key = '__LEMMINGS_HISTORY_REPLAY_EVIDENCE__', api = scope.__E2E__;
  scope[key]?.dispose();
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 32 || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 32 * 1048576 ||
      typeof api?.getState !== 'function' || typeof api.getBuffer !== 'function' || typeof api.seek !== 'function') throw new Error('Independent replay evidence is unavailable or excessive.');
  const maximumCheckpoints = samples * 2 + 2;
  const crypto = scope.crypto || globalThis.crypto, Encoder = scope.TextEncoder || globalThis.TextEncoder;
  if (typeof crypto?.subtle?.digest !== 'function' || typeof Encoder !== 'function') throw new Error('Independent replay SHA-256 is unavailable.');
  const encoder = new Encoder();
  let checkpoints = [], retainedBytes = 0, disposed = false;
  const now = () => scope.performance.now();
  const counters = game => {
    const history = game?.history;
    if (!['coldBlockDecodes', 'coldBlockCacheHits', 'coldDecodedBytes'].every(name => Number.isSafeInteger(history?.[name]) && history[name] >= 0)) throw new Error('Cold replay work counters are unavailable.');
    return { decodes: history.coldBlockDecodes, cacheHits: history.coldBlockCacheHits, decodedBytes: history.coldDecodedBytes };
  };
  const capture = async (game = api.getState()?.game) => {
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
    const encoded = encoder.encode(text);
    if (encoded.byteLength > maximumBytes) throw new Error('Independent replay checkpoint exceeds its storage bound.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
    const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    return { tick: game.timer.tickIndex, hash, bytes: hash.length * 2 + 8, serializedBytes: text.length * 2 };
  };
  const owner = {
    async capture(game = api.getState()?.game) {
      if (disposed) throw new Error('Replay evidence is disposed.');
      const checkpoint = await capture(game);
      if (disposed) throw new Error('Replay evidence is disposed.');
      if (checkpoints.at(-1)?.tick === checkpoint.tick) return;
      if (checkpoints.at(-1)?.tick > checkpoint.tick) throw new Error('Forward replay checkpoint moved backwards.');
      const minimumTick = game?.history?.minTick;
      while (checkpoints.length && Number.isSafeInteger(minimumTick) && checkpoints[0].tick < minimumTick) retainedBytes -= checkpoints.shift().bytes;
      checkpoints.push(checkpoint); retainedBytes += checkpoint.bytes;
      while (checkpoints.length > maximumCheckpoints || retainedBytes > maximumBytes) {
        let remove = 0, closestSpan = Infinity;
        for (let index = 1; index < checkpoints.length - 1; index++) {
          const span = checkpoints[index + 1].tick - checkpoints[index - 1].tick;
          if (span < closestSpan) { closestSpan = span; remove = index; }
        }
        retainedBytes -= checkpoints.splice(remove, 1)[0].bytes;
      }
    },
    async probe() {
      const observations = [], seekMs = [];
      let start = null, stage = 'preflight';
      try {
        if (disposed) throw new Error('Replay evidence is disposed.');
        const game = api.getState()?.game;
        if (game?.timer?.running !== false) throw new Error('Replay benchmark must be paused before seeking.');
        start = await capture(game);
        const min = game.history?.minTick, max = game.history?.maxTick;
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || start.tick > max + 1) throw new Error('Retained history does not cover the actual starting state boundary.');
        const targets = checkpoints.filter(point => point.tick >= min && point.tick < start.tick);
        if (targets.length < samples) throw new Error('Insufficient independently observed forward checkpoints.');
        const selected = Array.from({ length: samples }, (_, index) => targets[Math.floor(index * targets.length / samples)]);
        const seek = async (expected, phase) => {
          if (disposed) throw new Error('Replay evidence is disposed.');
          const before = counters(api.getState()?.game), started = now();
          const accepted = api.seek(expected.tick);
          const durationMs = now() - started, afterGame = api.getState()?.game, after = counters(afterGame), actual = await capture(afterGame);
          if (disposed) throw new Error('Replay evidence is disposed.');
          const row = { phase, targetTick: expected.tick, observedTick: actual.tick, accepted: accepted === true, durationMs,
            exactStateMatch: actual.hash === expected.hash, hashAlgorithm: 'SHA-256', expectedHash: expected.hash, actualHash: actual.hash, coldDecodes: after.decodes - before.decodes,
            coldCacheHits: after.cacheHits - before.cacheHits, coldDecodedBytes: after.decodedBytes - before.decodedBytes };
          if (phase === 'first-touch') row.phase = row.coldDecodes > 0 ? 'first-touch-cold' : 'already-warm';
          else if (phase === 'warm-repeat' && row.coldDecodes > 0) row.phase = 'repeat-cold';
          observations.push(row); seekMs.push(durationMs);
          if (!row.accepted || !row.exactStateMatch || actual.tick !== expected.tick || afterGame.timer.running !== false || row.coldDecodes < 0) throw new Error('Replay did not apply the independently observed state and terrain.');
        };
        for (const target of selected) {
          stage = 'first-touch'; await seek(target, 'first-touch');
          stage = 'return'; await seek(start, 'return');
          stage = 'warm-repeat'; await seek(target, 'warm-repeat');
          stage = 'return'; await seek(start, 'return');
        }
        return { status: 'complete', evidence: 'sha256-forward-state-and-base64-terrain', deltaAvailable: true, hashMatch: true,
          minTick: min, maxTick: max, startTick: start.tick, restoredTick: api.getState()?.game?.timer?.tickIndex,
          startRestored: true, observations, seekMs, retainedOracleBytes: retainedBytes, maximumOracleBytes: maximumBytes,
          oracleSampling: 'time-distributed-live-forward-sha256-checkpoints', checkpointTicks: checkpoints.map(point => point.tick),
          hashAlgorithm: 'SHA-256', maximumSerializedCheckpointBytes: maximumBytes, startSerializedBytes: start.serializedBytes };
      } catch (error) {
        try { if (!disposed) api.pause?.(); } catch {}
        return { status: 'failed', evidence: 'sha256-forward-state-and-base64-terrain', deltaAvailable: checkpoints.length > 0,
          retainedOracleBytes: retainedBytes, maximumOracleBytes: maximumBytes, checkpointTicks: checkpoints.map(point => point.tick),
          hashMatch: false, startRestored: false, startTick: start?.tick ?? null, observations, seekMs, stage, error: error?.message || String(error) };
      }
    },
    dispose() { disposed = true; checkpoints = []; retainedBytes = 0; if (scope[key] === owner) delete scope[key]; }
  };
  scope[key] = owner;
  return { maximumCheckpoints, maximumBytes, hashAlgorithm: 'SHA-256' };
}
