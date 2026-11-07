import { validateFeedbackCausality, FEEDBACK_COMMANDS } from './workstation/physical/PhysicalFeedbackSchema.js';
import { validateReleaseGesture } from './ReleaseGesture.js';
import { normalizePhysicalAuthoringCommand, preparePhysicalAuthoringCommand, applyPhysicalAuthoringCommand } from './PhysicalAuthoring.js';
import { normalizeJunctionRequest, applyJunctionRequest, normalizeJunctionDefinitionCommand, applyJunctionDefinition } from './PhysicalJunctions.js';
import { normalizeTerrainCommand, planTerrainCommand, applyTerrainPlan } from './TerrainAuthoringAdapter.js';
import { recordProcgenRecoveryCommand, recordProcgenRecoveryCancellation } from './workstation/ProcgenRecoveryJournal.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { validateCausalProbabilityPolicy, causalNamespaceSeed, createCausalProbabilityContext, causalPolicyDecision } from './workstation/CausalProbabilityPolicy.js';

const ORIGIN_PRIORITY = Object.freeze({ manual: 0, 'live-controller': 0, replay: 0, layer: 1, ensemble: 1, conductor: 2, 'auto-assist': 3 });
const KINDS = new Set(['assign-worker', 'place-blocker', 'release-blocker', 'set-release-gesture', 'set-release-policy', 'nuke-lane', 'nuke-all', 'terrain-edit', 'junction-request', 'junction-define', 'physical-authoring']);
const boundedId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const plain = value => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const createInterventionState = () => ({ version: 1, pending: [], pendingBytes: 0, receipts: [], recentIds: [], sequence: 0 });

