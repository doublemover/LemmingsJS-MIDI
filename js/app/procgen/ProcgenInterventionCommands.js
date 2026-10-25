import { normalizeTerrainCommand, planTerrainCommand, applyTerrainPlan } from './TerrainAuthoringAdapter.js';
import { recordProcgenRecoveryCommand, recordProcgenRecoveryCancellation } from './workstation/ProcgenRecoveryJournal.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { causalRandomDecision } from './workstation/CausalRandom.js';

const ORIGIN_PRIORITY = Object.freeze({ manual: 0, 'live-controller': 0, replay: 0, layer: 1, ensemble: 1, conductor: 2, 'auto-assist': 3 });
const KINDS = new Set(['assign-worker', 'place-blocker', 'release-blocker', 'set-release-policy', 'nuke-lane', 'nuke-all', 'terrain-edit']);
const boundedId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const plain = value => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const createInterventionState = () => ({ version: 1, pending: [], receipts: [], recentIds: [], sequence: 0 });

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
  const parameters = {};
  if (command.kind === 'terrain-edit') {
    const normalized = normalizeTerrainCommand(command.parameters?.terrain);
    if (normalized.generation !== command.target.generation || command.transactionId !== normalized.transactionId) throw new Error('Terrain command identity mismatch.');
    const preview = planTerrainCommand(normalized, world);
    if (preview.status !== 'prepared') return Object.freeze({ status: 'rejected', commandId: command.id, reason: preview.reason });
    parameters.terrain = preview.command;
    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }; freeze(parameters.terrain);
  }
  for (const [key, value] of Object.entries(command.kind === 'terrain-edit' ? {} : command.parameters || {})) {
    if (!['workerKind', 'targetX', 'spawnBeatTicks', 'spawnSpreadTicks'].includes(key) ||
        !(typeof value === 'string' && value.length <= 32 || Number.isFinite(value))) throw new Error('Unsupported intervention parameter.');
    parameters[key] = value;
  }
  const target = { generation: command.target.generation };
  if (['set-release-policy', 'nuke-all', 'terrain-edit'].includes(command.kind)) {
    if (command.target.laneId != null) throw new Error('Release policy currently targets the whole world.');
  } else if (command.kind === 'nuke-lane') {
    if (!Number.isSafeInteger(command.target.laneId) || command.target.laneId < 0 || command.target.laneId >= world.laneCount) throw new Error('Invalid nuke lane.');
    target.laneId = command.target.laneId;
  } else {
    if (!Number.isSafeInteger(command.target.actorId) || command.target.actorId < 0) throw new Error('Intervention needs a stable actor ID.');
    target.actorId = command.target.actorId;
  }
  if (!Number.isSafeInteger(state.sequence + 1)) throw new RangeError('Intervention sequence exhausted.');
  const entry = Object.freeze({ version: 1, id: command.id, kind: command.kind, target: Object.freeze(target),
    parameters: Object.freeze(parameters), requestedAt: command.requestedAt ?? world.simulationTimeMs,
    applyAtTick: command.applyAtTick ?? world.tickIndex + 1, origin: command.origin ?? 'manual',
    expectedStateRevision: command.expectedStateRevision ?? null, transactionId: command.transactionId ?? null,
    coalesceKey: command.coalesceKey ?? null,
    probability01: command.probability01 ?? 1, sequence: state.sequence + 1 });
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
  state.sequence = entry.sequence; state.pending.push(entry); recordProcgenRecoveryCommand(world, entry);
  return Object.freeze({ status: 'queued', commandId: entry.id, applyAtTick: entry.applyAtTick });
};

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
  state.pending.splice(index, 1); recordProcgenRecoveryCancellation(world, commandId, reason);
  remember(state, { commandId, status: 'cancelled', appliedTick: null, reason });
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
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  state.pending = state.pending.filter(command => command.applyAtTick > world.tickIndex);
  if (!due.length) return;
  const actors = new Map(world.actors.map(actor => [actor.id, actor])), claimed = new Map();
  for (const command of due) {
    const actor = actors.get(command.target.actorId), resource = actor ? `actor:${actor.id}` : command.kind.startsWith('nuke') ? 'nuke:' + (command.target.laneId ?? 'all') : command.kind === 'terrain-edit' ? 'terrain-authoring' : 'release-policy';
    let status = 'rejected', reason = null, conflictCommandId = null, decision = null, terrainResult = null;
    if (command.target.generation !== world.generation) { status = 'stale'; reason = 'stale-generation'; }
    else if (command.expectedStateRevision && command.expectedStateRevision !== boundaryRevision) { status = 'stale'; reason = 'stale-state-revision'; }
    else if (!['set-release-policy', 'nuke-lane', 'nuke-all', 'terrain-edit'].includes(command.kind) && (!actor || actor.removed || actor.disabled || actor.failureReason || actor.terminalReason)) {
      status = 'stale'; reason = 'stale-target';
    } else if (claimed.has(resource)) { reason = 'conflicting-command'; conflictCommandId = claimed.get(resource); }
    else {
      decision = causalRandomDecision({ seed: world.seed, namespace: 'physical-route', mappingId: command.kind,
        generation: world.generation, stableCauseId: command.id, drawPurpose: 'apply-intervention', probability01: command.probability01 });
      if (!decision.accepted) reason = 'policy-not-selected';
      else {
        const previousCommand = actor?._physicalInterventionId ?? null;
        const before = actor && { action: actor.action, frameIndex: actor.frameIndex, state: actor.state,
          canClimb: actor.canClimb, hasParachute: actor.hasParachute };
        const mutated = () => actor && Object.keys(before).some(key => actor[key] !== before[key]);
        if (actor) actor._physicalInterventionId = command.id;
        world.soundEvents._interventionCommandId = command.id;
        try {
          let accepted = false;
          if (command.kind === 'terrain-edit') { terrainResult = applyTerrainPlan(planTerrainCommand(command.parameters.terrain, world), world); accepted = terrainResult.status === 'accepted'; }
          else if (command.kind === 'assign-worker') accepted = world.assignWorker(actor, command.parameters.workerKind, command.parameters.targetX ?? actor.x);
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
            if (mutated()) throw new Error('Rejected intervention mutated actor state.');
            reason = terrainResult?.reason ?? 'ineligible-command'; if (actor) actor._physicalInterventionId = previousCommand;
          }
        } catch (error) {
          reason = 'adapter-exception';
          if (actor) actor._physicalInterventionId = previousCommand;
          // This adapter contract allows exceptions before action mutation.
          // A mutated action must abort the tick; no snapshot rollback is claimed.
          if (mutated()) throw error;
        } finally { world.soundEvents._interventionCommandId = null; }
      }
    }
    const receipt = { commandId: command.id, transactionId: command.transactionId, status, appliedTick: world.tickIndex,
      reason, conflictCommandId, origin: command.origin, target: command.target, decision, ...(terrainResult ? { terrain: terrainResult } : {}) };
    remember(state, receipt);
    world.soundEvents.emitPhysicalFact({ kind: status === 'accepted' ? 'CommandApplied' : 'CommandRejected',
      ...receipt, actorId: actor?.id ?? command.target.actorId ?? null, laneId: actor?.laneIndex ?? null });
  }
};

