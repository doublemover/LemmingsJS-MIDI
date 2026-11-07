import { cloneData, cloneMutableData, freezeData } from '../../../core/CanonicalData.js';

const limits = { maxBytes: 8192, maxNodes: 512 }, point = value => value && [value.x, value.y].every(number => Number.isFinite(number) && Math.abs(number) <= 1e9);
export function createSceneMorphActorMotion({ instrumentId, scoreTimeFor = (batch, fact) => ({ simTick: batch.tick, subTick: fact.subTick ?? 0, precision: fact.precision ?? 'tick', sourceTimeMs: batch.sourceTimeMs, sourceTickDurationMs: batch.tickDurationMs }) } = {}) {
  let source = null, used = false;
  const stop = () => { if (source) source.stopped = true; };
  return Object.freeze({
    consume(batch, intents, admissions = null) {
      if (batch?.completeness?.status !== 'complete' || batch.completeness.dropped || !Array.isArray(batch.facts)) { stop(); return []; }
      if (!used) {
        const begin = intents.find(intent => intent.kind === 'begin' && intent.mappingId === instrumentId && (admissions === null || admissions.get(intent.intentId) === 'accepted'));
        if (!begin) return [];
        const motion = batch.facts.findLast(fact => fact.kind === 'MotionCommitted' && fact.actorId === begin.actorId);
        if (!point(motion?.positionAfter) || motion.discontinuity || motion.physicalPayload?.discontinuity || begin.worldId !== batch.worldId || begin.generation !== batch.generation) return [];
        used = true; source = { worldId: begin.worldId, generation: begin.generation, actorId: begin.actorId, voiceId: begin.voiceId, instrumentId,
          originX: motion.positionAfter.x, lastPosition: { ...motion.positionAfter }, lastTick: batch.tick, stopped: false };
        return [{ schema: 'lemmings-scene-body-motion-control/v1', kind: 'control', ...source, sourceTick: batch.tick, sourceSequence: motion.causalSequence,
          scoreTime: begin.scoreTime, sourceEventIds: begin.sourceEventIds, signedDistancePixels: 0, cause: 'first-accepted-gate-onset' }];
      }
      if (!source || source.stopped) return [];
      if (source.worldId !== batch.worldId || source.generation !== batch.generation || batch.tick !== source.lastTick + 1) { stop(); return []; }
      source.lastTick = batch.tick; let last = null;
      for (const fact of batch.facts) {
        if (fact.actorId !== source.actorId) continue;
        if (fact.kind === 'ActorTerminated') { stop(); break; }
        if (fact.kind !== 'MotionCommitted') continue;
        if (!point(fact.positionBefore) || !point(fact.positionAfter) || fact.discontinuity || fact.physicalPayload?.discontinuity ||
            fact.positionBefore.x !== source.lastPosition.x || fact.positionBefore.y !== source.lastPosition.y) { stop(); break; }
        source.lastPosition = { ...fact.positionAfter }; last = fact;
      }
      if (!last) return [];
      return [{ schema: 'lemmings-scene-body-motion-control/v1', kind: 'control', worldId: source.worldId, generation: source.generation, actorId: source.actorId,
        voiceId: source.voiceId, instrumentId, sourceTick: batch.tick, sourceSequence: last.causalSequence, scoreTime: scoreTimeFor(batch, last), sourceEventIds: [last.eventId],
        signedDistancePixels: source.lastPosition.x - source.originX, cause: 'actual-completed-signed-x;no-musical-onset' }];
    },
    snapshot: () => freezeData(cloneData({ schema: 'lemmings-scene-body-motion-owner/v1', instrumentId, used, source }, limits)),
    restore(raw, frontier) {
      const value = cloneMutableData(raw, limits), next = value?.source;
      if (used || source || value?.schema !== 'lemmings-scene-body-motion-owner/v1' || value.instrumentId !== instrumentId || typeof value.used !== 'boolean' ||
          next && (!value.used || next.worldId !== frontier.worldId || next.generation !== frontier.generation || next.instrumentId !== instrumentId || !Number.isSafeInteger(next.actorId) || next.actorId < 0 ||
          typeof next.voiceId !== 'string' || !next.voiceId || !Number.isSafeInteger(next.lastTick) || next.lastTick < 0 || typeof next.stopped !== 'boolean' || !point(next.lastPosition) || !Number.isFinite(next.originX) || Math.abs(next.originX) > 1e9)) throw new Error('The scene body motion owner differs from its exact restored physical execution.');
      source = next; used = value.used;
    },
    stop, reset() { source = null; used = false; }
  });
}