// Runtime methods stay outside the checkpoint data. The existing world graph
// serializer carries this bounded plain state, including still-pending inputs.
const enqueueIntervention = (world, command) => {
  const state = world.interventionState;
  if (world._disposed) throw new Error('Cannot enqueue interventions on a disposed world.');
  if (!plain(command) || !boundedId(command.id) || !KINDS.has(command.kind) || !plain(command.target) ||
      !Number.isSafeInteger(command.target.generation) || !Object.hasOwn(ORIGIN_PRIORITY, command.origin ?? 'manual') ||
      !Number.isFinite(command.requestedAt ?? world.simulationTimeMs) || (command.requestedAt ?? world.simulationTimeMs) < 0 ||
      !Number.isSafeInteger(command.applyAtTick ?? world.tickIndex + 1) || (command.applyAtTick ?? world.tickIndex + 1) <= world.tickIndex ||
      command.applyAtTick > world.tickIndex + 36000 ||
      command.expectedStateRevision != null && !boundedId(command.expectedStateRevision) ||
      command.transactionId != null && !boundedId(command.transactionId) ||
      command.coalesceKey != null && (!boundedId(command.coalesceKey) || command.kind !== 'set-release-policy') ||
      command.probability01 != null && (!Number.isFinite(command.probability01) || command.probability01 < 0 || command.probability01 > 1)) {
    throw new Error('Invalid intervention command.');
  }
  if (state.recentIds.includes(command.id) || state.pending.some(item => item.id === command.id)) {
    return Object.freeze({ status: 'rejected', commandId: command.id, reason: 'duplicate-command' });
  }
  const probability = validateCausalProbabilityPolicy(command.probability);
  if (probability && !['assign-worker', 'place-blocker', 'release-blocker', 'junction-request'].includes(command.kind)) throw new Error('Conditional physical branching permits only owned worker/blocker/junction affordances.');
  if (probability?.conditions.some(condition => !['crowdCellCount', 'actorAction', 'terrainSolidBelow'].includes(condition.descriptor))) throw new Error('Physical branch conditions require current local affordance descriptors.');
  const causality = command.causality == null ? null : validateFeedbackCausality(command.causality);
  if (command.eligibilityUntilTick != null && (!causality || !Number.isSafeInteger(command.eligibilityUntilTick) || command.eligibilityUntilTick < (command.applyAtTick ?? world.tickIndex + 1) || command.eligibilityUntilTick > world.tickIndex + 601)) throw new Error('Invalid physical eligibility deadline.');
  const parameters = {};
  if (command.kind === 'set-release-gesture') { if (!world.cohorts) throw new Error('Release gestures require physical cohort admission.'); parameters.gesture = validateReleaseGesture(command.parameters?.gesture, world.laneCount); }
  if (command.kind === 'physical-authoring') {
    parameters.authoring = normalizePhysicalAuthoringCommand(world, command.parameters?.authoring);
    if (parameters.authoring.transactionId !== command.transactionId) throw new Error('Physical authoring transaction identity mismatch.');
    const preview = preparePhysicalAuthoringCommand(world, parameters.authoring); if (preview.status !== 'prepared') return Object.freeze({ status: 'rejected', commandId: command.id, reason: preview.reason });
  }
  if (command.kind === 'junction-request') {
    parameters.request = normalizeJunctionRequest(world, command.parameters?.request);
    if (state.pending.filter(entry => entry.kind === 'junction-request').length >= 64 && !(parameters.request.coalesce && state.pending.some(entry => entry.kind === 'junction-request' && entry.parameters.request.junctionId === parameters.request.junctionId && entry.origin === (command.origin ?? 'manual')))) return Object.freeze({ status: 'rejected', commandId: command.id, reason: 'junction-request-capacity' });
  }
  if (command.kind === 'junction-define') parameters.definition = normalizeJunctionDefinitionCommand(command.parameters?.definition);
  if (command.kind === 'terrain-edit') {
    const normalized = normalizeTerrainCommand(command.parameters?.terrain);
    if (normalized.generation !== command.target.generation || command.transactionId !== normalized.transactionId) throw new Error('Terrain command identity mismatch.');
    const preview = planTerrainCommand(normalized, world);
    if (preview.status !== 'prepared') return Object.freeze({ status: 'rejected', commandId: command.id, reason: preview.reason });
    parameters.terrain = preview.command;
    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }; freeze(parameters.terrain);
  }
  for (const [key, value] of Object.entries(['set-release-gesture', 'terrain-edit', 'junction-request', 'junction-define', 'physical-authoring'].includes(command.kind) ? {} : command.parameters || {})) {
    if (key === 'trackCrew') { if (command.kind !== 'assign-worker' || typeof value !== 'boolean') throw new Error('Crew tracking requires an explicit worker-command boolean.'); parameters[key] = value; continue; }
    if (!['workerKind', 'targetX', 'spawnBeatTicks', 'spawnSpreadTicks'].includes(key) ||
        !(typeof value === 'string' && value.length <= 32 || Number.isFinite(value))) throw new Error('Unsupported intervention parameter.');
    parameters[key] = value;
  }
  const target = { generation: command.target.generation };
  if (['set-release-gesture', 'set-release-policy', 'nuke-all', 'terrain-edit', 'junction-request', 'junction-define', 'physical-authoring'].includes(command.kind)) {
    if (command.target.laneId != null) throw new Error('Release policy currently targets the whole world.');
  } else if (command.kind === 'nuke-lane') {
    if (!Number.isSafeInteger(command.target.laneId) || command.target.laneId < 0 || command.target.laneId >= world.laneCount) throw new Error('Invalid nuke lane.');
    target.laneId = command.target.laneId;
  } else {
    if (!Number.isSafeInteger(command.target.actorId) || command.target.actorId < 0) throw new Error('Intervention needs a stable actor ID.');
    target.actorId = command.target.actorId;
  }
  if (!Number.isSafeInteger(state.sequence + 1)) throw new RangeError('Intervention sequence exhausted.');
  const draft = { version: 1, ...(causality ? { causality, eligibilityUntilTick: command.eligibilityUntilTick ?? command.applyAtTick ?? world.tickIndex + 1 } : {}), id: command.id, kind: command.kind, target: Object.freeze(target),
    parameters: Object.freeze(parameters), requestedAt: command.requestedAt ?? world.simulationTimeMs,
    applyAtTick: command.applyAtTick ?? world.tickIndex + 1, ...(command.kind === 'junction-request' ? { requestedBoundaryTick: command.applyAtTick ?? world.tickIndex + 1 } : {}), origin: command.origin ?? 'manual',
    expectedStateRevision: command.expectedStateRevision ?? null, transactionId: command.transactionId ?? null,
    coalesceKey: command.coalesceKey ?? null,
    ...(probability ? { probability } : {}), probability01: command.probability01 ?? 1, sequence: state.sequence + 1 };
  const entry = Object.freeze({ ...draft, storageBytes: JSON.stringify(draft).length * 2 + 256 });
  const replaceJunction = entry.kind === 'junction-request' && entry.parameters.request.coalesce || entry.kind === 'junction-define' && entry.parameters.definition.replacePending;
  const replacing = new Set();
  if (replaceJunction) { const field = entry.kind === 'junction-request' ? 'request' : 'definition'; for (const previous of state.pending) if (previous.kind === entry.kind && previous.parameters[field].junctionId === entry.parameters[field].junctionId && previous.target.generation === entry.target.generation && previous.origin === entry.origin) replacing.add(previous); }
  const coalesced = state.pending.at(-1);
  if (entry.coalesceKey && coalesced?.coalesceKey === entry.coalesceKey && coalesced.kind === entry.kind && coalesced.transactionId === entry.transactionId && coalesced.applyAtTick === entry.applyAtTick && coalesced.origin === entry.origin && JSON.stringify(coalesced.target) === JSON.stringify(entry.target) && coalesced.expectedStateRevision === entry.expectedStateRevision) replacing.add(coalesced);
  const retained = state.pending.filter(value => !replacing.has(value)), nextBytes = retained.reduce((sum, value) => sum + commandStorageBytes(value), entry.storageBytes);
  if (retained.length >= 1024 || nextBytes > 8 * 1048576) return Object.freeze({ status: 'rejected', commandId: entry.id, reason: 'command-capacity' });
  if (replaceJunction) {
    const field = entry.kind === 'junction-request' ? 'request' : 'definition';
    for (let index = state.pending.length - 1; index >= 0; index--) { const previous = state.pending[index];
      if (previous.kind !== entry.kind || previous.parameters[field].junctionId !== entry.parameters[field].junctionId || previous.target.generation !== entry.target.generation || previous.origin !== entry.origin) continue;
      state.pending.splice(index, 1); remember(state, { commandId: previous.id, junctionId: entry.parameters[field].junctionId, status: 'superseded', appliedTick: null, reason: 'uncommitted-junction-last-wins', supersededBy: entry.id });
    }
  }
  const prior = state.pending.at(-1);
  if (entry.coalesceKey && prior?.coalesceKey === entry.coalesceKey && prior.kind === entry.kind &&
      prior.transactionId === entry.transactionId && prior.applyAtTick === entry.applyAtTick &&
      prior.origin === entry.origin && JSON.stringify(prior.target) === JSON.stringify(entry.target) &&
      prior.expectedStateRevision === entry.expectedStateRevision) {
    state.pending.pop();
    remember(state, { commandId: prior.id, status: 'superseded', appliedTick: null, reason: 'same-boundary-last-wins-v1',
      supersededBy: entry.id, errorBoundAtSimulationBoundaries: 0 });
  }
  if (state.pending.length >= 1024) return Object.freeze({ status: 'rejected', commandId: command.id, reason: 'command-capacity' });
  state.sequence = entry.sequence; state.pending.push(entry); state.pendingBytes = nextBytes; recordProcgenRecoveryCommand(world, entry);
  return Object.freeze({ status: 'queued', commandId: entry.id, applyAtTick: entry.applyAtTick });
};

