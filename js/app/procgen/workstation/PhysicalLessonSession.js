import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { validatePhysicalLessonDefinition } from './PhysicalLessonDefinition.js';

const stamp = value => canonicalDataText(value, { maxBytes: 262144, maxNodes: 16384 }).text;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const interval = (records, key) => records.length === 2 ? Math.abs(records[1][key] - records[0][key]) : null;

export function createPhysicalLessonSession({ progress, onState = () => {} } = {}) {
  let definition = null, phase = 'closed', reason = null, prediction = '', binding = null, zeroControl = null, baseline = [], changed = [], baselineGraph = null, baselineSpacing = null, soundIdentity = null, disposed = false, reportedHearing = false;
  let lastTick = -1, lastOrdinal = -1, lastBatch = null, graphRef = null, graphValue = null;
  const accepted = new Set();
  const state = () => freezeData({ phase, reason, definition, prediction, priorProgress: definition ? progress?.read?.(definition.id, definition.version) ?? null : null, zeroControl, baseline: [...baseline], changed: [...changed], physicalObserved: phase === 'physical-evidence-observed', soundAccepted: changed.length > 0 && changed.every(record => accepted.has(record.intentId)), reportedHearing,
    evidencePath: reportedHearing ? 'reported-hearing' : 'visual', soundRendered: false, hearingEvidence: reportedHearing ? 'explicit-user-report;not-measured' : 'unverified', persistence: progress?.state?.().persistence ?? 'session-only' });
  const report = () => { if (!disposed) { try { onState(state()); } catch {} } };
  const fail = message => { reason = message; phase = 'reset-required'; binding = null; reportedHearing = false; accepted.clear(); report(); return false; };
  const clearAttempt = () => { binding = null; baseline = []; changed = []; baselineGraph = baselineSpacing = soundIdentity = null; graphRef = graphValue = null; lastTick = -1; lastOrdinal = -1; lastBatch = null; accepted.clear(); reportedHearing = false; prediction = ''; reason = null; };
  const persist = () => { if (phase === 'physical-evidence-observed') progress?.write(definition.id, { version: definition.version, physicalObserved: true, soundAccepted: changed.every(record => accepted.has(record.intentId)), reportedHearing, evidencePath: reportedHearing ? 'reported-hearing' : 'visual' }); };
  const graph = value => {
    if (value === graphRef) return graphValue;
    const pickup = value?.pickups?.find(item => item.id === definition.success.pickupId); if (!pickup) throw new Error('The lesson pickup is missing.');
    const { revision, pickups, ...rest } = value;
    graphValue = { geometry: stamp(pickup.geometry), other: stamp({ ...rest, pickups: pickups.map(item => item.id === pickup.id ? { ...item, geometry: null, revision: null } : item) }) }; graphRef = value; return graphValue;
  };
  const spacing = value => stamp({ nominalGapTicks: value?.nominalGapTicks ?? null, spreadTicks: value?.spreadTicks ?? null, lanePhase: value?.lanePhase ?? null, phaseStepTicks: value?.phaseStepTicks ?? null, grouping: value?.grouping ?? null, clockMode: value?.clockMode ?? null });
  const observeReceipt = (receipt, documentEpoch) => {
    if (disposed || !binding || documentEpoch !== binding.documentEpoch || !integer(receipt?.generation) || receipt.generation !== binding.generation || receipt.status !== 'accepted' || receipt.outputRequested === false || receipt.stage === 'none' || typeof receipt.stage !== 'string' || accepted.has(receipt.intentId)) return false;
    if (![...baseline, ...changed].some(record => record.intentId === receipt.intentId && record.batchId === receipt.batchId && record.sourceEventIds.every(id => receipt.sourceEventIds?.includes(id)))) return false;
    accepted.add(receipt.intentId); persist(); report(); return true;
  };
  return Object.freeze({ state,
    select(value) { if (disposed) throw new Error('Lesson owner is disposed.'); definition = validatePhysicalLessonDefinition(value); clearAttempt(); zeroControl = null; phase = 'load-zero-control'; report(); return state(); },
    bindScene({ sceneHash, worldId, generation, documentEpoch, graph: currentGraph, releaseGesture, soundIdentity: currentSound } = {}) {
      if (disposed || !definition || typeof worldId !== 'string' || !worldId || !integer(generation) || !integer(documentEpoch)) throw new TypeError('Bind the actual freshly loaded lesson world and document.');
      clearAttempt(); binding = { sceneHash, worldId, generation, documentEpoch };
      if (sceneHash === definition.zeroNoteScene.hash) phase = 'observe-zero-control';
      else if (sceneHash === definition.setupScene.hash && zeroControl) {
        try { baselineGraph = { ...graph(currentGraph) }; baselineSpacing = spacing(releaseGesture); } catch (error) { return fail(error.message); }
        if (typeof currentSound !== 'string' || !currentSound || currentSound.length > 16384) return fail('The effective setup sound identity is unavailable.');
        soundIdentity = currentSound; phase = 'predict';
      } else return fail('Load the exact empty control before this exact setup scene.');
      report(); return state();
    },
    predict(value) { if (disposed || phase !== 'predict' || typeof value !== 'string' || !value.trim() || value.length > 512) throw new TypeError('Write a short prediction before observing the baseline.'); prediction = value.trim(); phase = 'observe-baseline'; report(); },
    observe({ batch, intents = [], receipts = [], context } = {}) {
      if (disposed || !binding || !['observe-zero-control', 'observe-baseline', 'perform-intervention', 'physical-evidence-observed'].includes(phase)) return false;
      if (!context || context.documentEpoch !== binding.documentEpoch || batch?.worldId !== binding.worldId || batch?.generation !== binding.generation) return fail('The lesson world or document changed. Reset to a fresh control.');
      if (batch.version !== 1 || !integer(batch.tick) || !Array.isArray(batch.facts) || batch.facts.length > 8192 || !Array.isArray(intents) || intents.length > 8192 || batch.completeness?.status !== 'complete' || batch.completeness.dropped !== 0 || batch.terminalGenerationTransition) return fail('This batch is incomplete or terminal; no lesson success was inferred.');
      if (batch.batchId === lastBatch) return false;
      const prefix = binding.worldId + ':' + binding.generation + ':' + batch.tick + ':', suffix = typeof batch.batchId === 'string' && batch.batchId.startsWith(prefix) ? batch.batchId.slice(prefix.length) : '', ordinal = /^\d+$/.test(suffix) ? Number(suffix) : -1;
      if (!integer(ordinal) || batch.tick < lastTick || batch.tick === lastTick && ordinal !== lastOrdinal + 1 || lastTick >= 0 && batch.tick > lastTick + 1 || batch.tick > lastTick && ordinal !== 0) return fail('Lesson observation lost its contiguous physical boundary.'); lastTick = batch.tick; lastOrdinal = ordinal; lastBatch = batch.batchId;
      if (phase === 'observe-zero-control') {
        if (!Array.isArray(batch.snapshot?.actors) || batch.snapshot.actors.length || context.activeActors !== 0 || intents.some(intent => intent.kind === 'begin') || batch.facts.some(fact => fact.actorId != null)) return fail('The zero-note control contains an actor or onset. Reload its empty scene.');
        zeroControl = { batchId: batch.batchId, worldId: batch.worldId, generation: batch.generation, observedNoActors: true, observedNoOnsets: true }; binding = null; phase = 'load-setup'; report(); return true;
      }
      if (phase === 'physical-evidence-observed') { for (const receipt of receipts) observeReceipt(receipt, context.documentEpoch); return false; }
      if (!intents.some(intent => intent.kind === 'begin' && definition.success.mappingIds.includes(intent.mappingId))) return false;
      let currentGraph, currentSpacing;
      try { currentGraph = graph(context.graph); currentSpacing = spacing(context.releaseGesture); } catch (error) { return fail(error.message); }
      if (context.soundIdentity !== soundIdentity || currentGraph.other !== baselineGraph.other) return fail('Sound or unrelated physical mappings changed. Reset, then change the lesson cause alone.');
      const intervention = definition.success.kind === 'pickup-relocation' ? currentGraph.geometry !== baselineGraph.geometry && currentSpacing === baselineSpacing : currentGraph.geometry === baselineGraph.geometry && currentSpacing !== baselineSpacing;
      if (phase === 'observe-baseline' && (currentGraph.geometry !== baselineGraph.geometry || currentSpacing !== baselineSpacing)) return fail('Observe the unchanged baseline first, then perform the intervention.');
      if (phase === 'perform-intervention' && !intervention) { reason = 'Waiting for the declared physical intervention and its actual new crossing.'; report(); return false; }
      const facts = new Map(batch.facts.map(fact => [fact.eventId, fact])); let updated = false;
      for (const intent of intents) {
        if (intent.kind !== 'begin' || intent.worldId !== binding.worldId || intent.generation !== binding.generation || intent.batchId !== batch.batchId || !definition.success.mappingIds.includes(intent.mappingId) || intent.physicalSourceKind !== 'PickupCrossing' || intent.observation?.gateId !== definition.success.pickupId || !intent.sourceEventIds?.length || intent.sourceEventIds.length > 8 || !intent.sourceEventIds.every(id => facts.get(id)?.kind === 'MotionCommitted' && facts.get(id).actorId === intent.actorId && facts.get(id).worldId === batch.worldId && facts.get(id).generation === batch.generation && facts.get(id).batchId === batch.batchId)) continue;
        const actor = batch.snapshot?.actors?.find(item => item.actorId === intent.actorId);
        if (!actor || !integer(actor.spawnTick) || typeof intent.intentId !== 'string' || !intent.intentId || [...baseline, ...changed].some(record => record.intentId === intent.intentId)) continue;
        const target = phase === 'observe-baseline' ? baseline : changed;
        if (target.length >= definition.success.minimumActors || target.some(record => record.actorId === intent.actorId) || target === changed && baseline.some(record => record.actorId === intent.actorId)) continue;
        target.push({ intentId: intent.intentId, batchId: batch.batchId, actorId: intent.actorId, sourceEventIds: [...intent.sourceEventIds], arrivalTick: batch.tick, birthTick: actor.spawnTick, pickupGeometry: currentGraph.geometry, precision: 'completed-tick-arrival-and-exact-birth-tick' }); updated = true;
      }
      if (!updated) return false;
      if (phase === 'observe-baseline' && baseline.length === definition.success.minimumActors) { phase = 'perform-intervention'; reason = null; }
      else if (phase === 'perform-intervention' && changed.length === definition.success.minimumActors) {
        if (definition.success.kind === 'entry-spacing-change' && (interval(baseline, 'birthTick') === interval(changed, 'birthTick') || interval(baseline, 'arrivalTick') === interval(changed, 'arrivalTick'))) { for (const record of changed) accepted.delete(record.intentId); changed = []; reason = 'The requested change has not produced different actual birth and arrival intervals. Explore another finite phrase.'; }
        else { phase = 'physical-evidence-observed'; reason = null; persist(); }
      }
      for (const receipt of receipts) observeReceipt(receipt, context.documentEpoch); report(); return true;
    },
    observeReceipt,
    reportHearing() { if (phase !== 'physical-evidence-observed' || !changed.every(record => accepted.has(record.intentId))) throw new Error('Physical evidence and matching backend acceptance are required before reporting hearing.'); reportedHearing = true; persist(); report(); },
    reset() { if (!definition || disposed) return; clearAttempt(); zeroControl = null; phase = 'load-zero-control'; report(); },
    skip() { clearAttempt(); zeroControl = null; phase = 'skipped'; report(); },
    suspend() { clearAttempt(); zeroControl = null; phase = 'closed'; report(); },
    dispose() { disposed = true; clearAttempt(); definition = null; zeroControl = null; phase = 'disposed'; }
  });
}
