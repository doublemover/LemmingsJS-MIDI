import { canonicalDataText } from '../../../core/CanonicalData.js';
import { validateSampleTraversalBinding } from '../../../midi/content/SampleTraversal.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => Number.isFinite(value) && Math.abs(value) <= 1e9;
const stamp = value => canonicalDataText(value, { maxBytes: 262144, maxNodes: 16384 }).text;
export function createMemoryLessonObservation({ definition, graph, releaseGesture, assists }) {
  if (definition.success.kind !== 'move-memory' || assists !== false) throw new Error('Move the memory requires the manual signed-travel route.');
  const physical = stamp({ graph, releaseGesture }), baseline = [], changed = [];
  let phase = 'prepare-memory', reason = null, seed = null, prediction = '', track = null, rest = null, lastPosition = null, lastTick = -1, coordinate = null;
  const samePhysical = context => context.assists === false && stamp({ graph: context.graph, releaseGesture: context.releaseGesture }) === physical;
  const result = () => ({ phase, reason, baseline: [...baseline], changed: [...changed], journey: {
    kind: 'move-memory', assetSaved: !!seed, assetHash: seed?.assetHash ?? null, definitionHash: seed?.definitionHash ?? null,
    declaredMetric: seed?.binding.metric ?? null, orientation: seed?.binding.orientation ?? null, framesPerWorldPixel: seed?.binding.framesPerWorldPixel ?? null,
    requestedSourceFrame: coordinate, coordinateEvidence: 'original-source-coordinate-from-completed-travel;before-region-reflection;not-measured-PCM',
    sourceRegionFrames: seed?.region ?? null, restObserved: !!rest, ownedVoiceId: track?.voiceId ?? null, prediction,
    summary: 'Saved motion source: ' + (seed ? 'yes' : 'pending') + '; outbound: ' + (baseline.length ? 'observed' : 'pending') +
      '; stationary complete tick: ' + (rest ? 'observed' : 'pending') + '; return on original voice: ' + (changed.length ? 'observed' : 'pending') +
      '. Requested original-source frame before region reflection: ' + (coordinate ?? 'unknown') + '.'
  } });
  return Object.freeze({
    state: result,
    material(receipt, context) {
      if (phase !== 'prepare-memory' || receipt?.kind !== 'saved-seed-applied' || receipt.transform !== 'motion-body-graft' ||
          receipt.durable !== true || !hash(receipt.assetHash) || !hash(receipt.definitionHash) || !hash(receipt.packHash) ||
          !receipt.assetHashes?.includes(receipt.assetHash) || !Array.isArray(receipt.sourceRegionFrames) || receipt.sourceRegionFrames.length !== 2 ||
          !integer(receipt.sourceRegionFrames[0]) || !integer(receipt.sourceRegionFrames[1]) || receipt.sourceRegionFrames[1] - receipt.sourceRegionFrames[0] < 2 ||
          !context.soundReferences?.some(ref => ref.laneId === receipt.laneId && ref.definitionHash === receipt.definitionHash && ref.packHash === receipt.packHash)) return false;
      if (!samePhysical(context)) throw new Error('Keep the signed-travel route and finite release policy unchanged.');
      let binding; try { binding = validateSampleTraversalBinding(receipt.traversalBinding); } catch { reason = 'Compile the observed-travel template against this exact signed-axis mapping.'; return result(); }
      if (binding.mode !== 'tape-footpath' || binding.metric !== 'axis-projection' || binding.orientation !== 'signedX' ||
          binding.lifetimeScope !== 'actorJourney' || !definition.success.mappingIds.includes(binding.mappingId)) {
        reason = 'Choose this route’s actor-journey signedX tape-footpath mapping. Unsigned rubbing is a different physical instrument.'; return result();
      }
      seed = { assetHash: receipt.assetHash, definitionHash: receipt.definitionHash, packHash: receipt.packHash,
        soundIdentity: context.soundIdentity, binding, region: [...receipt.sourceRegionFrames] };
      phase = 'predict-memory'; reason = 'Predict which source region comes next on outbound travel, physical rest and return. Then explicitly release a fresh finite actor; old held bodies keep their original source.'; return result();
    },
    predictNext(value) {
      if (phase !== 'predict-memory' || typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error('Predict source traversal before observing the fresh actor.');
      prediction = value.trim(); phase = 'observe-memory-outbound'; reason = null; return result();
    },
    observe({ batch, intents, context }) {
      if (!samePhysical(context) || seed && context.soundIdentity !== seed.soundIdentity) throw new Error('The motion source or authored physical route changed. Reset before comparing another instrument.');
      if (!seed || !['observe-memory-outbound', 'await-memory-rest', 'observe-memory-return'].includes(phase)) return result();
      const facts = new Map(batch.facts.map(fact => [fact.eventId, fact]));
      if (track && intents.some(intent => intent.kind === 'end' && intent.voiceId === track.voiceId)) throw new Error('The owned travel voice ended before its complete outbound/rest/return. Release a new finite actor in a fresh attempt.');
      for (const intent of intents) {
        const travel = intent.articulationState?.travel, fact = facts.get(travel?.sourceEventId);
        if (!['begin', 'update'].includes(intent.kind) || intent.worldId !== batch.worldId || intent.generation !== batch.generation ||
            intent.batchId !== batch.batchId || !Array.isArray(intent.sourceEventIds) || !intent.sourceEventIds.length || intent.sourceEventIds.length > 8 || intent.mappingId !== seed.binding.mappingId || typeof intent.voiceId !== 'string' ||
            typeof intent.intentId !== 'string' || !travel || travel.schema !== 'lemmings-canonical-travel-observation/v1' ||
            travel.worldId !== batch.worldId || travel.generation !== batch.generation || travel.actorId !== intent.actorId ||
            travel.instrumentId !== seed.binding.mappingId || travel.lifetimeScope !== seed.binding.lifetimeScope || travel.metric !== seed.binding.metric ||
            travel.orientation !== seed.binding.orientation || travel.discontinuityEpoch !== 0 || !integer(travel.sourceSequence) || travel.sourceSequence < 1 ||
            typeof travel.scopeInstanceId !== 'string' || !travel.scopeInstanceId || !intent.sourceEventIds?.includes(travel.sourceEventId) ||
            fact?.kind !== 'MotionCommitted' || fact.worldId !== batch.worldId || fact.generation !== batch.generation || fact.batchId !== batch.batchId ||
            fact.actorId !== intent.actorId || !['committed-coordinate-write', 'endpoint-chord'].includes(travel.precision) ||
            seed.binding.requiredPrecision === 'committed-coordinate-write' && travel.precision !== seed.binding.requiredPrecision ||
            !finite(travel.from?.signedDistancePixels) || !finite(travel.to?.signedDistancePixels) || !finite(fact.positionBefore?.x) || !finite(fact.positionAfter?.x) ||
            Math.abs(travel.to.signedDistancePixels - travel.from.signedDistancePixels - (fact.positionAfter.x - fact.positionBefore.x)) > 1e-8) continue;
        const from = travel.from.signedDistancePixels, to = travel.to.signedDistancePixels, delta = to - from; let startedNow = false;
        if (!track) {
          if (intent.kind !== 'begin' || delta <= 0) continue;
          startedNow = true; track = { voiceId: intent.voiceId, actorId: intent.actorId, scope: travel.scopeInstanceId, sequence: travel.sourceSequence - 1, to: from, distance: 0 };
        }
        if (!startedNow && intent.kind === 'begin' && intent.actorId === track.actorId) throw new Error('A second onset cannot stand in for the original held voice’s return.');
        if (intent.voiceId !== track.voiceId || intent.actorId !== track.actorId) continue;
        if (intent.kind === 'begin' && track.sequence >= travel.sourceSequence || travel.scopeInstanceId !== track.scope ||
            travel.sourceSequence <= track.sequence || Math.abs(from - track.to) > 1e-8) throw new Error('The held source lost a continuous signed-travel boundary; no missing distance was inferred.');
        track.sequence = travel.sourceSequence; track.to = to;
        coordinate = (to - seed.binding.originPixels) * seed.binding.framesPerWorldPixel;
        const record = { intentId: intent.intentId, batchId: batch.batchId, actorId: intent.actorId, sourceEventIds: [...intent.sourceEventIds],
          voiceId: intent.voiceId, fromPixels: from, toPixels: to, requestedSourceFrame: coordinate, assetHash: seed.assetHash, definitionHash: seed.definitionHash };
        if (phase === 'observe-memory-outbound' && delta > 0) {
          track.distance += delta;
          if (track.distance >= definition.success.minimumTravelPixels) { baseline.push(record); phase = 'await-memory-rest'; reason = 'Observe this actor at the steel stop. A complete unchanged-position tick with no committed motion establishes physical rest; elapsed time alone cannot.'; }
        } else if (phase === 'observe-memory-return' && delta < 0) { changed.push({ ...record, restBatchId: rest.batchId }); phase = 'physical-evidence-observed'; reason = null; break; }
      }
      if (track && phase !== 'physical-evidence-observed') {
        const actor = batch.snapshot?.actors?.find(value => value.actorId === track.actorId);
        if (!actor || !finite(actor.x) || !finite(actor.y)) throw new Error('The tracked actor is unavailable before completing the physical return.');
        if (phase === 'await-memory-rest' && lastTick + 1 === batch.tick && lastPosition?.x === actor.x && lastPosition?.y === actor.y &&
            !batch.facts.some(fact => fact.kind === 'MotionCommitted' && fact.actorId === track.actorId)) {
          rest = { batchId: batch.batchId, tick: batch.tick, x: actor.x, y: actor.y, sourceCoordinate: coordinate };
          phase = 'observe-memory-return'; reason = 'Physical rest was observed. The admitted cursor may finish its last segment, then holds/fades; an existing modal body can decay. The same actor must now return on the same owned voice.';
        }
        lastPosition = { x: actor.x, y: actor.y }; lastTick = batch.tick;
      }
      return result();
    }
  });
}