const commandStorageBytes = value => Number.isSafeInteger(value.storageBytes) && value.storageBytes > 0 ? value.storageBytes : JSON.stringify(value).length * 2 + 256;
const remember = (state, receipt) => {
  state.receipts.push(Object.freeze(receipt));
  if (state.receipts.length > 2048) state.receipts.shift();
  state.recentIds.push(receipt.commandId);
  if (state.recentIds.length > 4096) state.recentIds.shift();
  return receipt;
};
const cancelIntervention = (world, commandId, reason = 'cancelled') => {
  const state = world.interventionState, index = state.pending.findIndex(command => command.id === commandId);
  if (index < 0) return false;
  const pending = state.pending[index]; state.pending.splice(index, 1); state.pendingBytes = state.pending.reduce((sum, value) => sum + commandStorageBytes(value), 0); recordProcgenRecoveryCancellation(world, commandId, reason);
  remember(state, { commandId, ...(pending.parameters.request?.junctionId ? { junctionId: pending.parameters.request.junctionId } : {}), status: 'cancelled', appliedTick: null, reason });
  return true;
};
const cancelPendingInterventions = (world, reason) => {
  for (const command of [...world.interventionState.pending]) cancelIntervention(world, command.id, reason);
};
const applyInterventions = world => {
  const state = world.interventionState, boundaryRevision = `${world.generation}:${world.tickIndex - 1}`;
  if (!state.pending.length) return;
  const due = state.pending.filter(command => command.applyAtTick <= world.tickIndex).sort((a, b) =>
    a.applyAtTick - b.applyAtTick || ORIGIN_PRIORITY[a.origin] - ORIGIN_PRIORITY[b.origin] ||
    (a.requestedBoundaryTick ?? a.applyAtTick) - (b.requestedBoundaryTick ?? b.applyAtTick) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  state.pending = state.pending.filter(command => command.applyAtTick > world.tickIndex); state.pendingBytes = state.pending.reduce((sum, value) => sum + commandStorageBytes(value), 0);
  if (!due.length) return;
  const actors = new Map(world.actors.map(actor => [actor.id, actor])), claimed = new Map();
  const probabilityContext = due.some(command => command.probability) ? createCausalProbabilityContext({ worldId: world.worldId, generation: world.generation, snapshot: { actors: world.actors.slice(0, 16385).map(actor => ({ actorId: actor.id, x: actor.x, y: actor.y, action: actor.action?.getActionName?.() || actor.action?.actionName || null, birthCohortId: actor.birthCohortId, removed: actor.removed, disabled: actor.disabled })) } }, { terrainSolidBelow: actor => world.hasGroundAt(actor.x, actor.y + 1) }) : () => ({});
  for (const command of due) {
    const actor = actors.get(command.target.actorId), resource = actor ? `actor:${actor.id}` : command.kind.startsWith('nuke') ? 'nuke:' + (command.target.laneId ?? 'all') : ['terrain-edit', 'junction-request', 'physical-authoring'].includes(command.kind) ? 'terrain-authoring' : command.kind === 'junction-define' ? 'junction-definition:' + command.parameters.definition.junctionId : 'release-policy';
    let status = 'rejected', reason = null, conflictCommandId = null, decision = null, terrainResult = null;
    if (command.eligibilityUntilTick != null && world.tickIndex > command.eligibilityUntilTick) { status = 'expired'; reason = 'eligibility-window-expired'; }
    else if (command.target.generation !== world.generation) { status = 'stale'; reason = 'stale-generation'; }
    else if (command.expectedStateRevision && command.expectedStateRevision !== boundaryRevision) { status = 'stale'; reason = 'stale-state-revision'; }
    else if (!['set-release-gesture', 'set-release-policy', 'nuke-lane', 'nuke-all', 'terrain-edit', 'junction-request', 'junction-define', 'physical-authoring'].includes(command.kind) && (!actor || actor.removed || actor.disabled || actor.failureReason || actor.terminalReason)) {
      status = 'stale'; reason = 'stale-target';
    } else if (claimed.has(resource)) { reason = 'conflicting-command'; conflictCommandId = claimed.get(resource); }
    else {
      decision = causalPolicyDecision({ policy: command.probability, seed: causalNamespaceSeed(world.physicalAuthoring?.graph?.randomSeeds, 'physical-route', world.seed), namespace: 'physical-route', mappingId: command.kind,
        generation: world.generation, stableCauseId: command.id, drawPurpose: 'apply-intervention', probability01: command.probability01, context: { ...probabilityContext({ actorId: actor?.id, birthCohortId: actor?.birthCohortId }), encounterId: ['EncounterBegan', 'RendezvousCompleted'].includes(command.causality?.sourceKind) ? command.causality.sourceOccurrenceId : null } });
      if (!decision.accepted) reason = decision.reason === 'probability-not-selected' ? 'policy-not-selected' : decision.reason;
      else {
        const previousCommand = actor?._physicalInterventionId ?? null;
        const populationBefore = command.kind.startsWith('set-release-') ? JSON.stringify(world.population) : null;
        const populationMutated = () => populationBefore !== null && JSON.stringify(world.population) !== populationBefore;
        const ownerBefore = { terrainRevision: world.terrainRevision, authoring: world.physicalAuthoring, junctionRevision: world.physicalJunctions.revision };
        const before = actor && { action: actor.action, frameIndex: actor.frameIndex, state: actor.state,
          canClimb: actor.canClimb, hasParachute: actor.hasParachute };
        const mutated = () => actor && Object.keys(before).some(key => actor[key] !== before[key]);
        if (actor) actor._physicalInterventionId = command.id;
        world.soundEvents._interventionCommandId = command.id;
        try {
          let accepted = false;
          if (command.kind === 'set-release-gesture') { const outcome = world.setReleaseGesture(command.parameters.gesture, command.id); accepted = ['pending', 'unchanged'].includes(outcome.status); }
          else if (command.kind === 'physical-authoring') { terrainResult = applyPhysicalAuthoringCommand(world, command.parameters.authoring); accepted = terrainResult.status === 'accepted'; }
          else if (command.kind === 'junction-request') { terrainResult = applyJunctionRequest(world, command.parameters.request, command); accepted = terrainResult.status === 'accepted'; }
          else if (command.kind === 'junction-define') { terrainResult = applyJunctionDefinition(world, command.parameters.definition); accepted = terrainResult.status === 'accepted'; }
          else if (command.kind === 'terrain-edit') { terrainResult = applyTerrainPlan(planTerrainCommand(command.parameters.terrain, world), world); accepted = terrainResult.status === 'accepted'; }
          else if (command.kind === 'assign-worker') {
            accepted = world.assignWorker(actor, command.parameters.workerKind, command.parameters.targetX ?? actor.x);
            if (accepted && command.parameters.trackCrew) world.lanePolicy?.begin(actor, { kind: command.parameters.workerKind, targetX: command.parameters.targetX ?? actor.x });
          }
          else if (command.kind === 'place-blocker') {
            if (actor.action === world.actions[State.WALKING] && world.hasGroundAt(actor.x, actor.y + 1)) {
              accepted = world.actions[State.BLOCKING].triggerLemAction(actor);
              if (accepted) { world._syncTriggerOwner(actor); world.stats.blockers++; }
            }
          } else if (command.kind === 'release-blocker') {
            if (actor.action === world.actions[State.BLOCKING]) {
              actor.setAction(world.actions[State.WALKING]); world._syncTriggerOwner(actor); accepted = true;
            }
          } else if (command.kind === 'nuke-lane') { world._manualNukeLanes[command.target.laneId] = 1; accepted = true; }
          else if (command.kind === 'nuke-all') { world._manualNukeLanes.fill(1); accepted = true; }
          else {
            const params = command.parameters;
            if ((params.spawnBeatTicks == null || Number.isFinite(params.spawnBeatTicks) && params.spawnBeatTicks >= 0 && params.spawnBeatTicks <= 4096) &&
                (params.spawnSpreadTicks == null || Number.isSafeInteger(params.spawnSpreadTicks) && params.spawnSpreadTicks >= 0 && params.spawnSpreadTicks <= 53) &&
                (params.spawnBeatTicks != null || params.spawnSpreadTicks != null)) {
              world.population.setSettings(params);
              if (params.spawnSpreadTicks != null) world.spawnSpreadTicks = params.spawnSpreadTicks;
              accepted = true;
            }
          }
          if (accepted) { status = 'accepted'; reason = 'applied'; claimed.set(resource, command.id); }
          else {
            if (mutated() || populationMutated()) throw new Error('Rejected intervention mutated physical owner state.');
            status = terrainResult?.status ?? status; reason = terrainResult?.reason ?? 'ineligible-command'; if (reason === 'ineligible-command' && command.eligibilityUntilTick > world.tickIndex) { status = 'waiting'; reason = 'waiting-for-existing-target-eligibility'; } else if (reason === 'ineligible-command' && command.lastWaitReason && command.eligibilityUntilTick <= world.tickIndex) { status = 'expired'; reason = 'eligibility-window-expired'; } if (actor) actor._physicalInterventionId = previousCommand;
          }
        } catch (error) {
          reason = 'adapter-exception';
          if (actor) actor._physicalInterventionId = previousCommand;
          // This adapter contract allows exceptions before action mutation.
          // A mutated action must abort the tick; no snapshot rollback is claimed.
          if (mutated() || populationMutated() || world.terrainRevision !== ownerBefore.terrainRevision || world.physicalAuthoring !== ownerBefore.authoring || world.physicalJunctions.revision !== ownerBefore.junctionRevision) throw error;
        } finally { world.soundEvents._interventionCommandId = null; }
      }
    }
    if (status === 'waiting') { state.pending.push(Object.freeze({ ...command, applyAtTick: world.tickIndex + 1, lastWaitReason: reason })); state.pendingBytes += commandStorageBytes(command); }
    if (status === 'waiting' && command.lastWaitReason === reason) continue;
    const junctionId = command.parameters.request?.junctionId ?? command.parameters.definition?.junctionId;
    const receipt = { commandId: command.id, ...(command.causality ? { causality: command.causality, parentCauseIds: command.causality.parentCauseIds } : {}), ...(FEEDBACK_COMMANDS.includes(command.kind) && ['manual', 'live-controller'].includes(command.origin) && JSON.stringify(command.parameters).length * 2 <= 8192 && (command.parameters.gesture?.lanePhase.length ?? 0) <= 64 ? { requestedCommand: { id: command.id, kind: command.kind, target: command.target, parameters: command.parameters, ...(command.probability ? { probability: command.probability } : {}), requestedAt: command.requestedAt, applyAtTick: command.applyAtTick, origin: command.origin } } : {}), ...(junctionId ? { junctionId } : {}), transactionId: command.transactionId, status, appliedTick: world.tickIndex,
      reason, conflictCommandId, origin: command.origin, target: command.target, decision, ...(terrainResult ? { terrain: terrainResult } : {}) };
    remember(state, receipt);
    world.soundEvents.emitPhysicalFact({ kind: status === 'accepted' ? 'CommandApplied' : status === 'waiting' ? 'CommandWaiting' : 'CommandRejected',
      ...receipt, actorId: actor?.id ?? command.target.actorId ?? null, laneId: actor?.laneIndex ?? null });
  }
};

const prepareInterventionBatch = (world, commands) => {
  if (!Array.isArray(commands) || !commands.length || commands.length > 128 || JSON.stringify(commands).length * 2 > 1048576) throw new Error('Intervention batch capacity exceeded.');
  const original = world.interventionState, tick = world.tickIndex, generation = world.generation;
  const sequence = original.sequence, pending = [...original.pending], receipts = [...original.receipts], recentIds = [...original.recentIds];
  const same = (left, right) => left.length === right.length && left.every((entry, index) => entry === right[index]);
  const staged = { ...original, pending: [...original.pending], receipts: [...original.receipts], recentIds: [...original.recentIds] };
  const candidate = Object.assign(Object.create(Object.getPrototypeOf(world)), world, { interventionState: staged }), outcomes = [], admitted = [];
  for (const command of commands) { const outcome = enqueueIntervention(candidate, command); outcomes.push(outcome); if (outcome.status === 'queued') admitted.push(staged.pending.find(entry => entry.id === outcome.commandId)); }
  const accepted = outcomes.every(outcome => outcome.status === 'queued'); let committed = false;
  return Object.freeze({ status: accepted ? 'prepared' : 'rejected', outcomes: Object.freeze(outcomes), commit() {
    if (committed) return outcomes;
    if (!accepted) return outcomes;
    if (world._disposed || world.interventionState !== original || original.sequence !== sequence || !same(original.pending, pending) || !same(original.receipts, receipts) || !same(original.recentIds, recentIds) || world.tickIndex !== tick || world.generation !== generation) throw new Error('Intervention proposal is stale.');
    committed = true; world.interventionState = staged;
    for (const entry of admitted) recordProcgenRecoveryCommand(world, entry);
    return outcomes;
  } });
};
const prepareIntervention = (world, command) => { const proposal = prepareInterventionBatch(world, [command]); return Object.freeze({ outcome: proposal.outcomes[0], commit: () => proposal.commit()[0] }); };

export { prepareInterventionBatch, prepareIntervention, ORIGIN_PRIORITY, createInterventionState, enqueueIntervention, cancelIntervention, cancelPendingInterventions, applyInterventions };
