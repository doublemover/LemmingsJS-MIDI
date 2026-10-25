import { createOwnedResourceReservation } from '../../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../../ProcgenRetirement.js';
import { plain, identity, integer, copy, freeze } from './PhysicalSchema.js';
import { validatePhysicalFeedback, validateFeedbackCausality, planPhysicalFeedback, FEEDBACK_COMMANDS } from './PhysicalFeedbackSchema.js';
import { prepareInterventionBatch } from '../../ProcgenInterventionCommands.js';
import { subscribeProcgenCommittedBoundary } from '../../ProcgenCommittedBoundary.js';
import { getProcgenRecoveryJournal } from '../ProcgenRecoveryJournal.js';
const MAX_BYTES = 524288, MAX_SEEN = 4096, MAX_WORK = 262144;
const keyFor = (owner, rule) => `${owner}:${rule.id}:r${rule.revision}`;
const hash = text => { let a = 2166136261, b = 0x9e3779b9; for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 0x85ebca6b); } return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`; };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rows = graph => [...(graph.feedback?.conductors || []).map(rule => ({ owner: 'conductor', ownerRevision: rule.revision, enabled: rule.enabled, rule })), ...(graph.feedback?.layers || []).flatMap(layer => layer.rules.map(rule => ({ owner: `layer:${layer.id}`, ownerRevision: layer.revision, baseReferences: layer.baseReferences, enabled: layer.enabled && rule.enabled, rule })))].sort((a, b) => compare(a.owner, b.owner) || compare(a.rule.id, b.rule.id));
export function createPhysicalFeedbackState(epoch = 'initial', generation = 0, tick = 0) { return { version: 1, epoch, generation, lastTick: tick, sequence: 0, mode: 'disarmed', total: 0, recentTicks: [], actorCounts: [], rules: [], seen: [], ancestry: [], commands: [], trace: [], muted: [] }; }
export function validatePhysicalFeedbackState(value) {
  if (!plain(value) || value.version !== 1 || !identity(value.epoch) || !integer(value.generation) || !integer(value.lastTick) || !integer(value.sequence) || !integer(value.total, 1024) || !['disarmed', 'dry-run', 'live'].includes(value.mode) || JSON.stringify(value).length * 2 > MAX_BYTES) throw new Error('Invalid bounded physical feedback state.');
  for (const [name, max] of [['recentTicks', 32], ['actorCounts', 1024], ['rules', 64], ['seen', MAX_SEEN], ['ancestry', 2048], ['commands', 1024], ['trace', 256], ['muted', 16]]) if (!Array.isArray(value[name]) || value[name].length > max) throw new Error(`Feedback ${name} capacity exceeded.`);
  if (value.recentTicks.some(tick => !integer(tick) || tick > value.lastTick) || value.actorCounts.some(pair => !Array.isArray(pair) || pair.length !== 2 || !integer(pair[0]) || !integer(pair[1], 16)) || new Set(value.actorCounts.map(pair => pair[0])).size !== value.actorCounts.length || value.seen.some(key => typeof key !== 'string' || !key.length || key.length > 768) || new Set(value.seen).size !== value.seen.length || value.muted.some(key => !identity(key))) throw new Error('Invalid feedback rate or occurrence identity.');
  for (const rule of value.rules) if (!plain(rule) || !identity(rule.key) || typeof rule.signature !== 'string' || rule.signature.length > 32768 || !integer(rule.fuel, 256) || !integer(rule.cooldownUntil) || !integer(rule.occurrences) || typeof rule.latched !== 'boolean' || !Array.isArray(rule.events) || rule.events.length > 128 || rule.events.some(item => !plain(item) || !integer(item.tick) || item.tick > value.lastTick || !identity(item.id) || !integer(item.weight, 128) || !item.weight || !Array.isArray(item.roots) || item.roots.length > 64 || item.roots.some(root => !identity(root)))) throw new Error('Invalid feedback window continuation.');
  if (new Set(value.rules.map(rule => rule.key)).size !== value.rules.length) throw new Error('Duplicate feedback rule state.');
  for (const entry of value.commands) { if (!plain(entry) || !identity(entry.id) || !identity(entry.owner)) throw new Error('Invalid feedback command continuation.'); validateFeedbackCausality(entry.causality); }
  if (value.sequence !== value.commands.length || value.commands.length > value.total || new Set(value.commands.map(entry => entry.id)).size !== value.commands.length) throw new Error('Duplicate feedback command ancestry.');
  for (const entry of value.ancestry) { if (!plain(entry) || !identity(entry.id) || !integer(entry.tick) || entry.tick > value.lastTick || !Array.isArray(entry.parents) || entry.parents.length > 8 || entry.parents.some(id => !identity(id)) || typeof entry.unknown !== 'boolean') throw new Error('Invalid physical root ancestry.'); }
  if (new Set(value.ancestry.map(entry => entry.id)).size !== value.ancestry.length) throw new Error('Duplicate physical root ancestry.');
  return copy(value);
}
function prepareInput(world, input) {
  if (!plain(input) || input.version !== 1 || input.kind !== 'physical-feedback-boundary' || !Array.isArray(input.commands) || input.commands.length > 16 || !Array.isArray(input.outcomes) || input.outcomes.length !== input.commands.length || !Array.isArray(input.cancelIds) || input.cancelIds.length > 1024 || input.cancelIds.some(id => !identity(id)) || new Set(input.cancelIds).size !== input.cancelIds.length) throw new Error('Invalid recorded physical feedback boundary.');
  const state = validatePhysicalFeedbackState(input.state);
  for (const command of input.commands) { const retained = state.commands.find(value => value.id === command.id); if (!retained || !FEEDBACK_COMMANDS.includes(command.kind) || !['layer', 'conductor'].includes(command.origin) || JSON.stringify(retained.causality) !== JSON.stringify(command.causality) || command.causality.epoch !== state.epoch) throw new Error('Feedback command is outside its recorded causal owner.'); }
  if (state.generation !== world.generation || state.lastTick !== world.tickIndex) throw new Error('Feedback state belongs to a different physical boundary.');
  const pending = new Set(world.interventionState.pending.filter(command => command.causality).map(command => command.id)); if (input.cancelIds.some(id => !pending.has(id))) throw new Error('Feedback cancellation is stale.');
  const proposal = input.commands.length ? prepareInterventionBatch(world, input.commands) : null;
  if (proposal && (proposal.status !== 'prepared' || JSON.stringify(proposal.outcomes) !== JSON.stringify(input.outcomes))) throw new Error('Recorded feedback command admission differs.');
  return () => { proposal?.commit(); for (const id of input.cancelIds) world.cancelIntervention(id, 'physical-feedback-disarmed'); world.physicalFeedback = state; getProcgenRecoveryJournal(world)?.feedback(state); };
}
export function applyRecordedPhysicalFeedback(world, input) { prepareInput(world, input)(); }
const trace = (state, value) => { state.trace.push(value); if (state.trace.length > 256) state.trace.shift(); };
const occurrence = fact => fact.observationId || fact.eventId;
const sourceRoots = fact => [...new Set(fact.sourceEventIds || (fact.eventId ? [fact.eventId] : []))];
function targetActor(rule, fact, batch, actors) {
  const target = rule.target;
  if (target.kind === 'global') return { generation: batch.generation };
  let actorId;
  if (target.kind === 'source-actor') actorId = fact.actorId;
  else if (target.kind === 'stable-actor') { if (target.generation !== batch.generation) return null; actorId = target.actorId; }
  else if (target.kind === 'motif-role') actorId = fact.roleBindings?.[target.role]?.actorId;
  else {
    const cohortId = target.cohortId || actors.get(fact.actorId)?.birthCohortId, cohort = batch.snapshot.cohorts?.find(value => value.id === cohortId && value.generation === batch.generation && value.status === 'complete');
    if (!cohort) return null; actorId = cohort.slots.filter(slot => slot.status === 'admitted').map(slot => slot.actorId).sort((a, b) => a - b)[target.rank];
  }
  return integer(actorId) && actors.has(actorId) ? { generation: batch.generation, actorId } : null;
}
function matching(rule, fact, actors, analysis) {
  const source = rule.source; if (fact.kind !== source.kind || source.pickupId && fact.gateId !== source.pickupId || source.motifId && fact.motifId !== source.motifId || source.routeId && fact.routeId !== source.routeId || source.cargoStationId && fact.stationId !== source.cargoStationId || source.operationKind && fact.operationKind !== source.operationKind || source.action && fact.action !== source.action || source.direction !== 'either' && fact.direction !== source.direction) return false;
  if (source.ensembleId) { const view = analysis?.ensembles?.find(value => value.id === source.ensembleId); if (view?.completeness?.status !== 'complete') return null; if (!view.members.some(member => member.active && member.actorId === fact.actorId)) return false; }
  if (source.region) { const point = fact.positionAfter || fact.position || actors.get(fact.actorId), b = source.region; if (!point) return null; if (point.x < b.x1 || point.x >= b.x2 || point.y < b.y1 || point.y >= b.y2) return false; }
  return true;
}
function ancestryFor(state, roots, ruleKey, row, commands, rootIndex) {
  const parents = new Set(); for (const root of roots) { const entry = rootIndex.get(root); if (!entry || entry.unknown) return null; for (const parent of entry.parents) parents.add(parent); }
  const path = [], ancestry = [...parents].map(id => commands.get(id)?.causality); if (ancestry.some(value => !value)) return null;
  for (const parent of ancestry) for (const id of parent.rulePath) if (!path.includes(id)) path.push(id);
  if (path.includes(ruleKey) || path.length >= 8) return null;
  path.push(ruleKey); return validateFeedbackCausality({ feedbackRootId: ancestry.map(value => value.feedbackRootId).sort()[0] || roots[0], parentCauseIds: roots, hopCount: path.length, rulePath: path, ruleRevision: row.rule.revision, ownerId: row.owner, epoch: state.epoch });
}
export function evaluatePhysicalFeedback(world, graph, batch, analysis, previous, { live = false } = {}) {
  if (!Array.isArray(batch?.facts) || batch.facts.length > 16384 || !Array.isArray(batch.snapshot?.actors) || batch.snapshot.actors.length > 16384 || analysis?.facts != null && (!Array.isArray(analysis.facts) || analysis.facts.length > 16384)) throw new Error('Feedback source boundary capacity exceeded.');
  const state = validatePhysicalFeedbackState(previous), definitions = rows(graph), commands = [], actors = new Map((batch.snapshot?.actors || []).filter(actor => !actor.terminalReason && !actor.removed).map(actor => [actor.actorId, actor]));
  if (batch.generation !== state.generation || batch.tick <= state.lastTick) return { state, commands, skipped: true };
  if (batch.tick !== state.lastTick + 1) for (const rule of state.rules) { rule.events = []; rule.latched = false; rule.status = 'censored-source-gap'; }
  state.lastTick = batch.tick; state.mode = live ? 'live' : 'dry-run'; state.recentTicks = state.recentTicks.filter(tick => batch.tick - tick < 54);
  const complete = batch.completeness?.status === 'complete' && batch.snapshot?.tick === batch.tick, derived = analysis?.batchId === batch.batchId ? analysis.facts : [];
  const facts = [...batch.facts, ...derived].sort((a, b) => (a.causalSequence || 0) - (b.causalSequence || 0) || compare(String(occurrence(a)), String(occurrence(b)))), commandIndex = new Map(state.commands.map(value => [value.id, value])), rootIndex = new Map(state.ancestry.map(value => [value.id, value]));
  // Only actual physical roots establish command ancestry; derived observations
  // borrow those roots rather than creating a new, ancestry-free feedback loop.
  for (const fact of batch.facts) if (identity(fact.eventId)) { const all = [...new Set([...(fact.parentCauseIds || []), ...(fact.sourceCommandId ? [fact.sourceCommandId] : [])])], parents = all.filter(id => commandIndex.has(id)); rootIndex.set(fact.eventId, { id: fact.eventId, tick: batch.tick, parents: parents.slice(0, 8), unknown: parents.length > 8 || all.some(id => id.startsWith('feedback:') && !commandIndex.has(id)) }); }
  state.ancestry = [...rootIndex.values()].filter(entry => batch.tick - entry.tick <= 600).slice(-2048); const seen = new Set(state.seen), rates = new Map(state.actorCounts), retained = []; let work = 0;
  for (const row of definitions) {
    const rule = row.rule, key = keyFor(row.owner, rule), signature = JSON.stringify({ ownerRevision: row.ownerRevision, rule });
    const old = state.rules.find(value => value.key === key && value.signature === signature), current = old || { key, signature, fuel: rule.fuel, cooldownUntil: 0, latched: false, occurrences: 0, events: [], status: 'observing' }; retained.push(current);
    if (row.baseReferences?.some(ref => ref.kind === 'route' ? !graph.routes?.some(route => route.id === ref.id && route.revision === ref.revision) : !world.physicalAuthoring?.instances?.some(instance => instance.fragmentId === ref.id && instance.fragmentRevision === ref.revision))) { current.events = []; current.latched = false; current.status = 'unresolved-base-reference'; continue; }
    if (!row.enabled || state.muted.includes(row.owner)) { current.events = []; current.latched = false; current.status = 'disarmed'; continue; }
    current.events = current.events.filter(value => batch.tick - value.tick < rule.windowTicks); if (current.events.reduce((sum, value) => sum + value.weight, 0) <= rule.hysteresis) current.latched = false;
    if (!complete || rule.source.kind !== 'ActorBorn' && !batch.facts.some(fact => fact.kind === rule.source.kind) && analysis?.completeness?.status === 'censored') { current.status = 'censored'; current.events = []; current.latched = false; continue; }
    for (const fact of facts) {
      if (++work > MAX_WORK) { current.status = 'censored'; break; }
      const matches = matching(rule, fact, actors, analysis); if (matches == null) { current.status = 'censored'; continue; } if (!matches) continue;
      const anchor = occurrence(fact); if (!identity(anchor) || current.events.some(value => value.id === anchor)) continue;
      if (current.events.length >= 128 || !Number.isSafeInteger(current.occurrences + 1)) { current.status = 'censored'; continue; }
      const weight = rule.source.measure === 'participants' ? fact.participantCount ?? fact.participants?.length : 1; if (!integer(weight) || !weight) { current.status = 'censored'; continue; }
      const rootsForEvent = sourceRoots(fact); if (!rootsForEvent.length || rootsForEvent.length > 64) { current.status = 'censored'; continue; }
      current.events.push({ tick: batch.tick, id: anchor, weight: Math.min(128, weight), roots: rootsForEvent }); current.occurrences++;
      const selected = (current.occurrences - 1) % rule.every === rule.offset, proposalKey = `${state.epoch}/${row.owner}/${row.ownerRevision}/${rule.id}/${rule.revision}/${anchor}`;
      if (!selected || current.events.reduce((sum, value) => sum + value.weight, 0) < rule.threshold || current.latched || seen.has(proposalKey)) continue;
      if (seen.size >= MAX_SEEN) { current.status = 'exhausted-occurrence-capacity'; continue; } seen.add(proposalKey);
      if (batch.tick < current.cooldownUntil) { current.status = 'cooling-down'; continue; }
      if (!current.fuel || state.total >= 1024) { current.status = 'exhausted'; continue; }
      if (commands.length >= 16 || state.recentTicks.length >= 32) { current.status = 'rate-limited'; continue; }
      current.latched = true; current.cooldownUntil = batch.tick + rule.refractoryTicks; current.fuel--; state.total++; state.recentTicks.push(batch.tick);
      const bound = targetActor(rule, fact, batch, actors), roots = [...new Set(current.events.flatMap(event => event.roots))], ancestry = roots.length && roots.length <= 64 ? ancestryFor(state, roots, key, row, commandIndex, rootIndex) : null;
      if (!bound || !ancestry || bound.actorId != null && (rates.get(bound.actorId) || 0) >= 16) { current.status = 'rejected'; trace(state, { tick: batch.tick, owner: row.owner, ruleId: rule.id, occurrenceId: anchor, status: 'rejected', reason: !bound ? 'stale-or-unresolved-target' : !ancestry ? 'unknown-or-cyclic-ancestry' : 'actor-fuel-exhausted' }); continue; }
      if (bound.actorId != null) rates.set(bound.actorId, (rates.get(bound.actorId) || 0) + 1);
      if (!Number.isSafeInteger(state.sequence + 1)) throw new Error('Feedback proposal identity exhausted.'); state.sequence++;
      const id = `feedback:${hash(proposalKey)}:${state.sequence}`, template = copy(rule.command), command = { id, ...template, origin: row.owner === 'conductor' ? 'conductor' : 'layer', target: bound, applyAtTick: batch.tick + 1, causality: { ...ancestry, sourceOccurrenceId: anchor, sourceKind: fact.kind }, eligibilityUntilTick: batch.tick + 1 + rule.eligibilityTicks };
      if (template.kind === 'set-release-gesture') { const prior = world.population.pendingReleaseGesture || world.population.releaseGesture; command.parameters.gesture.revision = Math.max(command.parameters.gesture.revision, prior?.revision || 0, state.sequence) + 1; }
      if (template.kind === 'junction-request') { const definition = world.physicalJunctions.definitions.find(value => value.id === template.parameters.request.junctionId); command.parameters.request = { ...template.parameters.request, version: 1, authoringRevision: definition?.revision, expiryTick: command.eligibilityUntilTick + 1 }; }
      commands.push(command); state.commands.push({ id, owner: row.owner, causality: command.causality }); current.status = live ? 'proposed' : 'suggested'; trace(state, { tick: batch.tick, owner: row.owner, ruleId: rule.id, occurrenceId: anchor, proposalKey, commandId: id, target: bound, status: current.status });
    }
  }
  state.rules = retained; state.seen = [...seen]; state.actorCounts = [...rates];
  for (const fact of batch.facts) if (['CommandApplied', 'CommandRejected', 'CommandWaiting'].includes(fact.kind) && commandIndex.has(fact.commandId)) { const owner = commandIndex.get(fact.commandId).owner; trace(state, { tick: batch.tick, owner, commandId: fact.commandId, status: fact.status, reason: fact.reason, resultingFactIds: (fact.physicalEventIds || []).slice(0, 64) }); const rule = state.rules.find(value => value.key === commandIndex.get(fact.commandId).causality.rulePath.at(-1)); if (rule) rule.status = fact.status === 'accepted' ? 'applied' : fact.status; }
  validatePhysicalFeedbackState(state); return { state, commands, work };
}
export function createPhysicalFeedbackController({ world, getGraph, resourceBudget = null, recordInput = () => ({ status: 'accepted' }), onStatus = () => {}, onFailure = () => {} }) {
  const resource = createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-feedback', kind: 'feedback-state-plans-captures-and-staging', category: 'candidate', bytes: 8 * 1048576 });
  const retirement = createProcgenRetirementScope();
  let armed = false, staged = null, disposed = false, pendingDisarm = false, fault = null, dry = null, lastPlan = null, serial = 0, captures = [], captureBytes = 0;
  const publish = (state, commands = [], cancelIds = []) => {
    let proposal = null, outcomes = [];
    if (commands.length) { try { proposal = prepareInterventionBatch(world, commands); outcomes = proposal.outcomes; } catch (error) { trace(state, { tick: world.tickIndex, status: 'rejected', reason: error.message }); }
      if (!proposal || proposal.status !== 'prepared') { for (const rule of state.rules) if (rule.status === 'proposed') rule.status = 'rejected'; for (const command of commands) trace(state, { tick: world.tickIndex, commandId: command.id, status: 'rejected', reason: 'canonical-batch-admission-refused' }); commands = []; outcomes = []; }
    }
    const input = { version: 1, kind: 'physical-feedback-boundary', commands, outcomes, cancelIds, state }, commit = prepareInput(world, input), receipt = recordInput(input, { tick: world.tickIndex, generation: world.generation });
    if (receipt?.status !== 'accepted') throw new Error('Feedback stopped before publication because the command journal refused admission.'); commit(); return { status: 'accepted', queued: commands.length, cancelled: cancelIds.length };
  };
  const cancelOwned = owner => world.interventionState.pending.filter(command => command.causality?.epoch === world.physicalFeedback?.epoch && (!owner || command.causality.ownerId === owner)).map(command => command.id);
  const disarm = () => { armed = false; staged = null; if (world._stepping) { pendingDisarm = true; return { status: 'pending-boundary-disarm' }; } if (world._disposed || !world.physicalFeedback || world.physicalFeedback.mode === 'disarmed' && !cancelOwned().length) return { status: 'disarmed' }; const state = copy(world.physicalFeedback); state.mode = 'disarmed'; state.lastTick = world.tickIndex; state.generation = world.generation; return publish(state, [], cancelOwned()); };
  const flush = () => {
    if (disposed || world._disposed) return;
    try {
      if (pendingDisarm) { pendingDisarm = false; disarm(); return; } if (!staged || fault) return; const { batch, analysis } = staged; staged = null;
      const graph = getGraph(); if (!graph.feedback) return;
      let previous = armed ? world.physicalFeedback : dry;
      if (!previous || previous.generation !== world.generation) previous = createPhysicalFeedbackState(`${armed ? 'live' : 'dry'}:${world.generation}:${++serial}`, world.generation, batch.tick - 1);
      if (batch.generation !== world.generation) return;
      const result = evaluatePhysicalFeedback(world, graph, batch, analysis, previous, { live: armed }); if (result.skipped) return;
      if (armed) publish(result.state, result.commands); else dry = result.state;
      lastPlan = { work: result.work, proposals: result.commands, state: copy(result.state) };
    } catch (error) { fault = error.message; armed = false; try { disarm(); } catch { /* A refused journal keeps the already-recorded queue frozen for inspection. */ } onStatus(`Physical feedback disarmed: ${error.message}`); onFailure(error); }
  };
  let unsubscribe; try { unsubscribe = subscribeProcgenCommittedBoundary(world, flush); } catch (error) { try { resource.release(); } catch (releaseError) { error.retirementError = releaseError; } throw error; }
  return { observe(batch, analysis) { if (!disposed && !fault) { captures = captures.filter(value => value.generation === batch.generation); captureBytes = captures.reduce((sum, value) => sum + value.bytes, 0); for (const fact of batch.facts) if (fact.requestedCommand && ['CommandApplied', 'CommandRejected'].includes(fact.kind) && ['manual', 'live-controller'].includes(fact.origin)) { const bytes = JSON.stringify(fact).length * 2; if (bytes > 32768) continue; while (captures.length && (captures.length >= 64 || captureBytes + bytes > 131072)) captureBytes -= captures.shift().bytes; captures.push({ tick: batch.tick, generation: batch.generation, fact, bytes }); captureBytes += bytes; } staged = { batch, analysis }; } }, flush,
    arm({ mode = 'live', epoch } = {}) { if (disposed || world._stepping || world._failedTick || !['live', 'regenerate'].includes(mode) || !identity(epoch)) throw new Error('Explicit physical feedback arming needs a stable boundary and epoch.'); const graph = getGraph(); if (!graph.feedback) throw new Error('No authored physical feedback.'); const state = createPhysicalFeedbackState(epoch, world.generation, world.tickIndex); state.mode = 'live'; const result = publish(state, [], cancelOwned()); dry = null; staged = null; pendingDisarm = false; fault = null; armed = true; return { ...result, mode, plan: planPhysicalFeedback(graph.feedback) }; },
    disarm,
    muteLayer(layerId, mute = true) { const owner = `layer:${layerId}`; if (!getGraph().feedback?.layers.some(layer => layer.id === layerId)) throw new Error('Unknown intervention layer.'); const state = copy(world.physicalFeedback || createPhysicalFeedbackState('initial', world.generation, world.tickIndex)); state.lastTick = world.tickIndex; state.generation = world.generation; state.muted = [...new Set([...state.muted.filter(value => value !== owner), ...(mute ? [owner] : [])])]; return publish(state, [], mute ? cancelOwned(owner) : []); },
    capture({ commandId, layerId, revision = 1, anchor, binding, eligibilityTicks = 0 }) { const captured = captures.findLast(value => value.generation === world.generation && value.fact.commandId === commandId), fact = captured?.fact; if (!fact?.requestedCommand || !['manual', 'live-controller'].includes(fact.origin) || !FEEDBACK_COMMANDS.includes(fact.requestedCommand.kind)) throw new Error('Choose an actual captured human command receipt in this generation.'); const input = { version: 1, conductors: [], layers: [{ id: layerId, revision, enabled: true, rules: [{ id: 'captured', revision: 1, source: anchor, target: binding, command: { kind: fact.requestedCommand.kind, parameters: fact.requestedCommand.parameters, ...(fact.requestedCommand.probability ? { probability: fact.requestedCommand.probability } : {}) }, eligibilityTicks }], humanCapture: { version: 1, anchorChoice: 'explicit-user-binding', requested: fact.requestedCommand, outcome: { status: fact.status, reason: fact.reason, physicalEventIds: fact.physicalEventIds || [] }, sourceEventId: fact.eventId, sourceTick: captured.tick } }] }; return validatePhysicalFeedback(input, getGraph()).layers[0]; },
    diagnostics: () => disposed ? freeze({ disposed, retirement: retirement.getReceipt()?.outcome, resources: resource.receipt() }) : freeze({ resources: resource.receipt(), armed, fault, capturableCommands: captures.map(value => ({ commandId: value.fact.commandId, kind: value.fact.requestedCommand.kind, status: value.fact.status, tick: value.tick, generation: value.generation })), mode: armed ? 'live' : 'dry-run', plan: planPhysicalFeedback(getGraph().feedback), latest: copy(lastPlan), state: copy(armed ? world.physicalFeedback : dry) }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); return retirement.retire([
      { name: 'feedback-disarm', run: disarm },
      { name: 'feedback-listener', run: () => { disposed = true; armed = false; staged = dry = lastPlan = null; captures = []; captureBytes = 0; unsubscribe(); } },
      { name: 'feedback-storage', run: () => resource.release() }
    ]); }
  };
}
