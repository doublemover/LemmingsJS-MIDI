import { compileAcousticMap } from '../../../midi/content/AcousticMap.js';
import { evaluateSpatialState, validateSpatialAttachment } from '../../../midi/content/SpatialState.js';
import { freezeData } from '../../../core/CanonicalData.js';

export function createWorldSpatialControl({ getCameraPosition = () => null, hasSolidAt = null } = {}) {
  let plan = null, actors = new Map(), listener = null, boundary = null, sourceTime = -Infinity, terrainRevision = null, tick = -1, valid = false, lastBatch = null;
  const occlusion = new Map();
  const configure = raw => { if (plan?.map === raw) return; plan = raw ? compileAcousticMap(raw) : null; listener = plan?.map.listener.position || null; boundary = null; sourceTime = -Infinity; valid = false; occlusion.clear(); };
  const observe = batch => {
    lastBatch = batch; valid = false;
    if (!plan || batch.completeness?.status !== 'complete' || !Array.isArray(batch.snapshot?.actors) || batch.snapshot.actors.length > 1024 || batch.snapshot.completeness?.status && batch.snapshot.completeness.status !== 'complete' || !Number.isFinite(batch.tickDurationMs) || batch.tickDurationMs <= 0 || !Number.isFinite(batch.sourceTimeMs) || !Number.isSafeInteger(batch.snapshot.terrainRevision ?? batch.terrainRevision)) return false;
    const nextBoundary = batch.worldId + ':' + batch.generation, revision = batch.snapshot.terrainRevision ?? batch.terrainRevision;
    if (boundary !== nextBoundary || terrainRevision !== revision) occlusion.clear();
    if (boundary !== nextBoundary) { listener = plan.map.listener.position; sourceTime = -Infinity; }
    boundary = nextBoundary; terrainRevision = revision; tick = batch.tick; actors = new Map(batch.snapshot.actors.map(actor => [actor.actorId, actor]));
    const policy = plan.map.listener;
    if (policy.mode === 'selected-actor') { const actor = actors.get(policy.actorId); if (actor && [actor.x, actor.y].every(Number.isFinite)) listener = { x: actor.x, y: actor.y }; else if (policy.removedPolicy === 'return-fixed') listener = policy.position; }
    else if (policy.mode === 'camera-follow') { const camera = getCameraPosition(batch); if (camera && [camera.x, camera.y].every(Number.isFinite)) listener = { x: camera.x, y: camera.y }; else return false; }
    else listener = policy.position;
    valid = true; return true;
  };
  const coarseOcclusion = source => {
    const profile = plan.map.occlusion; if (!profile.enabled) return 0;
    if (typeof hasSolidAt !== 'function') return null;
    const cell = profile.cellPixels, sx = Math.floor(source.x / cell), sy = Math.floor(source.y / cell), lx = Math.floor(listener.x / cell), ly = Math.floor(listener.y / cell), key = [sx, sy, lx, ly].join(':');
    if (occlusion.has(key)) return occlusion.get(key);
    let blocked = 0; const samples = Math.min(profile.maximumSamples, Math.max(1, Math.ceil(Math.hypot(sx - lx, sy - ly))));
    for (let index = 1; index <= samples; index++) {
      const t = index / (samples + 1), result = hasSolidAt(Math.floor((sx + (lx - sx) * t + 0.5) * cell), Math.floor((sy + (ly - sy) * t + 0.5) * cell), { worldId: lastBatch.worldId, generation: lastBatch.generation, terrainRevision, tick });
      if (typeof result !== 'boolean') return null; if (result) blocked++;
    }
    const value = blocked / samples; if (occlusion.size >= 4096) occlusion.delete(occlusion.keys().next().value); occlusion.set(key, value); return value;
  };
  const state = ({ voiceId, actorId, attachment, sourcePosition }) => {
    if (!plan) return { status: 'disabled', state: null };
    if (!valid) return { status: 'unavailable', reason: 'committed-spatial-observation-unavailable', state: null };
    const sourceAttachment = validateSpatialAttachment(attachment), actor = sourceAttachment.kind === 'actor' ? actors.get(actorId) : null,
      position = sourceAttachment.kind === 'persistent-body' ? sourceAttachment.position : sourceAttachment.kind === 'struck-point' ? sourcePosition : actor ? { x: actor.x, y: actor.y } : null;
    if (!position || ![position.x, position.y].every(Number.isFinite)) return { status: 'unavailable', reason: 'spatial-source-position-unavailable', state: null };
    const amount = coarseOcclusion(position); if (amount === null) return { status: 'unavailable', reason: 'committed-occlusion-source-unavailable', state: null };
    return { status: 'complete', state: evaluateSpatialState({ plan, worldId: lastBatch.worldId, generation: lastBatch.generation, voiceId, sourceAttachment, sourceWorldPosition: position, listenerWorldPosition: listener, sourceTick: tick, terrainRevision, occlusion01: amount, tickDurationMs: lastBatch.tickDurationMs }) };
  };
  return Object.freeze({ configure, observe, state, enabled: () => !!plan, maximumVoices: () => plan?.map.maximumVoices || 0,
    due() { if (!valid || !plan || lastBatch.sourceTimeMs < sourceTime || lastBatch.sourceTimeMs - sourceTime + 1e-8 >= 1000 / plan.map.controlRateHz) { if (valid) sourceTime = lastBatch.sourceTimeMs; return valid; } return false; },
    diagnostics: () => freezeData({ enabled: !!plan, mapId: plan?.map.id || null, revision: plan?.map.revision ?? null, listener, listenerMode: plan?.map.listener.mode || null, committedObservation: valid, sourceTick: tick, terrainRevision, actorCount: actors.size, cachedOcclusionCells: occlusion.size, maximumOcclusionSamples: plan?.map.occlusion.maximumSamples || 0, maximumVoices: plan?.map.maximumVoices || 0 }),
    reset() { actors.clear(); occlusion.clear(); listener = plan?.map.listener.position || null; boundary = null; valid = false; sourceTime = -Infinity; lastBatch = null; }
  });
}
