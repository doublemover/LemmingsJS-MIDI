import { plain, identity, integer, finite, bounds, freeze, copy } from './PhysicalSchema.js';
import { MOTIF_PHYSICAL_KINDS } from './PhysicalMotifs.js';
const roots = fact => fact.sourceEventIds || (fact.eventId ? [fact.eventId] : []);
const inside = (point, region) => !region || point && point.x >= region.x1 && point.x < region.x2 && point.y >= region.y1 && point.y < region.y2;
export function validateActivityWindows(value, graph) {
  const input = value.activityWindows || []; if (!Array.isArray(input) || input.length > 64) throw new Error('Activity-window capacity exceeded.');
  const result = input.map(value => {
    if (!plain(value) || !identity(value.id) || value.id.length > 128 || !integer(value.revision) || !integer(value.timeoutTicks, 65536) || value.timeoutTicks < 1 || !Array.isArray(value.physicalKinds) || value.physicalKinds.length > 32 || value.physicalKinds.some(kind => !MOTIF_PHYSICAL_KINDS.includes(kind) || ['RestStarted', 'RestEnded'].includes(kind))) throw new Error('Invalid physical activity window.');
    const scope = value.scope || {}, heldActions = value.heldActions || [], completion = value.completionPolicy || { kind: 'none' };
    if (!plain(scope) || !Array.isArray(scope.laneIds || []) || (scope.laneIds || []).length > 128 || (scope.laneIds || []).some(id => !integer(id, 1023)) || !Array.isArray(heldActions) || heldActions.length > 32 || heldActions.some(action => !identity(action)) || !['none', 'on-rest', 'on-rest-or-unknown'].includes(value.voiceRelease ?? 'none')) throw new Error('Invalid activity scope or held policy.');
    for (const [key, group] of [['ensembleId', 'ensembles'], ['routeId', 'routes'], ['topologyRegionId', 'topologyRegions']]) if (scope[key] != null && !graph[group]?.some(item => item.id === scope[key])) throw new Error('Unresolved activity source scope.');
    if (!plain(completion) || !['none', 'crew-route'].includes(completion.kind) || completion.crewProjectId != null && !identity(completion.crewProjectId)) throw new Error('Invalid route-completion policy.');
    if (completion.expectedCrew != null && (!integer(completion.expectedCrew, 64) || completion.expectedCrew < 1) || (completion.expectedCrew != null || completion.goalRegion != null) && completion.kind !== 'crew-route') throw new Error('A fixed-cohort goal requires an explicit crew-route completion policy.');
    const goalRegion = completion.goalRegion == null ? null : bounds(completion.goalRegion);
    const intervals = completion.intervals || [0]; if (!Array.isArray(intervals) || !intervals.length || intervals.length > 8 || intervals.some(value => !finite(value, 12000)) || !finite(completion.gateTicks ?? 8, 256) || (completion.gateTicks ?? 8) <= 0) throw new Error('Invalid bounded cadence response.');
    return { id: value.id, revision: value.revision, timeoutTicks: value.timeoutTicks, physicalKinds: [...new Set(value.physicalKinds)], scope: { laneIds: [...new Set(scope.laneIds || [])], ensembleId: scope.ensembleId ?? null, routeId: scope.routeId ?? null, topologyRegionId: scope.topologyRegionId ?? null, region: scope.region ? bounds(scope.region) : null }, heldActions: [...new Set(heldActions)], heldVoicesCount: value.heldVoicesCount !== false, voiceRelease: value.voiceRelease ?? 'none', completionPolicy: { kind: completion.kind, crewProjectId: completion.crewProjectId ?? null, intervals: [...intervals], gateTicks: completion.gateTicks ?? 8, ...(completion.expectedCrew == null ? {} : { expectedCrew: completion.expectedCrew }), ...(goalRegion ? { goalRegion } : {}) } };
  });
  if (new Set(result.map(value => value.id)).size !== result.length) throw new Error('Duplicate activity-window identity.'); return freeze(result);
}
export function createActivityWindowObserver({ maximumWork = 262144, maximumCompletions = 4096 } = {}) {
  if (!integer(maximumWork, 262144) || !maximumWork || !integer(maximumCompletions, 4096) || !maximumCompletions) throw new Error('Invalid activity observer capacity.');
  let definitions = [], signatures = new Map(), states = new Map(), completions = new Map(), boundary = null, lastTick = -1, last = null;
  const configure = (values, graph = {}) => {
    const next = new Map(values.map(value => [value.id, JSON.stringify([value, graph.ensembles?.find(item => item.id === value.scope.ensembleId), graph.routes?.find(item => item.id === value.scope.routeId), graph.topologyRegions?.find(item => item.id === value.scope.topologyRegionId)])]));
    for (const id of states.keys()) if (next.get(id) !== signatures.get(id)) states.delete(id);
    for (const [key, value] of completions) if (!next.has(value.windowId)) completions.delete(key);
    definitions = values; signatures = next;
  };
  const observe = (batch, facts, domain, { heldVoices = [], relationships = 'complete', getLaneState = () => ({ available: true }), output = { status: 'unobserved' } } = {}) => {
    const current = `${batch.worldId}/${batch.generation}`; if (current !== boundary) { states.clear(); completions.clear(); boundary = current; lastTick = -1; }
    if (!definitions.length) return { facts: [], responses: [], windows: [], completeness: { status: 'complete' } };
    if (!Array.isArray(facts) || facts.length > 24576 || !Array.isArray(batch.snapshot?.actors) || batch.snapshot.actors.length > 32768 || !Array.isArray(heldVoices) || heldVoices.length > 512) throw new Error('Activity source capacity exceeded.');
    facts = [...facts].sort((a, b) => (a.causalSequence || 0) - (b.causalSequence || 0) || (a.observationId || a.eventId || '').localeCompare(b.observationId || b.eventId || ''));
    const actors = new Map(batch.snapshot.actors.filter(actor => !actor.terminalReason).map(actor => [actor.actorId, actor])), result = [], responses = [], views = []; let work = 0, censored = false;
    const endedActors = new Set(), endedActions = new Set(), completionsInBatch = [], failuresInBatch = [];
    for (const fact of facts) { if (fact.kind === 'ActorTerminated') endedActors.add(fact.actorId); if (fact.kind === 'ActionExited') endedActions.add(`${fact.actorId}/${fact.actionInstanceId}`); if (fact.kind === 'RouteCompleted') completionsInBatch.push(fact); if (fact.kind === 'RouteFailed') failuresInBatch.push(fact); }
    const coverageComplete = batch.completeness?.status === 'complete' && (!batch.snapshot.completeness?.status || batch.snapshot.completeness.status === 'complete') && (lastTick < 0 || batch.tick === lastTick + 1);
    const emit = (definition, kind, state, sourceFacts, extra = {}) => {
      const sourceEventIds = [...new Set(sourceFacts.flatMap(roots))]; if (!sourceEventIds.length || sourceEventIds.length > 128) return null;
      const actorId = sourceFacts.find(fact => integer(fact.actorId))?.actorId ?? state.actorId, actor = actors.get(actorId);
      const fact = freeze({ kind, activityWindowId: definition.id, windowRevision: definition.revision, observationId: `${batch.batchId}:activity:${definition.id}:${kind}:${extra.completionId || ''}`, eventId: sourceEventIds[0] || null, sourceEventIds,
        actorId, laneId: actor?.laneId ?? state.laneId, recognitionTick: batch.tick, fraction: 1, subTick: 1, derivedObservation: true, observationPrecision: 'completed-simulation-boundary', causalSequence: Math.max(0, ...sourceFacts.map(fact => fact.causalSequence || 0)), physicalCoverage: 'complete', ...extra }); result.push(fact); return fact;
    };
    for (const definition of definitions) {
      let state = states.get(definition.id); if (!state) { state = { lastCauseTick: null, lastCauseIds: [], actorId: null, laneId: null, resting: false, status: 'never-active', coverageStartTick: batch.tick }; states.set(definition.id, state); }
      const scope = definition.scope, members = new Map(); let unknown = !coverageComplete || !!scope.ensembleId && domain.ensembleView?.(scope.ensembleId)?.completeness.status !== 'complete', held = 0, muted = 0;
      for (const actor of actors.values()) {
        if (++work > maximumWork) { unknown = true; break; }
        if (scope.laneIds.length && !scope.laneIds.includes(actor.laneId) || !inside(actor, scope.region)) continue;
        const membership = domain.membership(scope.ensembleId, actor.actorId); if (membership.status !== 'complete') { unknown = true; continue; } if (!membership.includes) continue;
        if (scope.routeId && domain.routeCoordinate(actor.actorId, scope.routeId)?.status !== 'qualified') { unknown = true; continue; }
        members.set(actor.actorId, actor); if (getLaneState(actor.laneId)?.available === false) muted++;
        if (definition.heldActions.includes(actor.action)) held++;
      }
      if (scope.topologyRegionId) { const topology = batch.snapshot.topology?.regions?.find(value => value.regionId === scope.topologyRegionId)?.current; if (topology?.status !== 'complete' || topology.sourceRevision !== batch.snapshot.terrainRevision) unknown = true; }
      if (definition.physicalKinds.some(kind => ['EncounterBegan', 'EncounterEnded', 'RendezvousCompleted'].includes(kind)) && relationships !== 'complete') unknown = true;
      if (definition.heldVoicesCount) for (const voice of heldVoices) if (members.has(voice.actorId) && !endedActors.has(voice.actorId) && !endedActions.has(`${voice.actorId}/${voice.actionInstanceId}`)) held++;
      const qualifying = [];
      for (const fact of facts) {
        if (++work > maximumWork) { unknown = true; break; }
        if (!definition.physicalKinds.includes(fact.kind) || !roots(fact).length) continue;
        if (fact.rootCoverage && fact.rootCoverage !== 'complete') { unknown = true; continue; }
        if (members.has(fact.actorId) || fact.kind === 'ActorTerminated' && (!scope.laneIds.length || scope.laneIds.includes(fact.laneId)) && !scope.ensembleId && !scope.routeId && inside(fact.positionAfter || fact.position, scope.region)) qualifying.push(fact);
      }
      const sourceIds = [...new Set(qualifying.length ? roots(qualifying.at(-1)) : [])]; if (sourceIds.length > 128) unknown = true;
      if (unknown) { censored = true; state.status = 'unknown-coverage'; state.resting = false; state.lastCauseTick = null; state.lastCauseIds = []; state.coverageStartTick = batch.tick; }
      else if (qualifying.length || held) {
        if (state.resting) emit(definition, 'RestEnded', state, qualifying.length ? [qualifying.at(-1)] : [{ actorId: state.actorId, sourceEventIds: state.lastCauseIds }], { reason: qualifying.length ? 'physical-cause' : 'held-physical-action', qualifyingCauseCount: qualifying.length });
        if (qualifying.length) { state.lastCauseIds = sourceIds; state.actorId = qualifying.at(-1).actorId; state.laneId = qualifying.at(-1).laneId ?? members.get(state.actorId)?.laneId ?? null; }
        state.lastCauseTick = batch.tick; state.resting = false; state.status = held ? 'held-physical-action' : 'physical-activity';
      } else if (!members.size) { state.status = 'empty-scope'; state.resting = false; state.lastCauseTick = null; state.lastCauseIds = []; }
      else if (state.lastCauseTick != null && batch.tick - state.lastCauseTick >= definition.timeoutTicks) {
        if (!state.resting) emit(definition, 'RestStarted', state, [{ actorId: state.actorId, sourceEventIds: state.lastCauseIds }], { lastCauseTick: state.lastCauseTick, timeoutTicks: definition.timeoutTicks });
        state.resting = true; state.status = 'physical-rest';
      } else state.status = state.lastCauseTick == null ? 'never-active' : 'physical-gap';
      for (const fact of completionsInBatch) if (fact.kind === 'RouteCompleted' && definition.completionPolicy.kind === 'crew-route' && (!definition.completionPolicy.crewProjectId || definition.completionPolicy.crewProjectId === fact.crewProjectId)) {
        if (++work > maximumWork) { censored = true; break; }
        const key = `${definition.id}/${fact.completionId}`; if (completions.has(key)) continue;
        if (definition.completionPolicy.expectedCrew != null && fact.admittedCrew !== definition.completionPolicy.expectedCrew || !inside(fact.positionAfter, definition.completionPolicy.goalRegion)) { censored = true; continue; }
        if (unknown || fact.completionCoverage !== 'complete' || fact.routeRevisionsUnchanged !== true || !identity(fact.completionId) || !Array.isArray(fact.participants) || !fact.participants.length || fact.participants.length !== fact.admittedCrew || fact.participants.some(id => !members.has(id)) || !Array.isArray(fact.prerequisiteSourceEventIds) || fact.prerequisiteSourceEventIds.length !== fact.admittedCrew + 2 || completions.size >= maximumCompletions) { censored = true; continue; }
        const allRoots = [...fact.prerequisiteSourceEventIds, fact.eventId]; if (allRoots.some(id => !identity(id)) || new Set(allRoots).size !== allRoots.length) { censored = true; continue; }
        completions.set(key, { windowId: definition.id, tick: batch.tick });
        const completion = emit(definition, 'CadenceRecognized', state, [{ ...fact, sourceEventIds: allRoots }], { completionId: fact.completionId, participants: fact.participants, crewProjectId: fact.crewProjectId });
        if (completion) for (const [index, offset] of definition.completionPolicy.intervals.entries()) responses.push(freeze({ ...completion, kind: 'CadenceResponse', observationId: `${completion.observationId}:voice:${index}`, pitchOffsetCents: offset, gateTicks: definition.completionPolicy.gateTicks, derivedResponse: true, responseDescriptor: { kind: 'physical-cadence', completionId: fact.completionId, sourceCount: fact.admittedCrew } }));
      }
      const failed = failuresInBatch.filter(fact => fact.kind === 'RouteFailed' && (!scope.laneIds.length || scope.laneIds.includes(fact.laneId)));
      views.push({ id: definition.id, revision: definition.revision, status: state.status, lastCauseTick: state.lastCauseTick, elapsedTicks: state.lastCauseTick == null ? null : batch.tick - state.lastCauseTick, timeoutTicks: definition.timeoutTicks, memberCount: members.size, heldCount: held, mutedMembers: muted, output: copy(output), routeFailure: failed.at(-1)?.reason ?? null, releasesHeldVoices: definition.voiceRelease === 'on-rest-or-unknown' && unknown || definition.voiceRelease !== 'none' && state.resting });
    }
    lastTick = batch.tick; last = freeze({ facts: result, responses, windows: views, completeness: { status: censored ? 'censored' : 'complete', work } }); return last;
  };
  return { configure, observe, reset() { states.clear(); completions.clear(); boundary = null; lastTick = -1; last = null; }, snapshot: () => freeze(copy({ version: 1, boundary, lastTick, states: [...states], completions: [...completions] })),
    restore(value) {
      if (value?.version !== 1 || value.boundary != null && (typeof value.boundary !== 'string' || value.boundary.length > 256) || !Number.isSafeInteger(value.lastTick) || value.lastTick < -1 || !Array.isArray(value.states) || value.states.length > 64 || !Array.isArray(value.completions) || value.completions.length > maximumCompletions || JSON.stringify(value).length * 2 > 4 * 1048576) throw new Error('Invalid activity checkpoint.');
      const next = new Map(), done = new Map();
      for (const [id, state] of value.states) { if (!definitions.some(value => value.id === id) || next.has(id) || !plain(state) || state.lastCauseTick != null && (!integer(state.lastCauseTick) || state.lastCauseTick > value.lastTick) || !Array.isArray(state.lastCauseIds) || state.lastCauseIds.length > 128 || state.lastCauseIds.some(id => !identity(id)) || typeof state.resting !== 'boolean' || !['never-active', 'unknown-coverage', 'held-physical-action', 'physical-activity', 'empty-scope', 'physical-rest', 'physical-gap'].includes(state.status) || !integer(state.coverageStartTick) || state.coverageStartTick > value.lastTick || state.actorId != null && !integer(state.actorId) || state.resting !== (state.status === 'physical-rest') || state.resting && (state.lastCauseTick == null || value.lastTick - state.lastCauseTick < definitions.find(value => value.id === id).timeoutTicks) || new Set(state.lastCauseIds).size !== state.lastCauseIds.length) throw new Error('Invalid activity boundary state.'); next.set(id, copy(state)); }
      for (const [key, state] of value.completions) { if (typeof key !== 'string' || key.length > 512 || done.has(key) || !plain(state) || !definitions.some(value => value.id === state.windowId) || !integer(state.tick) || state.tick > value.lastTick) throw new Error('Invalid cadence ownership checkpoint.'); done.set(key, copy(state)); }
      states = next; completions = done; boundary = value.boundary; lastTick = value.lastTick; last = null;
    }, diagnostics: () => freeze({ definitions: definitions.length, recognizedCompletions: completions.size, last }) };
}
