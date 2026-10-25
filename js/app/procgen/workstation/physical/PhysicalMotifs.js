import { plain, identity, integer, finite, bounds, freeze, copy } from './PhysicalSchema.js';
export const MOTIF_PHYSICAL_KINDS = Object.freeze(['MotionCommitted', 'ContactResolved', 'ActionEntered', 'ActionExited', 'TerrainWorkCommitted', 'ActionCycleCompleted', 'FlightArcStarted', 'FlightArcUpdated', 'FlightArcEnded', 'ActorBorn', 'ActorTerminated', 'ActorLaneTransferred', 'PickupCrossing', 'RouteLap', 'EncounterBegan', 'EncounterEnded', 'RendezvousCompleted', 'RouteCompleted', 'RouteFailed', 'CrewRouteOpened', 'CrewRouteConnected', 'CrewMemberArrived', 'RestStarted', 'RestEnded']);
const physicalRoots = fact => fact.sourceEventIds || (fact.eventId ? [fact.eventId] : []);
const named = value => identity(value) && value.length <= 128;
const count = (value, fallback, maximum) => { const result = value ?? fallback; if (!integer(result, maximum) || result < 1) throw new Error('Invalid motif finite bound.'); return result; };
const readPredicate = (value, graph) => {
  if (!plain(value) || !MOTIF_PHYSICAL_KINDS.includes(value.kind)) throw new Error('Motif predicates require an actual supported physical fact kind.');
  for (const [key, group] of [['pickupId', 'pickups'], ['routeId', 'routes'], ['encounterId', 'encounters'], ['activityWindowId', 'activityWindows']]) if (value[key] != null && !graph[group]?.some(item => item.id === value[key])) throw new Error('Unresolved motif physical reference.');
  for (const key of ['action', 'operationKind', 'causeKind', 'crewProjectId']) if (value[key] != null && !named(value[key])) throw new Error('Invalid motif predicate identity.');
  if (value.direction != null && !['positive', 'negative', 'left', 'right'].includes(value.direction)) throw new Error('Invalid motif crossing direction.');
  return { kind: value.kind, ...Object.fromEntries(['pickupId', 'routeId', 'encounterId', 'activityWindowId', 'action', 'operationKind', 'causeKind', 'crewProjectId', 'direction'].filter(key => value[key] != null).map(key => [key, value[key]])), ...(value.region ? { region: bounds(value.region) } : {}) };
};
export function validatePhysicalMotifs(value, graph) {
  const input = value.motifs || []; if (!Array.isArray(input) || input.length > 32) throw new Error('Motif definition capacity exceeded.');
  const definitions = input.map(value => {
    if (!plain(value) || !named(value.id) || !integer(value.revision) || !['sequence', 'conjunction'].includes(value.mode ?? 'sequence') || !Array.isArray(value.roles) || !value.roles.length || value.roles.length > 8 || !Array.isArray(value.clauses) || !value.clauses.length || value.clauses.length > 16 || !['first', 'last', 'all'].includes(value.overlapPolicy ?? 'first')) throw new Error('Invalid bounded physical motif.');
    const roles = value.roles.map(role => {
      if (!plain(role) || !named(role.id) || !['actor', 'cohort'].includes(role.kind ?? 'actor') || role.ensembleId != null && !graph.ensembles?.some(ensemble => ensemble.id === role.ensembleId) || !Array.isArray(role.distinctFrom || []) || (role.distinctFrom || []).length > 7 || (role.distinctFrom || []).some(id => !named(id))) throw new Error('Invalid motif role.');
      return { id: role.id, kind: role.kind ?? 'actor', ensembleId: role.ensembleId ?? null, distinctFrom: [...new Set(role.distinctFrom || [])] };
    });
    if (new Set(roles.map(role => role.id)).size !== roles.length || roles.some(role => role.distinctFrom.some(id => id === role.id || !roles.some(other => other.id === id && other.kind === role.kind)))) throw new Error('Invalid distinct-participant role constraint.');
    const known = new Set(); let expanded = 0;
    const clauses = value.clauses.map(clause => {
      if (!plain(clause) || !roles.some(role => role.id === clause.role) || !['event', 'repeat', 'absence'].includes(clause.kind ?? 'event') || !['any', 'same', 'different'].includes(clause.actionInstance ?? 'any')) throw new Error('Invalid motif clause.');
      const absence = clause.kind === 'absence', repetitions = clause.kind === 'repeat' ? count(clause.count, 2, 8) : 1;
      if (absence && ((value.mode ?? 'sequence') !== 'sequence' || !known.has(clause.role))) throw new Error('Absence needs a previously physically bound role in a sequence.');
      known.add(clause.role); expanded += repetitions;
      return { kind: clause.kind ?? 'event', role: clause.role, predicate: readPredicate(clause.predicate, graph), count: repetitions, participantIndex: clause.participantIndex ?? 0, withinTicks: count(clause.withinTicks, 4096, 4096), durationTicks: absence ? count(clause.durationTicks, 1, 4096) : null, actionInstance: clause.actionInstance ?? 'any' };
    });
    if (expanded > 32 || clauses.some(clause => !integer(clause.participantIndex, 63))) throw new Error('Expanded motif exceeds finite grammar bounds.');
    const spatial = value.spatialConstraints || [];
    if (!Array.isArray(spatial) || spatial.length > 16) throw new Error('Motif spatial constraint capacity exceeded.');
    const spatialConstraints = spatial.map(constraint => { if (!plain(constraint) || constraint.unit !== 'pixels' || !roles.some(role => role.id === constraint.leftRole) || !roles.some(role => role.id === constraint.rightRole) || !finite(constraint.maximumDistance, 4096) || constraint.maximumDistance < 0) throw new Error('Invalid typed motif spatial constraint.'); return { leftRole: constraint.leftRole, rightRole: constraint.rightRole, unit: 'pixels', maximumDistance: constraint.maximumDistance }; });
    const mapping = value.completionMapping || { kind: 'accent' }, intervals = mapping.intervals ?? [0];
    if (!plain(mapping) || !['accent', 'harmony', 'response'].includes(mapping.kind) || !Array.isArray(intervals) || !intervals.length || intervals.length > 8 || intervals.some(value => !finite(value, 12000)) || !finite(mapping.velocityScale ?? 1, 2) || (mapping.velocityScale ?? 1) < 0 || !finite(mapping.gateTicks ?? 4, 256) || (mapping.gateTicks ?? 4) <= 0) throw new Error('Invalid bounded motif completion mapping.');
    return { id: value.id, revision: value.revision, mode: value.mode ?? 'sequence', roles, clauses, spatialConstraints, overlapPolicy: value.overlapPolicy ?? 'first', expiryTicks: count(value.expiryTicks, 64, 4096), maximumPartials: count(value.maximumPartials, 32, 64), invalidateOnTerrainChange: value.invalidateOnTerrainChange === true, completionMapping: { kind: mapping.kind, intervals: [...intervals], velocityScale: mapping.velocityScale ?? 1, gateTicks: mapping.gateTicks ?? 4 } };
  });
  if (new Set(definitions.map(value => value.id)).size !== definitions.length) throw new Error('Duplicate motif identity.'); return freeze(definitions);
}
const slotsFor = definition => definition.clauses.flatMap((clause, clauseIndex) => Array.from({ length: clause.count }, (_, repeatIndex) => ({ ...clause, clauseIndex, repeatIndex })));
const factKey = fact => fact.observationId || fact.eventId;
const contains = (point, region) => point && point.x >= region.x1 && point.x < region.x2 && point.y >= region.y1 && point.y < region.y2;
export function createPhysicalMotifObserver({ maximumPartials = 1024, maximumWork = 262144, maximumStateBytes = 8 * 1048576 } = {}) {
  if (!integer(maximumPartials, 1024) || !maximumPartials || !integer(maximumWork, 262144) || !maximumWork) throw new Error('Invalid motif observer budget.');
  if (!integer(maximumStateBytes, 128 * 1048576) || maximumStateBytes < 131072) throw new Error('Invalid motif state byte budget.');
  const stateCapacity = Math.min(maximumPartials, Math.floor(maximumStateBytes / 131072));
  let definitions = [], compiled = new Map(), signatures = new Map(), partials = new Map(), boundary = null, serial = 0, lastTick = -1, terrainRevision = null, trace = [], last = null;
  const report = value => { trace.push(freeze(value)); if (trace.length > 256) trace.shift(); };
  const configure = (values, graph = {}) => {
    const next = new Map(values.map(value => [value.id, JSON.stringify([value, value.roles.map(role => graph.ensembles?.find(ensemble => ensemble.id === role.ensembleId))])]));
    for (const [id, states] of partials) if (next.get(id) !== signatures.get(id)) { report({ motifId: id, status: 'invalidated', count: states.length, reason: 'rule-or-role-edit' }); partials.delete(id); }
    definitions = values; compiled = new Map(values.map(value => [value.id, slotsFor(value)])); signatures = next;
  };
  const observe = (batch, facts, domain, coverage = {}) => {
    const currentBoundary = `${batch.worldId}/${batch.generation}`;
    if (boundary !== currentBoundary) { partials.clear(); boundary = currentBoundary; serial = 0; lastTick = -1; terrainRevision = null; }
    if (!definitions.length) return { facts: [], responses: [], completeness: { status: 'complete' } };
    if (!Array.isArray(facts) || facts.length > 24576 || !Array.isArray(batch.snapshot?.actors) || batch.snapshot.actors.length > 32768) throw new Error('Motif observation source exceeds capacity.');
    const actors = new Map(batch.snapshot.actors.filter(actor => !actor.terminalReason).map(actor => [actor.actorId, actor])), output = [], responses = []; let work = 0, censored = false, total = [...partials.values()].reduce((sum, list) => sum + list.length, 0);
    const complete = batch.completeness?.status === 'complete' && (!batch.snapshot.completeness?.status || batch.snapshot.completeness.status === 'complete') && (lastTick < 0 || batch.tick === lastTick + 1);
    const eventTime = fact => fact.derivedObservation && Number.isFinite(fact.fraction) ? batch.tick - 1 + fact.fraction : batch.tick;
    const ordered = facts.filter(fact => MOTIF_PHYSICAL_KINDS.includes(fact.kind) && factKey(fact)).sort((a, b) => eventTime(a) - eventTime(b) || (a.causalSequence ?? 0) - (b.causalSequence ?? 0) || factKey(a).localeCompare(factKey(b)));
    const emit = (definition, state) => {
      if (output.length >= 256 || !state.roots.length) { censored = true; report({ motifId: definition.id, status: 'censored', reason: 'completion-capacity-or-missing-roots' }); return; }
      const bindings = Object.values(state.bindings), primary = bindings[0], observationId = `${batch.batchId}:motif:${definition.id}:${state.serial}`;
      const fact = freeze({ kind: 'MotifCompleted', motifId: definition.id, motifRevision: definition.revision, observationId, eventId: state.roots.at(-1), sourceEventIds: [...state.roots], actorId: primary.actorId, laneId: actors.get(primary.actorId)?.laneId ?? primary.laneId, participants: [...new Set(bindings.map(binding => binding.actorId))], roleBindings: copy(state.bindings), matchedObservationIds: [...state.used], recognitionTick: batch.tick, simTick: batch.tick, fraction: 1, subTick: 1, derivedObservation: true, observationPrecision: 'recognition-boundary', causalSequence: state.lastSequence, matchedStartTick: state.start, matchedEndTick: state.lastTime, absenceIntervals: state.absences.map(value => ({ ...value })), completionMapping: definition.completionMapping });
      output.push(fact); report({ motifId: definition.id, status: 'completed', observationId, roots: state.roots.length, recognitionTick: batch.tick });
      for (const [index, offset] of definition.completionMapping.intervals.entries()) responses.push(freeze({ ...fact, kind: 'MotifResponse', observationId: `${observationId}:response:${index}`, pitchOffsetCents: offset, velocityScale: definition.completionMapping.velocityScale, gateTicks: definition.completionMapping.gateTicks, derivedResponse: true, responseDescriptor: { kind: 'physical-motif', mapping: definition.completionMapping.kind, motifId: definition.id, completionId: observationId, recognitionTick: batch.tick } }));
    };
    const match = (definition, clause, state, fact) => {
      if (++work > maximumWork) return { status: 'unknown' };
      const predicate = clause.predicate;
      if (fact.kind !== predicate.kind || predicate.pickupId && predicate.pickupId !== fact.gateId || ['routeId', 'encounterId', 'activityWindowId', 'action', 'operationKind', 'causeKind', 'crewProjectId', 'direction'].some(key => predicate[key] != null && predicate[key] !== fact[key])) return null;
      const actorId = fact.participants?.[clause.participantIndex] ?? (clause.participantIndex ? null : fact.actorId), actor = actors.get(actorId), role = definition.roles.find(role => role.id === clause.role), point = fact.positionAfter || fact.position || actor;
      if (!integer(actorId) || predicate.region && !contains(point, predicate.region)) return null;
      const membership = domain.membership(role.ensembleId, actorId); if (membership.status !== 'complete' || fact.rootCoverage && fact.rootCoverage !== 'complete') return { status: 'unknown' }; if (!membership.includes) return null;
      const id = role.kind === 'actor' ? actorId : actor?.birthCohortId || fact.birthCohortId; if (id == null) return { status: 'unknown' };
      const previous = state.bindings[role.id]; if (previous && previous.id !== id) return null;
      if (previous && clause.actionInstance !== 'any' && (!fact.actionInstanceId || !previous.actionInstanceId || (fact.actionInstanceId === previous.actionInstanceId) !== (clause.actionInstance === 'same'))) return null;
      for (const other of definition.roles) { const bound = state.bindings[other.id]; if (bound && (role.distinctFrom.includes(other.id) || other.distinctFrom.includes(role.id)) && bound.id === id) return null; }
      const binding = previous || { id, actorId, laneId: actor?.laneId ?? fact.laneId ?? null, actionInstanceId: fact.actionInstanceId ?? actor?.actionInstanceId ?? null, position: point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null };
      const candidates = { ...state.bindings, [role.id]: binding };
      for (const constraint of definition.spatialConstraints) { const a = candidates[constraint.leftRole], b = candidates[constraint.rightRole]; if (a && b && (!a.position || !b.position)) return { status: 'unknown' }; if (a && b && Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) > constraint.maximumDistance) return null; }
      return { status: 'matched', binding };
    };
    for (const definition of definitions) {
      const slots = compiled.get(definition.id), prior = partials.get(definition.id) || [], usesRelationships = slots.some(slot => ['EncounterBegan', 'EncounterEnded', 'RendezvousCompleted'].includes(slot.predicate.kind));
      let states = prior; const usesActivity = slots.some(slot => ['RestStarted', 'RestEnded'].includes(slot.predicate.kind)), dependentUnknown = usesRelationships && coverage.encounters !== 'complete' || usesActivity && coverage.activity !== 'complete';
      if (!complete || dependentUnknown || definition.invalidateOnTerrainChange && terrainRevision != null && batch.terrainRevisionAfter !== terrainRevision) { total -= states.length; states = []; censored = !complete || dependentUnknown || censored; report({ motifId: definition.id, status: complete && !usesRelationships ? 'invalidated' : 'censored', reason: 'coverage-or-terrain-boundary', count: prior.length }); if (!complete || dependentUnknown) { partials.delete(definition.id); continue; } }
      const advance = (state, now, inclusive) => {
        if (definition.mode !== 'sequence') return;
        let index = state.done.findIndex(value => !value);
        while (index >= 0 && slots[index].kind === 'absence') {
          const deadline = state.lastTime + slots[index].durationTicks; if (inclusive ? deadline > now : deadline >= now) break;
          state.done[index] = true; state.absences.push({ firstTick: state.lastTime, lastTick: deadline, predicate: slots[index].predicate.kind, coverage: 'complete' }); state.lastTime = deadline; index = state.done.findIndex(value => !value);
        }
      };
      const retain = []; for (const state of states) { if (batch.tick - state.start > definition.expiryTicks || Object.entries(state.bindings).some(([id, binding]) => definition.roles.find(role => role.id === id).kind === 'actor' && !actors.has(binding.actorId) && !ordered.some(fact => fact.actorId === binding.actorId))) { total--; report({ motifId: definition.id, status: 'expired', partialId: state.serial, reason: 'deadline-or-actor-removed' }); } else retain.push(state); } states = retain;
      const consume = (state, fact) => {
        if (state.used.includes(factKey(fact))) return false;
        advance(state, eventTime(fact), false); if (state.done.every(Boolean)) return true;
        const next = state.done.findIndex(value => !value), candidates = definition.mode === 'sequence' ? [next] : slots.map((_, i) => i).filter(i => !state.done[i]);
        for (const index of candidates) {
          const clause = slots[index], result = match(definition, clause, state, fact); if (!result) continue;
          if (result.status === 'unknown') { state.censored = true; return false; }
          if (clause.kind === 'absence') { state.rejected = true; report({ motifId: definition.id, status: 'rejected', partialId: state.serial, reason: 'forbidden-event-before-deadline' }); return false; }
          if (eventTime(fact) - state.lastTime > clause.withinTicks || eventTime(fact) - state.start > definition.expiryTicks) continue;
          const roots = [...new Set([...state.roots, ...physicalRoots(fact)])]; if (!physicalRoots(fact).length || roots.length > 128) { state.censored = true; return false; }
          state.bindings[clause.role] = result.binding; state.done[index] = true; state.roots = roots; state.used.push(factKey(fact)); state.lastTime = eventTime(fact); state.lastSequence = Math.max(state.lastSequence, fact.causalSequence || 0); return state.done.every(Boolean);
        }
        return false;
      };
      for (const fact of ordered) {
        if (work > maximumWork) break;
        const next = []; for (const state of states) { const finished = consume(state, fact); if (finished) { emit(definition, state); total--; } else if (state.censored || state.rejected) { total--; if (state.censored) { censored = true; report({ motifId: definition.id, status: 'censored', partialId: state.serial, reason: 'matching-coverage-or-work-capacity' }); } } else next.push(state); } states = next;
        if (definition.overlapPolicy === 'first' && states.length) continue;
        const start = { serial: serial + 1, start: eventTime(fact), lastTime: eventTime(fact), lastSequence: fact.causalSequence || 0, bindings: {}, done: slots.map(() => false), roots: [], used: [], absences: [] };
        const first = definition.mode === 'sequence' ? match(definition, slots[0], start, fact) : (() => { const options = slots.map(slot => match(definition, slot, start, fact)); return options.find(result => result?.status === 'matched') || options.find(result => result?.status === 'unknown'); })(); if (!first || first.status !== 'matched') { if (first?.status === 'unknown') censored = true; continue; }
        if (!Number.isSafeInteger(start.serial) || total - (definition.overlapPolicy === 'last' ? states.length : 0) >= stateCapacity || definition.overlapPolicy !== 'last' && states.length >= definition.maximumPartials) { censored = true; report({ motifId: definition.id, status: 'censored', reason: 'partial-capacity' }); continue; }
        if (definition.overlapPolicy === 'last') { total -= states.length; report({ motifId: definition.id, status: 'expired', count: states.length, reason: 'newer-anchor' }); states = []; }
        serial++; const finished = consume(start, fact); if (start.censored || start.rejected) { censored = true; continue; }
        if (finished) emit(definition, start); else { states.push(start); total++; }
      }
      if (work > maximumWork) { total -= states.length; states = []; censored = true; report({ motifId: definition.id, status: 'censored', reason: 'work-capacity' }); }
      states = states.filter(state => { advance(state, batch.tick, true); if (state.done.every(Boolean)) { emit(definition, state); total--; return false; } return true; });
      if (work > maximumWork) { total -= states.length; states = []; censored = true; report({ motifId: definition.id, status: 'censored', reason: 'work-capacity' }); }
      if (states.length) { partials.set(definition.id, states); report({ motifId: definition.id, status: 'partial', count: states.length }); } else partials.delete(definition.id);
    }
    lastTick = batch.tick; terrainRevision = batch.terrainRevisionAfter ?? null; last = freeze({ facts: output, responses, completeness: { status: censored ? 'censored' : 'complete', work, partials: total } }); return last;
  };
  return { configure, observe, reset() { partials.clear(); boundary = null; lastTick = -1; terrainRevision = null; last = null; },
    snapshot: () => freeze(copy({ version: 1, boundary, serial, lastTick, terrainRevision, partials: [...partials] })),
    restore(value) {
      if (value?.version !== 1 || value.boundary != null && (typeof value.boundary !== 'string' || value.boundary.length > 256) || !integer(value.serial) || !Number.isSafeInteger(value.lastTick) || value.lastTick < -1 || value.terrainRevision != null && !integer(value.terrainRevision) || !Array.isArray(value.partials) || value.partials.length > 32 || JSON.stringify(value).length * 2 > 8 * 1048576) throw new Error('Invalid motif checkpoint.');
      const next = new Map(); let count = 0; const serials = new Set();
      for (const [id, states] of value.partials) {
        const definition = definitions.find(value => value.id === id), slots = compiled.get(id); if (!definition || next.has(id) || !Array.isArray(states) || states.length > definition.maximumPartials) throw new Error('Invalid motif partial owner.');
        for (const state of states) {
          if (!plain(state) || !integer(state.serial) || state.serial > value.serial || serials.has(state.serial) || !Number.isFinite(state.start) || !Number.isFinite(state.lastTime) || state.start > state.lastTime || state.lastTime > value.lastTick || !integer(state.lastSequence) || !plain(state.bindings) || Object.keys(state.bindings).length > 8 || !Array.isArray(state.done) || state.done.length !== slots.length || state.done.some(value => typeof value !== 'boolean') || state.done.every(Boolean) || !state.done.some(Boolean) || !Object.keys(state.bindings).length || !Array.isArray(state.roots) || state.roots.length > 128 || !state.roots.length || state.roots.some(id => !identity(id)) || !Array.isArray(state.used) || state.used.length > 32 || state.used.some(id => typeof id !== 'string' || !id.length || id.length > 512) || !Array.isArray(state.absences) || state.absences.length > 16 || state.censored || state.rejected) throw new Error('Invalid finite motif partial state.');
          for (const [id, binding] of Object.entries(state.bindings)) { const role = definition.roles.find(value => value.id === id); if (!role || !plain(binding) || !integer(binding.actorId) || (role.kind === 'actor' ? binding.id !== binding.actorId : !identity(binding.id)) || binding.position && (!finite(binding.position.x) || !finite(binding.position.y)) || binding.actionInstanceId != null && !identity(binding.actionInstanceId)) throw new Error('Invalid motif role binding.'); }
          if (state.absences.some(value => !plain(value) || !Number.isFinite(value.firstTick) || !Number.isFinite(value.lastTick) || value.firstTick > value.lastTick || value.lastTick > state.lastTime || value.coverage !== 'complete' || !MOTIF_PHYSICAL_KINDS.includes(value.predicate))) throw new Error('Invalid motif absence evidence.');
          if (new Set(state.roots).size !== state.roots.length || new Set(state.used).size !== state.used.length || state.used.length !== state.done.filter((done, index) => done && slots[index].kind !== 'absence').length || state.done.some((done, index) => done && !state.bindings[slots[index].role]) || definition.mode === 'sequence' && state.done.some((done, index) => done && state.done.slice(0, index).includes(false))) throw new Error('Incoherent motif checkpoint progress.');
          serials.add(state.serial); if (++count > stateCapacity) throw new Error('Motif checkpoint partial budget exceeded.');
        } next.set(id, copy(states));
      }
      partials = next; boundary = value.boundary; serial = value.serial; lastTick = value.lastTick; terrainRevision = value.terrainRevision; last = null;
    }, diagnostics: () => freeze({ definitions: definitions.length, stateCapacity, maximumStateBytes, reservedBytesPerPartialEstimate: 131072, partials: [...partials.values()].reduce((sum, values) => sum + values.length, 0), trace: [...trace], last }) };
}
