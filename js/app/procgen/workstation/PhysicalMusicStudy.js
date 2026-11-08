import { physicalCounterfactualPolicy } from './PhysicalCounterfactual.js';
import { encodePhysicalCounterfactualFrame } from './PhysicalCounterfactualFrame.js';
import { canonicalDataText, hashDataText, freezeData } from '../../../core/CanonicalData.js';
import { createResourceBudget } from '../../resources/ResourceBudget.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { yieldBackgroundTask } from '../../resources/BackgroundTaskYield.js';
import { getActiveExecutionIdentity } from '../../../runtime/ActiveExecutionIdentity.js';
import { LemmingStateType as State } from '../../../lemmings/LemmingStateType.js';
import { prepareProcgenSimulationRealm } from '../ProcgenSimulationRealm.js';
import { prepareProcgenInspectionWorld } from './ProcgenInspectionWorld.js';
import { restoreProcgenCheckpoint, captureProcgenCheckpoint } from './ProcgenCheckpoint.js';
import { hashProcgenContinuationCheckpoint } from './ProcgenCheckpointProvenance.js';
import { readTerrainCell } from '../TerrainAuthoringAdapter.js';
import { createBranchPrefixCache, createBranchPrefixSource } from './BranchPrefixCache.js';
import { buildPhysicalMusicStudyInputs } from './PhysicalMusicStudyCommands.js';
import { summarizePhysicalMusicStudyMetrics } from './PhysicalMusicStudyMetrics.js';
import { validatePhysicalMusicGoal, enumeratePhysicalMusicCandidates, evaluatePhysicalMusicGoal, evaluatePhysicalMusicInvariants } from './PhysicalMusicGoal.js';