const prepareIntervention = (world, command) => {
  const original = world.interventionState, tick = world.tickIndex, generation = world.generation;
  const sequence = original.sequence, pending = [...original.pending], receipts = [...original.receipts], recentIds = [...original.recentIds];
  const same = (left, right) => left.length === right.length && left.every((entry, index) => entry === right[index]);
  const staged = { ...original, pending: [...original.pending], receipts: [...original.receipts], recentIds: [...original.recentIds] };
  const outcome = enqueueIntervention(Object.assign(Object.create(Object.getPrototypeOf(world)), world, { interventionState: staged }), command); let committed = false;
  return Object.freeze({ outcome, commit() {
    if (committed) return outcome;
    if (world._disposed || world.interventionState !== original || original.sequence !== sequence || !same(original.pending, pending) || !same(original.receipts, receipts) || !same(original.recentIds, recentIds) || world.tickIndex !== tick || world.generation !== generation) throw new Error('Intervention proposal is stale.');
    committed = true; world.interventionState = staged;
    if (outcome.status === 'queued') recordProcgenRecoveryCommand(world, staged.pending.find(entry => entry.id === outcome.commandId));
    return outcome;
  } });
};

export { prepareIntervention, ORIGIN_PRIORITY, createInterventionState, enqueueIntervention, cancelIntervention, cancelPendingInterventions, applyInterventions };
