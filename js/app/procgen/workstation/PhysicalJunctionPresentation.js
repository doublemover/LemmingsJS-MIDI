const MAX_ACTORS = 64, MAX_SEGMENTS = 32, MAX_CROSSINGS = 8;
const point = value => value && Number.isFinite(value.x) && Number.isFinite(value.y);
const samePoint = (a, b) => a.x === b.x && a.y === b.y;
const crossing = (port, before, after) => {
  const right = before.x < port.position.x && after.x >= port.position.x;
  const left = before.x > port.position.x && after.x <= port.position.x;
  if (!(right && port.direction !== 'left' || left && port.direction !== 'right')) return null;
  const fraction = (port.position.x - before.x) / (after.x - before.x);
  const y = before.y + fraction * (after.y - before.y);
  return Math.abs(y - port.position.y) <= 1 ? fraction : null;
};

// A read-only observer. Requests and applied geometry never count as actor travel.
export function createPhysicalJunctionPresentation({ world, resources = null } = {}) {
  if (!world?.queryJunction || !world.soundEvents?.onBatch?.on || !world.soundEvents.onBatch.off) throw new TypeError('Junction presentation needs an owned physical world.');
  const ownerWorldId = world.worldId, ownerGeneration = world.generation;
  const sourceCurrent = () => world.worldId === ownerWorldId && world.generation === ownerGeneration;
  const actors = new Map(), observed = [], reservation = {};
  let selectedId = null, definition = null, appliedKey = null, lastTick = null, lastBatch = null, gap = null, revision = 0, disposed = false, reserved = false;
  const clearActors = reason => { actors.clear(); gap = reason; revision++; };
  const release = () => { if (reserved) { resources.release(reservation); reserved = false; } };
  const reconcile = () => {
    const next = world.physicalJunctions?.definitions.find(value => value.id === selectedId) || null;
    if (definition !== next) { clearActors(definition ? 'Junction definition changed; observe new inlet crossings.' : null); observed.length = 0; definition = next; appliedKey = null; }
    const state = definition ? world.queryJunction(selectedId, { includeDefinition: false }) : null;
    const key = state?.actual?.status === 'observed-at-application' ? `${definition.revision}:${state.actual.commandId}` : null;
    if (key !== appliedKey) { clearActors(appliedKey ? 'Applied geometry changed; actors already downstream do not establish the new route.' : null); appliedKey = key; }
    if (!key && actors.size) clearActors('Current junction geometry is unverified.');
    return state;
  };
  const select = id => {
    if (disposed) return false;
    if (!sourceCurrent()) throw new Error('The junction observation world changed.');
    if (id != null && !world.physicalJunctions?.definitions.some(value => value.id === id)) throw new Error('Choose a junction from the committed world.');
    if (selectedId === id) return true;
    if (id != null && resources && !reserved) { resources.retain(reservation, 512 * 1024, 'presentation'); reserved = true; }
    selectedId = id; actors.clear(); observed.length = 0; definition = null; appliedKey = lastTick = lastBatch = gap = null; revision++;
    if (id == null) release(); reconcile(); return true;
  };
  const observe = batch => {
    if (disposed || !sourceCurrent() || !selectedId || batch?.worldId !== ownerWorldId || batch.generation !== ownerGeneration || !Number.isSafeInteger(batch.tick) || !Array.isArray(batch.facts)) return;
    if (batch.batchId && batch.batchId === lastBatch) return;
    if (lastTick != null && batch.tick < lastTick) { observed.length = 0; clearActors('Source time was restored; observe new crossings.'); }
    else if (lastTick != null && batch.tick > lastTick + 1) clearActors('Physical observation has a tick gap.');
    lastTick = batch.tick; lastBatch = batch.batchId;
    const state = reconcile();
    if (batch.completeness?.status !== 'complete' || batch.facts.length > 65536) { clearActors('Physical observation is incomplete.'); return; }
    if (!definition || !appliedKey || !state?.actual) return;
    const config = definition.configurations.find(value => value.id === state.actual.configurationId);
    if (!config) { clearActors('Applied configuration is unavailable.'); return; }
    for (const fact of batch.facts) {
      if (fact.kind === 'ActorTerminated' || fact.kind === 'ActorLaneTransferred') { actors.delete(fact.actorId); continue; }
      if (fact.kind !== 'MotionCommitted') continue;
      const before = fact.positionBefore, after = fact.positionAfter, id = fact.actorId;
      if (!Number.isSafeInteger(id) || id < 0 || !point(before) || !point(after) || typeof fact.eventId !== 'string' || fact.eventId.length > 256 || fact.worldId !== ownerWorldId || fact.generation !== ownerGeneration || fact.batchId !== batch.batchId || fact.simTick !== batch.tick || fact.physicalPayload?.pathEvidence !== 'committed-coordinate-write') {
        if (actors.delete(id)) { gap = 'A tracked actor has no qualified committed movement path.'; revision++; } continue;
      }
      let tracked = actors.get(id);
      if (tracked && (!samePoint(tracked.position, before) || tracked.appliedKey !== appliedKey)) { actors.delete(id); tracked = null; gap = 'A tracked actor changed coordinates without a continuous observed path.'; revision++; }
      const entrances = definition.ports.filter(port => port.role === 'inlet').map(port => ({ port, fraction: crossing(port, before, after) })).filter(value => value.fraction != null).sort((a, b) => a.fraction - b.fraction);
      if (entrances.length) {
        if (!tracked && actors.size === MAX_ACTORS) { actors.delete(actors.keys().next().value); gap = 'Observed actor capacity reached; older unfinished paths are unknown.'; }
        tracked = { appliedKey, inletId: entrances[0].port.id, entryTick: batch.tick, entryCauseId: fact.eventId, position: after, segments: [], truncated: false };
        actors.set(id, tracked);
      }
      if (!tracked) continue;
      if (tracked.segments.length === MAX_SEGMENTS) { tracked.segments.shift(); tracked.truncated = true; }
      tracked.segments.push(Object.freeze([before.x, before.y, after.x, after.y])); tracked.position = { x: after.x, y: after.y };
      const exits = definition.ports.filter(port => port.role === 'outlet' && config.outletIds.includes(port.id)).map(port => ({ port, fraction: crossing(port, before, after) }))
        .filter(value => value.fraction != null && (!entrances.length || value.fraction >= entrances[0].fraction)).sort((a, b) => a.fraction - b.fraction);
      if (exits.length) {
        const record = Object.freeze({ junctionId: selectedId, definitionRevision: definition.revision, commandId: state.actual.commandId, configurationId: config.id,
          worldId: world.worldId, generation: world.generation, actorId: id, inletId: tracked.inletId, outletId: exits[0].port.id,
          entryTick: tracked.entryTick, tick: batch.tick, entryCauseId: tracked.entryCauseId, exitCauseId: fact.eventId,
          precision: 'committed-coordinate-write', anchorTolerancePixels: 1, trailComplete: !tracked.truncated, segments: Object.freeze(tracked.segments.slice()) });
        if (observed.length === MAX_CROSSINGS) observed.shift(); observed.push(record); actors.delete(id); revision++;
      }
    }
  };
  world.soundEvents.onBatch.on(observe);
  return Object.freeze({ select, observe, read() {
    if (disposed || !sourceCurrent()) return null;
    if (lastTick != null && world.tickIndex < lastTick) { observed.length = 0; lastTick = lastBatch = null; clearActors('Source time was restored; observe new crossings.'); }
    const state = reconcile(), tick = world.tickIndex;
    return Object.freeze({ worldId: world.worldId, generation: world.generation, tick, revision, selectedId, definition, state,
      observed: Object.freeze(observed.slice()), currentCrossings: state?.actual?.status === 'observed-at-application' ? observed.filter(value => value.commandId === state.actual.commandId && value.definitionRevision === definition?.revision).length : 0,
      pending: Object.freeze((state?.pending || []).map(value => Object.freeze({ ...value, remainingTicks: Math.max(0, value.expiryTick - tick) }))),
      gap, trackedActors: actors.size, capacity: Object.freeze({ actors: MAX_ACTORS, segments: MAX_SEGMENTS, crossings: MAX_CROSSINGS }) });
  }, dispose() { if (disposed) return; disposed = true; world.soundEvents.onBatch.off(observe); actors.clear(); observed.length = 0; definition = null; release(); } });
}