const MiB = 1048576, encoded = value => canonicalDataText(value, { maxBytes: 8 * MiB, maxNodes: 524288 }).text;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const compactCorrespondence = async values => {
  const dictionary = [], indices = [], lookup = new Map();
  for (const value of values) {
    const key = encoded(value); let index = lookup.get(key);
    if (index === undefined) { index = dictionary.length; lookup.set(key, index); dictionary.push(value); }
    indices.push(index);
  }
  return { schema: 'lemmings-physical-cause-dictionary/v1', count: values.length, sha256: await hashDataText(encoded(values)), dictionary, indices };
};
const live = actor => !actor.removed && !actor.disabled && !actor.failureReason && !actor.terminalReason;
const inside = (actor, b) => actor.x >= b.x1 && actor.x < b.x2 && actor.y >= b.y1 && actor.y < b.y2;
const boundaryOf = source => source.world.graph.owners.find(owner => owner.name === 'world').props;
const copy = value => JSON.parse(encoded(value));
const retire = async owner => { if (!owner) return; const receipt = owner.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') fail('physical-study-retirement', 'The isolated study owner did not retire completely.'); };
function protectedCells(world, goal) {
  const cells = []; let count = 0;
  for (const b of goal.crewConstraints.protectedRegions) {
    count += (b.x2 - b.x1) * (b.y2 - b.y1); if (count > 8192) fail('physical-study-domain', 'Protected collision terrain exceeds the8192-cell study profile.');
    for (let y = b.y1; y < b.y2; y++) for (let x = b.x1; x < b.x2; x++) { const cell = readTerrainCell(world, x, y); if (cell.status !== 'complete') fail('physical-study-domain', 'Protected source terrain must be fully materialized.'); cells.push([x, y, !!cell.color, cell.steel]); }
  }
  return cells;
}
function admitSource(world, goal, mode) {
  const actors = world.actors.filter(live), population = world.population, finite = !world.cohorts || !population.pendingReleaseGesture && !population.adaptive &&
    (population.releaseGesture?.paused === true || population.gestureRun?.remaining === 0);
  if (world._failedTick || world.interventionState.pending.length || !actors.length || actors.length > goal.crewConstraints.maximumActors || world.actors.length !== actors.length || actors.some(actor => !inside(actor, goal.crewConstraints.containment))) fail('physical-study-domain', 'Study one completed source with a bounded living crew inside its declared containment and no pending inputs.');
  if (mode !== 'sensitivity' && goal.allowedEdits.some(edit => edit.kind.startsWith('release-') || ['junction-configuration', 'layer-muted'].includes(edit.kind))) fail('physical-study-domain', 'Release, junction and contingent-layer control samples belong to sensitivity studies; initial inverse search keeps the declared wall/pickup/shared-skill domain.');
  if (mode !== 'sensitivity' && (world.assists !== false || !finite || actors.some(actor => actor.canClimb || actor.hasParachute || ![world.actions[State.WALKING], world.actions[State.FALLING]].includes(actor.action))))
    fail('physical-study-domain', 'Goal search currently requires ordinary walking/falling actors, assistance off, and an unchanged finite/paused release policy with no future births.');
  const b = goal.crewConstraints.containment; if (b.x1 < world.leftEdgeX || b.x2 > world.width || b.y2 > world.height) fail('physical-study-domain', 'Containment leaves the actual source world.');
  return { actorIds: actors.map(actor => actor.id).sort((a, b) => a - b), generation: world.generation, protected: protectedCells(world, goal), finite, assists: world.assists,
    release: copy(population.snapshot()), initialActorCount: actors.length };
}
const emptyTrace = (heldVoices = []) => ({ heldVoices: [...heldVoices], maximumSemanticPolyphony: heldVoices.length, polyphonySum: 0, polyphonyBoundaries: 0, motifOccurrences: [], restObservations: [], births: 0, terminations: 0, censoredObservations: [], frames: [], projectionFailures: [], causeObservations: [], actorDisplacements: [], onsets: [], causeKinds: [], factCount: 0, packetHashes: [], correspondence: [], discontinuities: [], safetyFailures: [], rejectedInputs: [], minimumLiving: null, maximumLiving: 0, terrainRevision: null });
const addUnique = (array, value) => { if (!array.includes(value)) array.push(value); };
function observeSafety(world, goal, trace, source, mode) {
  const actors = world.actors.filter(live), ids = new Set(actors.map(actor => actor.id));
  trace.minimumLiving = Math.min(trace.minimumLiving ?? actors.length, actors.length); trace.maximumLiving = Math.max(trace.maximumLiving, actors.length);
  if (world.generation !== source.generation) addUnique(trace.safetyFailures, 'generation-changed');
  if (source.actorIds.some(id => !ids.has(id))) addUnique(trace.safetyFailures, 'initial-crew-lost');
  if (actors.some(actor => !inside(actor, goal.crewConstraints.containment))) addUnique(trace.safetyFailures, 'containment-left');
  if (actors.length > goal.crewConstraints.maximumActors) addUnique(trace.safetyFailures, 'crew-bound-exceeded');
  if (mode !== 'sensitivity' && actors.some(actor => !source.actorIds.includes(actor.id))) addUnique(trace.safetyFailures, 'new-actor-outside-finite-domain');
  if (trace.terrainRevision !== world.terrainRevision) {
    for (const [x, y, solid, steel] of source.protected) { const cell = readTerrainCell(world, x, y); if (cell.status !== 'complete') addUnique(trace.safetyFailures, 'protected-terrain-unknown'); else if (!!cell.color !== solid || cell.steel !== steel) addUnique(trace.safetyFailures, 'protected-terrain-changed'); }
    trace.terrainRevision = world.terrainRevision;
  }
}
export async function runPhysicalMusicStudy(input, { signal, current = () => true, estimatedPeakBytes = 384 * MiB, onProgress = () => {}, yieldControl = yieldBackgroundTask,
  createWorld = prepareProcgenInspectionWorld, executionIdentity = getActiveExecutionIdentity('browser-background-jobs'), now = () => globalThis.performance.now() } = {}) {
  const goal = validatePhysicalMusicGoal(input?.goal), mode = input?.mode || 'search', source = input?.source, useCache = input?.cacheEnabled !== false;
  if (input?.cacheEnabled != null && typeof input.cacheEnabled !== 'boolean' || !['search', 'sensitivity', 'comparison'].includes(mode) || estimatedPeakBytes < 192 * MiB || estimatedPeakBytes > 512 * MiB || !source?.world || !source.engine || !source.authoring || !source.performance || source.replay?.playing !== true || typeof input.rootPath !== 'string' ||
      input.applicationBuildId !== executionIdentity.buildId || executionIdentity.activeExecution !== 'bound') fail('physical-study-contract', 'An isolated study requires its bound executing build, complete physical/musical source and admitted world/cache workspace.');
  const sourceBytes = canonicalDataText(source, { maxBytes: 2 * MiB, maxNodes: 262144 }).bytes.length, start = boundaryOf(source), endTick = start.tickIndex + goal.horizon;
  if (!Number.isSafeInteger(endTick)) fail('physical-study-contract', 'The study horizon exceeds the exact physical tick range.');
  const enumerated = enumeratePhysicalMusicCandidates(goal);
  if (mode === 'search' && goal.observationOnly || mode === 'comparison' && (!goal.observationOnly || goal.budgets.maximumCandidates < 2 || goal.allowedEdits.some(edit => edit.values.length !== 1))) fail('physical-study-contract', 'Comparison observes one concrete proposal; inverse search requires an actual requested metric.');
  const domain = mode === 'comparison' ? { ...enumerated, candidates: [{ id: goal.id + ':reference', values: {}, edits: [], reference: true }, ...enumerated.candidates], totalCombinations: 2, completeDomainEnumerated: true, order: 'original-A-then-concrete-proposed-B' } : enumerated,
    comparisonPolicy = mode === 'comparison' ? physicalCounterfactualPolicy(input.comparisonPolicy || {}) : null;
  const rowLimits = { maxBytes: mode === 'comparison' ? 2 * MiB : 262144, maxNodes: mode === 'comparison' ? 131072 : 32768 };
  // Charge the complete bounded report domain, not the largest64-row workspace
  // for every small search. Source/trace/planned-command scratch stays separate.
  const reportBytes = Math.min(4 * MiB, domain.candidates.length * rowLimits.maxBytes),
    workspaceBytes = 16 * MiB + sourceBytes * 8 + reportBytes * 16;
  const budget = createResourceBudget({ limitBytes: estimatedPeakBytes }), storage = createOwnedResourceReservation({ budget, owner: 'physical-music-study', kind: 'bounded-source-trace-results-and-canonical-workspace', category: 'candidate', bytes: workspaceBytes }),
    candidateOrder = new Map(domain.candidates.map((candidate, index) => [candidate.id, index])), plannedInputs = new Map(), rows = [], started = now(),
    work = { logicalTicks: 0, computedTicks: 0, restoredTicks: 0, restoreMs: 0, verificationTicks: 0, verificationMs: 0, candidateCount: 0, retainedResultBytes: 2, retainedResultNodes: 1 };
  let cache = null, sourceTimeMs = null;
  const resultNodeLimit = 1 + domain.candidates.length * rowLimits.maxNodes;
  const retainRow = row => {
    const inventory = canonicalDataText(row, rowLimits), bytes = work.retainedResultBytes + inventory.bytes.length + (rows.length ? 1 : 0), nodes = work.retainedResultNodes + inventory.nodes;
    if (bytes > 4 * MiB || nodes > resultNodeLimit) fail('physical-study-report-capacity', 'Complete retained sample reports exceed their4MiB or composed row-node profile.');
    rows.push(row); work.retainedResultBytes = bytes; work.retainedResultNodes = nodes;
  };
  let constraints = null, selected = null, reference = null, timeout = false, logicalLimit = false, planningOwner = null, planningWorld = null, basePhysicalHash = null;
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('physical-study-stale', 'The study source changed.'); };
  let sourceIdentity = null;
  const initialHeld = (source.engine.active || []).map(voice => JSON.stringify([start.worldId, voice.generation, voice.voiceId]));
  const run = async (candidate, { fresh = false, allUpfront = false } = {}) => {
    let realm = null, world = null, reader = null, trace = emptyTrace(initialHeld), held = new Set(initialHeld), consumed = 0, appliedInitial = null, auditionInitial = null, inputs = null, editCost = 0, patchHash = null;
    const packet = async value => {
      const batch = value.batch, analysis = realm.physicalAnalysis(), derived = analysis?.batchId === batch.batchId ? analysis.facts || [] : [];
      if (batch.completeness?.status !== 'complete' || analysis?.completeness.status === 'censored') addUnique(trace.censoredObservations, 'incomplete-physical-or-derived-observation');
      trace.factCount += batch.facts.length + derived.length;
      if (trace.factCount > (goal.budgets.maximumFacts ?? 65536)) fail('physical-study-trace', 'The complete physical trace exceeds its admitted fact profile.');
      const causal = [];
      for (const fact of [...batch.facts, ...derived]) {
        const kind = typeof fact.kind === 'string' && fact.kind ? fact.kind : typeof fact.type === 'string' && fact.type ? 'sfx:' + fact.type : null;
        if (!kind) fail('physical-study-trace', 'A source fact needs its physical or SFX discriminator.');
        addUnique(trace.causeKinds, kind);
        if (kind === 'MotionCommitted') { let distance = trace.actorDisplacements.find(value => value.actorId === fact.actorId);
          if (!distance) { if (trace.actorDisplacements.length >= 64) fail('physical-study-trace', 'Actual motion tracking exceeds the64-actor study profile.'); distance = { actorId: fact.actorId, accumulatedEndpointPixels: 0, knownMotions: 0, unknownMotions: 0, evidenceKinds: [] }; trace.actorDisplacements.push(distance); }
          if (Number.isFinite(fact.physicalPayload?.displacementPixels) && fact.physicalPayload.displacementPixels >= 0) { distance.accumulatedEndpointPixels += fact.physicalPayload.displacementPixels; distance.knownMotions++; addUnique(distance.evidenceKinds, fact.physicalPayload.pathEvidence || 'unspecified'); } else distance.unknownMotions++;
        }
        if (kind !== 'MotionCommitted') causal.push([kind, fact.actorId ?? fact.lemmingId ?? null, fact.laneId ?? fact.laneIndex ?? null, fact.action ?? null, fact.causeKind ?? null, fact.reason ?? null, fact.junctionId ?? null, fact.topologyBinding?.componentId ?? null, fact.gateId ?? null, fact.motifId ?? null, fact.routeId ?? null, fact.direction ?? null]);
        if (['CommandRejected', 'CommandWaiting', 'BirthAdmitted', 'BirthAdmissionMissed', 'ActorBorn', 'ActorRemoved', 'GenerationEnded', 'JunctionExpired'].includes(kind)) {
          if (trace.discontinuities.length >= 1024) fail('physical-study-trace', 'Discontinuity trace exceeds its complete admitted profile.');
          trace.discontinuities.push({ tick: batch.tick - start.tickIndex, kind: kind, actorId: fact.actorId ?? fact.lemmingId ?? null, commandId: fact.commandId ?? null, reason: fact.reason ?? null });
        }
        if (mode === 'comparison' && kind !== 'MotionCommitted') {
          if (trace.causeObservations.length >= 8192) fail('physical-study-trace', 'The complete compared-cause trace exceeds its8192-observation profile.');
          trace.causeObservations.push({ tick: batch.tick - start.tickIndex, kind: kind, actorId: fact.actorId ?? fact.lemmingId ?? null, identity: causal.at(-1), eventId: fact.observationId || fact.eventId || null,
            position: fact.positionAfter || fact.position || null, sourceEventIds: fact.sourceEventIds || (fact.eventId ? [fact.eventId] : []) });
        }
        if (kind === 'ActorBorn') trace.births++; if (kind === 'ActorTerminated') trace.terminations++;
        if (['MotifCompleted', 'RestStarted', 'RestEnded'].includes(kind)) { const collection = kind === 'MotifCompleted' ? trace.motifOccurrences : trace.restObservations;
          if (collection.length >= 512) fail('physical-study-trace', 'Complete motif/rest observations exceed the admitted study profile.');
          collection.push({ kind: kind, tick: batch.tick - start.tickIndex, motifId: fact.motifId ?? null, actorId: fact.actorId ?? fact.lemmingId ?? null, sourceEventIds: fact.sourceEventIds || (fact.eventId ? [fact.eventId] : []) });
        }
        if (kind === 'CommandRejected') addUnique(trace.rejectedInputs, fact.commandId);
      }
      if (causal.length) trace.correspondence.push(...causal);
      for (const intent of value.intents) { const key = JSON.stringify([intent.worldId, intent.generation, intent.voiceId]);
        if (intent.kind === 'begin') held.add(key); else if (intent.kind === 'end') held.delete(key);
        if (held.size > 4096) fail('physical-study-trace', 'Semantic voice tracking exceeds the complete4096-voice profile.');
        trace.maximumSemanticPolyphony = Math.max(trace.maximumSemanticPolyphony, held.size);
      }
      trace.heldVoices = [...held].sort(); trace.polyphonySum += held.size; trace.polyphonyBoundaries++;
      for (const intent of value.intents) if (intent.kind === 'begin') {
        addUnique(trace.causeKinds, intent.physicalSourceKind);
        if (trace.onsets.length >= (goal.budgets.maximumOnsets ?? 2048)) fail('physical-study-trace', 'The complete actual-onset trace exceeds its admitted profile.');
        const time = intent.scoreTime, tick = (time?.simTick ?? batch.tick) + (time?.subTick ?? 0) - start.tickIndex;
        if (tick < 0 || tick > goal.horizon) fail('physical-study-time', 'A derived onset leaves the declared physical source horizon.');
        trace.onsets.push({ intentId: intent.intentId, timeTicks: tick, mappingId: intent.mappingId, role: intent.role, laneId: intent.laneId, actorId: intent.actorId, sourceEventIds: intent.sourceEventIds,
          sourceKind: intent.physicalSourceKind, pitchCents: intent.pitch.cents, topologyComponent: intent.topologyBinding?.componentId ?? null });
      }
      trace.packetHashes.push(await hashDataText(encoded({ batch, intents: value.intents, bodyCommands: value.bodyCommands })));
      observeSafety(world, goal, trace, constraints, mode); return { accepted: true };
    };
    const prepare = async continuation => {
      realm = await prepareProcgenSimulationRealm({ resourceBudget: budget, signal, requiredConsumer: packet,
        manifest: { schema: 'lemmings-authoritative-simulation/v1', ownerId: 'physical-music-study', ownerEpoch: 1, documentRevision: input.projectRevision, resourceProfile: 'compact-v1', rootPath: input.rootPath,
          executionPolicy: continuation.executionPolicy || null, checkpoint: continuation.world, semantic: continuation.engine, timeline: continuation.timeline, performance: continuation.performance, graph: continuation.authoring.graph,
          ...continuation.replay }, createWorld: async options => { const owner = await createWorld(options); world = owner.world; return owner; } });
    };
    const captureFrame = async () => {
      if (mode !== 'comparison' || trace.projectionFailures.length) return; const tick = world.tickIndex - start.tickIndex, stride = Math.max(1, Math.ceil(goal.horizon / 13));
      if (trace.frames.at(-1)?.relativeTick === tick || tick !== 0 && tick !== 1 && tick !== goal.horizon && tick % stride) return;
      let frame = null;
      try { const b = goal.crewConstraints.containment, firstLane = Math.min(world.laneCount - 1, Math.floor(b.y1 / world.laneHeight));
        frame = await realm.host.project({ x: b.x1, firstLane, laneCount: Math.max(1, Math.min(4, Math.ceil((b.y2 - firstLane * world.laneHeight) / world.laneHeight))), width: Math.max(64, Math.min(512, b.x2 - b.x1)), pixelWidth: 128, pixelHeight: 128 }, { signal });
        if (trace.frames.length >= 16) fail('physical-study-trace', 'The compared frame schedule exceeds its16-boundary profile.');
        trace.frames.push(encodePhysicalCounterfactualFrame(frame.read(), start.tickIndex));
      } catch (error) { check(); trace.projectionFailures.push({ tick, reason: error.message }); } finally { frame?.release(); }
    };
    try {
      const planned = plannedInputs.get(candidate.id); if (planned.error) throw planned.error;
      ({ inputs, editCost, patchHash } = planned);
      if (!fresh && cache) reader = await cache.borrow({ source: sourceIdentity, inputs, throughTick: endTick, signal });
      if (reader) {
        const restored = reader.read(), restoreStarted = now(); await prepare(restored);
        const actual = await realm.host.checkpoint({ signal, maxGraphBytes: 2 * MiB, maxSemanticBytes: MiB, semanticPeakBytes: 16 * MiB });
        if (await reader.verify(actual)) { trace = copy(restored.study); held = new Set(trace.heldVoices); consumed = reader.receipt.appliedInputCount; work.restoredTicks += world.tickIndex - start.tickIndex; work.restoreMs += Math.max(0, now() - restoreStarted); }
        else { reader.invalidate(); await retire(realm.host); realm = null; await prepare(source); trace = emptyTrace(initialHeld); held = new Set(initialHeld); }
        reader.release(); reader = null;
      } else await prepare(source);
      observeSafety(world, goal, trace, constraints, mode);
      const admit = item => { if (item.feedbackControl) { if (item.tick !== world.tickIndex) fail('physical-study-input', 'A sampled layer control must execute at its declared completed boundary.'); realm.controlPhysicalFeedback(item.feedbackControl); return; }
        const proposal = world.prepareIntervention(item.command); if (proposal.outcome.status !== 'queued') fail('physical-study-input', 'Candidate input refused: ' + (proposal.outcome.reason || proposal.outcome.status)); proposal.commit(); };
      if (allUpfront) { for (const item of inputs) admit(item); consumed = inputs.length; auditionInitial = await realm.host.checkpoint({ signal, maxGraphBytes: 2 * MiB, maxSemanticBytes: MiB, semanticPeakBytes: 16 * MiB }); }
      await captureFrame();
      while (world.tickIndex < endTick) {
        check();
        if (!fresh && goal.budgets.wallTimeMs != null && now() - started >= goal.budgets.wallTimeMs) { timeout = true; break; }
        if (!fresh && cache && inputs[consumed]?.tick === world.tickIndex && world.tickIndex > start.tickIndex) {
          const continuation = await realm.host.checkpoint({ signal, maxGraphBytes: 2 * MiB, maxSemanticBytes: MiB, semanticPeakBytes: 16 * MiB });
          await cache.remember({ source: sourceIdentity, inputs: inputs.slice(0, consumed), continuation: { ...continuation, study: trace }, signal });
        }
        while (consumed < inputs.length && inputs[consumed].tick === world.tickIndex) admit(inputs[consumed++]);
        if (inputs[consumed]?.tick < world.tickIndex) fail('physical-study-input', 'An input prefix did not restore its exact admission frontier.');
        await realm.host.advance({ steps: 1, timestamp: 0, signal });
        if (fresh) work.verificationTicks++; else work.computedTicks++;
        await captureFrame();
        if (allUpfront && world.tickIndex === start.tickIndex + 1) appliedInitial = await realm.host.checkpoint({ signal, maxGraphBytes: 2 * MiB, maxSemanticBytes: MiB, semanticPeakBytes: 16 * MiB });
        if (world.generation !== constraints.generation || mode !== 'sensitivity' && trace.safetyFailures.length) break;
        if ((world.tickIndex - start.tickIndex) % 16 === 0) { await yieldControl(); check(); }
      }
      const continuation = await realm.host.checkpoint({ signal, maxGraphBytes: 2 * MiB, maxSemanticBytes: MiB, semanticPeakBytes: 16 * MiB }), completed = world.tickIndex === endTick,
        semanticMetrics = summarizePhysicalMusicStudyMetrics(trace, { throughTicks: world.tickIndex - start.tickIndex, sourceTimeMs, finalTimeMs: world.simulationTimeMs, finalPopulation: copy(world.population.snapshot()),
          finalJunctions: world.physicalJunctions.definitions.map(definition => copy(world.queryJunction(definition.id, { includeDefinition: false }))),
          finalLayers: { mode: world.physicalFeedback.mode, epoch: world.physicalFeedback.epoch, muted: [...world.physicalFeedback.muted], totalProposals: world.physicalFeedback.total,
            rules: world.physicalFeedback.rules.map(rule => ({ key: rule.key, status: rule.status || 'unknown', fuel: rule.fuel, occurrences: rule.occurrences })), pendingCommandIds: world.interventionState.pending.filter(command => command.causality).map(command => command.id) } }),
        musical = evaluatePhysicalMusicGoal(goal, trace.onsets, { causeKinds: trace.causeKinds, editCost }), invariantResults = evaluatePhysicalMusicInvariants(goal, semanticMetrics),
        metrics = { ...musical, semanticMetrics, invariantResults, requestedMetricsMet: musical.requestedMetricsMet === true && invariantResults.allMet },
        causalTrace = Object.fromEntries(Object.entries(trace).filter(([key]) => !['frames', 'projectionFailures'].includes(key))), traceHash = await hashDataText(encoded(causalTrace)),
        physicalContinuationHash = await hashProcgenContinuationCheckpoint(continuation.world), continuationHash = await hashDataText(encoded({ physicalContinuationHash, engine: continuation.engine, timeline: continuation.timeline, replay: continuation.replay, executionPolicy: continuation.executionPolicy }));
      return { id: candidate.id, reference: candidate.reference === true, values: candidate.values, edits: candidate.edits, patchHash, baseContinuationHash: sourceIdentity.baseContinuationHash, mappingRevision: source.authoring.graph.revision, constraintRevision: goal.revision,
        status: completed && !trace.censoredObservations.length && !trace.safetyFailures.length && !trace.rejectedInputs.length ? 'sample-safe' : trace.safetyFailures.length || trace.rejectedInputs.length ? 'sample-failed' : 'unknown', completed,
        metrics, trace, traceHash, physicalContinuationHash, continuationHash, throughTick: world.tickIndex, appliedInitial, auditionInitial, inputs };
    } finally { reader?.release(); await retire(realm?.host); }
  };
  try {
    planningOwner = await createWorld({ checkpoint: source.world, rootPath: input.rootPath, resourceBudget: budget, signal }); planningWorld = planningOwner.world;
    restoreProcgenCheckpoint(planningWorld, source.world);
    basePhysicalHash = await hashProcgenContinuationCheckpoint(source.world);
    if (await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(planningWorld)) !== basePhysicalHash) fail('physical-study-source', 'The immutable planning world differs from the complete source.');
    constraints = admitSource(planningWorld, goal, mode);
    if (goal.allowedEdits.some(edit => edit.kind === 'layer-muted') && source.executionPolicy?.physicalFeedbackMode !== 'preserve-live') fail('physical-study-domain', 'Layer-mute sensitivity requires an explicitly armed source controller; the study does not arm a loaded project.');
    sourceIdentity = await createBranchPrefixSource({ continuation: source, graph: source.authoring.graph, performance: source.performance, sourceVersions: input.sourceVersions,
      executionIdentity, policy: { mode, goal, comparisonPolicy, sourceDelivery: 'completed-tick-before-next-input', liveOutput: 'none' }, projectRevision: input.projectRevision, resourceBudget: budget });
    sourceTimeMs = planningWorld.simulationTimeMs; let plannedBytes = 0;
    for (const candidate of domain.candidates) {
      check(); let plan;
      try { plan = await buildPhysicalMusicStudyInputs(planningWorld, goal, candidate, { baseTick: start.tickIndex, requestedAt: sourceTimeMs }); }
      catch (error) { check(); plannedInputs.set(candidate.id, { error }); continue; }
      plannedBytes += canonicalDataText(plan, { maxBytes: MiB, maxNodes: 65536 }).bytes.length;
      if (plannedBytes > MiB) fail('physical-study-plan-capacity', 'Complete planned command rows exceed the admitted workspace.');
      plannedInputs.set(candidate.id, plan);
    }
    // Only immutable plans and source metadata cross into candidate execution.
    // Retire the planning world before creating a replay world or cache.
    await retire(planningOwner); planningOwner = null; planningWorld = null;
    const reusablePrefixes = [...plannedInputs.values()].some(plan => plan.inputs?.some(input => input.tick > start.tickIndex));
    cache = useCache && reusablePrefixes ? createBranchPrefixCache({ resourceBudget: budget }) : null;
    for (const candidate of domain.candidates) {
      check(); if (goal.budgets.wallTimeMs != null && now() - started >= goal.budgets.wallTimeMs) { timeout = true; break; }
      if (work.logicalTicks + goal.horizon > goal.budgets.logicalTicks) { logicalLimit = true; break; }
      work.logicalTicks += goal.horizon; work.candidateCount++;
      try { const row = await run(candidate), retained = { ...row, trace: { ...row.trace, correspondence: await compactCorrespondence(row.trace.correspondence) }, appliedInitial: null, auditionInitial: null, inputs: null };
        retainRow(retained); }
      catch (error) { check(); if (['physical-study-retirement', 'physical-study-report-capacity'].includes(error.code) || !constraints) throw error;
        retainRow({ id: candidate.id, reference: candidate.reference === true, values: candidate.values, edits: candidate.edits, status: 'unknown', reason: error.message }); }
      onProgress({ phase: mode === 'comparison' ? 'comparing-original-and-proposed-real-futures' : mode === 'search' ? 'searching-real-physical-candidates' : 'sampling-real-physical-sensitivity', completedUnits: rows.length, totalUnits: domain.candidates.length, logicalTicks: work.logicalTicks, computedTicks: work.computedTicks,
        partial: { status: 'completed-samples-only;no-fresh-qualification', goal, mode, base: { worldId: start.worldId, generation: start.generation, tick: start.tickIndex, seed: source.world.seed, physicalHash: basePhysicalHash, projectRevision: input.projectRevision }, completed: rows.length, totalCombinations: domain.totalCombinations, omittedEarlierSamples: Math.max(0, rows.length - 16),
          baseContinuationHash: sourceIdentity.baseContinuationHash, mappingHash: sourceIdentity.mappingHash,
          samples: rows.slice(-16).map(row => ({ id: row.id, values: row.values, status: row.status, reason: row.reason || null, patchHash: row.patchHash || null,
            safetyFailures: row.trace?.safetyFailures || [], rejectedInputs: row.trace?.rejectedInputs || [],
            metrics: row.metrics ? { semantic: row.metrics.semanticMetrics ? { maximumSemanticPolyphony: row.metrics.semanticMetrics.semanticPolyphony.maximum, onsetsPer100Ticks: row.metrics.semanticMetrics.onsetsPer100Ticks,
              maximumOnsetFreeGapTicks: row.metrics.semanticMetrics.onsetFreeGaps.maximumTicks, births: row.metrics.semanticMetrics.crew.births, terminations: row.metrics.semanticMetrics.crew.terminations, motifCounts: row.metrics.semanticMetrics.motifCounts,
              realizedRelease: { adaptive: row.metrics.semanticMetrics.realizedReleasePolicy.adaptive, intervalTicks: row.metrics.semanticMetrics.realizedReleasePolicy.intervalTicks, gestureRun: row.metrics.semanticMetrics.realizedReleasePolicy.gestureRun || null } } : null,
            invariants: row.metrics.invariantResults || null, score: row.metrics.score ?? null, requestedMetricsMet: row.metrics.requestedMetricsMet ?? false, missed: row.metrics.missedTargets?.length ?? null, extra: row.metrics.extraActualOnsets?.length ?? null,
            periods: (row.metrics.periods || []).map(period => ({ selector: period.selector, observations: period.observations, meanTicks: period.meanTicks, minimumTicks: period.minimumTicks, maximumTicks: period.maximumTicks, satisfied: period.satisfied })) } : null })) } });
      await yieldControl();
    }
    if (mode === 'search' || mode === 'comparison') {
      const finalists = rows.filter(row => row.status === 'sample-safe' && row.metrics?.status === 'evaluated' && (mode !== 'comparison' || !row.reference)).sort((a, b) => Number(b.metrics.requestedMetricsMet) - Number(a.metrics.requestedMetricsMet) || a.metrics.score - b.metrics.score || candidateOrder.get(a.id) - candidateOrder.get(b.id)).slice(0, goal.budgets.finalists ?? 1);
      for (const finalist of finalists) {
        check(); const verifyStarted = now(), candidate = domain.candidates.find(candidate => candidate.id === finalist.id), verified = await run(candidate, { fresh: true, allUpfront: true });
        work.verificationMs += Math.max(0, now() - verifyStarted);
        const matches = verified.status === 'sample-safe' && verified.completed && verified.traceHash === finalist.traceHash && verified.continuationHash === finalist.continuationHash;
        finalist.verification = { mode: 'independent-fresh-world-no-prefix-cache;all-inputs-admitted-upfront', matched: matches, traceHash: verified.traceHash, continuationHash: verified.continuationHash, computedTicks: verified.throughTick - start.tickIndex };
        if (matches) { selected = { candidateId: finalist.id, applyContinuation: verified.appliedInitial, auditionContinuation: verified.auditionInitial, reviewedInputs: verified.inputs, verification: finalist.verification, requestedMetricsMet: verified.metrics.requestedMetricsMet }; break; }
      }
    }
    if (mode === 'comparison') { const original = rows.find(row => row.reference);
      if (original?.completed && !original.trace.censoredObservations.length) { const verifyStarted = now(), verified = await run(domain.candidates.find(candidate => candidate.reference), { fresh: true, allUpfront: true }); work.verificationMs += Math.max(0, now() - verifyStarted);
        original.verification = { mode: 'independent-fresh-original-world-no-prefix-cache', matched: verified.traceHash === original.traceHash && verified.continuationHash === original.continuationHash, traceHash: verified.traceHash, continuationHash: verified.continuationHash, computedTicks: verified.throughTick - start.tickIndex };
        if (original.verification.matched) reference = { candidateId: original.id, auditionContinuation: verified.auditionInitial, verification: original.verification };
      }
    }
    const complete = rows.length === domain.totalCombinations && rows.every(row => row.status === 'sample-failed' || row.status === 'sample-safe' && row.metrics?.status === 'evaluated'), metricsMet = selected?.requestedMetricsMet === true;
    return freezeData({ schema: 'lemmings-physical-music-study/v1', mode, operationEpoch: Number.isSafeInteger(input.operationEpoch) ? input.operationEpoch : 0, goal, sourceIdentity, sourceBytes, base: { worldId: start.worldId, generation: start.generation, tick: start.tickIndex, seed: source.world.seed, physicalHash: basePhysicalHash, projectRevision: input.projectRevision },
      status: mode === 'comparison' ? selected && reference && complete ? 'compared-fresh' : timeout ? 'timeout' : 'partial-comparison' : mode === 'sensitivity' ? complete ? 'sampled' : timeout ? 'timeout' : 'partial' : metricsMet ? 'qualified' : timeout ? 'timeout' : selected ? complete ? 'no-match-in-finite-domain' : 'partial' : 'unknown',
      rows, selected, reference, comparisonPolicy, domain: { ...domain, candidates: domain.candidates.map(candidate => ({ id: candidate.id, values: candidate.values })) }, constraints,
      work: { ...work, cache: cache ? { ...cache.state(), enabled: true } : { enabled: false }, peakAccountedBytes: budget.diagnostics().peakAccountedBytes, elapsedMs: Math.max(0, now() - started) },
      coverage: { completeDomain: complete, allCandidatesVisited: rows.length === domain.totalCombinations, unresolvedCandidates: rows.filter(row => row.status === 'unknown' || row.metrics?.status === 'unsupported').length, logicalLimit, wallTimeBestEffort: goal.budgets.wallTimeMs != null, timeout, untestedCandidates: domain.totalCombinations - rows.length,
        claim: 'only-the-declared-finite-grid;no-continuum-or-universal-satisfiability-claim', sourceUnchanged: true, outputs: 'none', validation: 'development-implementation;runtime-campaign-pending' } });
  } catch (error) {
    check(); if (error.code !== 'physical-study-domain') throw error;
    return freezeData({ schema: 'lemmings-physical-music-study/v1', mode, status: 'unsupported', reason: error.message, goal, sourceIdentity, sourceBytes,
      base: { worldId: start.worldId, generation: start.generation, tick: start.tickIndex, seed: source.world.seed, physicalHash: basePhysicalHash, projectRevision: input.projectRevision }, rows, selected: null, constraints,
      domain: { ...domain, candidates: domain.candidates.map(candidate => ({ id: candidate.id, values: candidate.values })) },
      work: { ...work, cache: cache ? { ...cache.state(), enabled: true } : { enabled: false }, elapsedMs: Math.max(0, now() - started) },
      coverage: { completeDomain: false, allCandidatesVisited: false, unresolvedCandidates: domain.totalCombinations, untestedCandidates: domain.totalCombinations - rows.length, sourceUnchanged: true, outputs: 'none', reason: error.message } });
  } finally { const settled = await Promise.allSettled([retire(cache), retire(planningOwner)]); if (settled.some(result => result.status === 'rejected')) throw new AggregateError(settled.filter(result => result.status === 'rejected').map(result => result.reason), 'Physical study retirement is unresolved.'); storage.release(); }
}
