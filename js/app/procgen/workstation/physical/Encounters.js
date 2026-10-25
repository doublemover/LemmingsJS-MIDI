import { plain, identity, integer, finite, bounds, freeze, copy } from './PhysicalSchema.js';
const roots = fact => fact?.sourceEventIds || (fact?.eventId ? [fact.eventId] : []);
const inside = (point, b) => point.x >= b.x1 && point.x < b.x2 && point.y >= b.y1 && point.y < b.y2;
const pairKey = (id, a, b) => `${id}/${Math.min(a, b)}/${Math.max(a, b)}`;
const number = (value, fallback, low, high) => { const result = value ?? fallback; if (!Number.isFinite(result) || result < low || result > high) throw new Error('Invalid encounter physical bound.'); return result; };
export function validateEncounterDefinition(value, domain) {
  if (!plain(value) || !identity(value.id) || value.id.length > 128 || !integer(value.revision) || !['proximity', 'rendezvous'].includes(value.kind ?? 'proximity')) throw new Error('Invalid encounter definition.');
  const region = bounds(value.region), participants = value.participants ?? {}, response = value.response ?? { kind: 'duet' };
  if (!plain(participants) || !plain(response) || !['duet', 'unison', 'intervalExchange', 'rendezvousChord'].includes(response.kind)) throw new Error('Invalid encounter participant or response contract.');
  for (const id of [participants.leftEnsembleId, participants.rightEnsembleId]) if (id != null && !domain.ensembles.some(ensemble => ensemble.id === id)) throw new Error('Unknown encounter ensemble.');
  if (value.densePolicy != null && !['aggregate', 'censor'].includes(value.densePolicy) || response.statePolicy != null && !['exchange-memory', 'mirror-memory', 'harmonize'].includes(response.statePolicy) || response.kind === 'intervalExchange' && response.statePolicy === 'harmonize' || response.kind !== 'intervalExchange' && response.statePolicy != null && response.statePolicy !== 'harmonize') throw new Error('Unsupported encounter aggregation or musical-state policy.');
  const metric = value.distanceMetric ?? 'euclidean'; if (!['euclidean', 'lane-x', 'route-distance'].includes(metric) || metric === 'route-distance' && !domain.routes.some(route => route.id === value.routeId)) throw new Error('Unknown encounter distance metric or route.');
  if ((value.kind ?? 'proximity') === 'rendezvous' && !domain.pickups.some(pickup => pickup.id === value.pickupId)) throw new Error('Rendezvous needs an actual pickup gate.');
  const enterRadius = number(value.enterRadius, 4, 0.25, 64), exitRadius = number(value.exitRadius, enterRadius + 2, enterRadius, 128);
  const intervals = response.intervals ?? [0, 700]; if (!Array.isArray(intervals) || !intervals.length || intervals.length > 16 || intervals.some(value => !finite(value, 12000))) throw new Error('Invalid encounter response intervals.');
  return freeze({ id: value.id, revision: value.revision, kind: value.kind ?? 'proximity', region, distanceMetric: metric, routeId: value.routeId ?? null, pickupId: value.pickupId ?? null,
    participants: { leftEnsembleId: participants.leftEnsembleId ?? null, rightEnsembleId: participants.rightEnsembleId ?? null, oppositeDirectionOnly: participants.oppositeDirectionOnly === true }, enterRadius, exitRadius,
    minimumSeparationTicks: Math.round(number(value.minimumSeparationTicks, 1, 1, 4096)), maximumPairs: Math.round(number(value.maximumPairs, 64, 1, 256)), maximumNeighbors: Math.round(number(value.maximumNeighbors, 1, 1, 8)),
    candidateLimit: Math.round(number(value.candidateLimit, 8192, 1, 8192)), densePolicy: value.densePolicy === 'censor' ? 'censor' : 'aggregate', groupingToleranceTicks: Math.round(number(value.groupingToleranceTicks, 2, 0, 64)), minimumParticipants: Math.round(number(value.minimumParticipants, 2, 2, 64)), maximumParticipants: Math.round(number(value.maximumParticipants, 16, 2, 64)),
    response: { kind: response.kind, intervals: [...intervals], maximumVoices: Math.round(number(response.maximumVoices, 8, 1, 16)), gateTicks: number(response.gateTicks, 4, 0.25, 256), statePolicy: response.kind === 'intervalExchange' ? response.statePolicy === 'mirror-memory' ? 'mirror-memory' : 'exchange-memory' : 'harmonize' } });
}
export function validateEncounterDomain(value, domain) {
  const input = value.encounters ?? []; if (!Array.isArray(input) || input.length > 32) throw new Error('Encounter definition capacity exceeded.'); const definitions = input.map(value => validateEncounterDefinition(value, domain));
  if (new Set(definitions.map(value => value.id)).size !== definitions.length || definitions.some(value => value.maximumParticipants < value.minimumParticipants)) throw new Error('Invalid encounter identity or participant bounds.'); return freeze(definitions);
}
const closest = (a, b, oneDimensional) => {
  const x = a.before.x - b.before.x, y = oneDimensional ? 0 : a.before.y - b.before.y, dx = a.after.x - a.before.x - (b.after.x - b.before.x), dy = oneDimensional ? 0 : a.after.y - a.before.y - (b.after.y - b.before.y);
  const speed2 = dx * dx + dy * dy, fraction = speed2 ? Math.max(0, Math.min(1, -(x * dx + y * dy) / speed2)) : 0;
  return { distance: Math.hypot(x + dx * fraction, y + dy * fraction), fraction, endDistance: Math.hypot(a.after.x - b.after.x, oneDimensional ? 0 : a.after.y - b.after.y) };
};
export function createEncounterObserver({ maximumEpisodes = 2048, maximumState = 16384, maximumWork = 262144 } = {}) {
  if (![maximumEpisodes, maximumState, maximumWork].every(value => integer(value)) || maximumEpisodes < 1 || maximumEpisodes > 2048 || maximumState < 1 || maximumState > 16384 || maximumWork < 1 || maximumWork > 262144) throw new Error('Invalid encounter observer capacity.');
  let definitions = [], signatures = new Map(), boundary = null, serial = 0, lastTick = -1, diagnostics = [], diagnosticOverflow = 0, lastFacts = [];
  let episodes = new Map(), cooldowns = new Map(), rendezvous = new Map(), pitchMemory = new Map(), coordinates = new Map();
  const report = value => { if (diagnostics.length < 256) diagnostics.push(value); else diagnosticOverflow++; };
  const configure = values => { const next = new Map(values.map(value => [value.id, JSON.stringify(value)])); for (const map of [episodes, cooldowns, rendezvous, coordinates]) for (const [key, state] of map) if (signatures.get(state.definitionId) !== next.get(state.definitionId)) map.delete(key); definitions = values; signatures = next; };
  const observe = (batch, facts, domain) => {
    if (!definitions.length) { lastFacts = []; return { facts: [], responses: [], completeness: { status: 'complete', diagnostics: [] } }; }
    const sourceBoundary = `${batch.worldId}/${batch.generation}`;
    if (boundary !== sourceBoundary) { episodes.clear(); cooldowns.clear(); rendezvous.clear(); pitchMemory.clear(); coordinates.clear(); serial = 0; lastTick = -1; boundary = sourceBoundary; }
    if (!Array.isArray(batch.snapshot?.actors) || batch.snapshot.actors.length > 32768 || !Array.isArray(facts) || facts.length > 16384) throw new Error('Encounter source capacity exceeded.');
    diagnostics = []; diagnosticOverflow = 0; const output = [], responses = [], actors = new Map((batch.snapshot?.actors || []).filter(actor => !actor.terminalReason).map(actor => [actor.actorId, actor])); let work = 0, censored = false;
    const incomplete = batch.completeness?.status !== 'complete' || !batch.snapshot || batch.snapshot.completeness?.status && batch.snapshot.completeness.status !== 'complete' || lastTick >= 0 && batch.tick !== lastTick + 1;
    lastTick = batch.tick;
    const motion = new Map(), causes = new Map(), cappedCauses = new Set();
    for (const fact of facts) {
      if (fact.actorId != null && roots(fact).length) { const list = causes.get(fact.actorId) || []; if (list.length < 64) list.push(fact); else cappedCauses.add(fact.actorId); causes.set(fact.actorId, list); }
      if (fact.kind === 'MotionCommitted') { const prior = motion.get(fact.actorId); motion.set(fact.actorId, { before: prior?.before || fact.positionBefore, after: fact.positionAfter, discontinuity: prior?.discontinuity || fact.discontinuity || fact.physicalPayload?.discontinuity }); }
      if (fact.kind === 'PickupCrossing' && finite(fact.pitchCents, 24000) && roots(fact).length) pitchMemory.set(fact.actorId, { pitchCents: fact.pitchCents, sourceEventIds: roots(fact).slice(0, 16), tick: batch.tick });
    }
    for (const id of pitchMemory.keys()) if (!actors.has(id)) pitchMemory.delete(id);
    if (pitchMemory.size > maximumState) { pitchMemory.clear(); report({ reason: 'pitch-memory-capacity' }); }
    const emit = (definition, kind, participants, sourceFacts, extra = {}) => {
      if (!Number.isSafeInteger(serial + 1) || output.length >= 4096) { censored = true; return null; }
      const allRoots = [...new Set(sourceFacts.flatMap(roots))].sort(), sourceEventIds = allRoots.slice(0, 64), actor = actors.get(participants[0]); if (!sourceEventIds.length && kind !== 'EncounterEnded') return null;
      const fact = freeze({ kind, encounterId: definition.id, encounterRevision: definition.revision, observationId: `${batch.batchId}:encounter:${definition.id}:${++serial}`, eventId: sourceEventIds[0] || null,
        sourceEventIds, actorId: participants[0] ?? null, laneId: actor?.laneId ?? null, participants: participants.slice(0, 64), participantCount: participants.length,
        sourceRootCount: allRoots.length, sourceRootCountExact: !participants.some(id => cappedCauses.has(id)), rootCoverage: allRoots.length > 64 || participants.some(id => cappedCauses.has(id)) ? 'capped' : 'complete', causalSequence: Math.max(0, ...sourceFacts.map(fact => fact.causalSequence ?? 0)),
        derivedObservation: true, observationPrecision: 'completed-state-and-relative-endpoint-chord', fraction: extra.fraction ?? 1, subTick: extra.fraction ?? 1, recognitionTick: batch.tick, sourceSnapshotRevision: batch.snapshot?.revision ?? null, ...extra });
      output.push(fact); return fact;
    };
    const respond = (definition, fact) => {
      if (responses.length + definition.response.maximumVoices > 4096) { censored = true; return; }
      if (!fact || fact.rootCoverage !== 'complete' && !fact.aggregation || !['EncounterBegan', 'RendezvousCompleted'].includes(fact.kind)) return;
      const ids = fact.participants.slice(0, definition.response.maximumVoices), captured = ids.map(id => pitchMemory.get(id));
      if (definition.response.kind === 'intervalExchange' && (ids.length !== 2 || captured.some(value => !value))) { report({ definitionId: definition.id, reason: 'partner-musical-memory-unavailable' }); return; }
      for (let index = 0; index < ids.length; index++) {
        const actor = actors.get(ids[index]); if (!actor) continue;
        const borrowed = definition.response.kind === 'intervalExchange' ? captured[1 - index] : null;
        const sourceEventIds = [...new Set([...fact.sourceEventIds, ...(borrowed?.sourceEventIds || [])])].slice(0, 80);
        responses.push(freeze({ ...fact, kind: 'EncounterResponse', actorId: actor.actorId, laneId: actor.laneId, actionInstanceId: actor.actionInstanceId,
          observationId: `${fact.observationId}:voice:${index}`, sourceEventIds, derivedResponse: true,
          ...(borrowed ? { pitchCents: borrowed.pitchCents } : { pitchOffsetCents: definition.response.kind === 'unison' ? 0 : definition.response.intervals[index % definition.response.intervals.length] }),
          gateTicks: definition.response.gateTicks, responseDescriptor: { kind: definition.response.kind, statePolicy: definition.response.statePolicy, episodeId: fact.episodeId || fact.observationId, participants: fact.participants, represented: ids.length, sourceCount: fact.participantCount, aggregation: fact.aggregation || null } }));
      }
      if (definition.response.kind === 'intervalExchange' && definition.response.statePolicy === 'exchange-memory') { pitchMemory.set(ids[0], captured[1]); pitchMemory.set(ids[1], captured[0]); }
    };
    if (incomplete) { for (const state of episodes.values()) { const definition = definitions.find(value => value.id === state.definitionId); if (definition) emit(definition, 'EncounterEnded', state.participants, [], { episodeId: state.episodeId, reason: 'coverage-lost' }); } episodes.clear(); rendezvous.clear(); coordinates.clear(); lastFacts = output; return { facts: output, responses, completeness: { status: 'censored', reason: 'source-coverage' } }; }
    for (const definition of definitions) {
      const members = [], byId = new Map(), seenEpisodes = new Set(); let definitionUnknown = false;
      for (const actor of [...actors.values()].sort((a, b) => a.actorId - b.actorId)) {
        if (++work > maximumWork) { definitionUnknown = true; break; }
        const movement = motion.get(actor.actorId), before = movement?.before || actor, after = movement?.after || actor;
        if (movement?.discontinuity || ![before.x, before.y, after.x, after.y].every(Number.isFinite)) continue;
        if (!inside(before, definition.region) && !inside(after, definition.region) && (Math.max(before.x, after.x) < definition.region.x1 || Math.min(before.x, after.x) >= definition.region.x2 || Math.max(before.y, after.y) < definition.region.y1 || Math.min(before.y, after.y) >= definition.region.y2)) continue;
        const left = domain.membership(definition.participants.leftEnsembleId, actor.actorId), right = domain.membership(definition.participants.rightEnsembleId, actor.actorId); if (left.status !== 'complete' || right.status !== 'complete') { definitionUnknown = true; continue; } if (!left.includes && !right.includes) continue;
        let projectedBefore = before, projectedAfter = after, axis = actor.laneId;
        if (definition.distanceMetric === 'route-distance') { const route = domain.routeCoordinate(actor.actorId, definition.routeId), key = `${definition.id}/${actor.actorId}`, prior = coordinates.get(key);
          if (route?.status !== 'qualified') { coordinates.delete(key); definitionUnknown = true; continue; }
          projectedAfter = { x: route.sPixels, y: 0 }; projectedBefore = { x: prior?.branchId === route.branchId && prior.tick === batch.tick - 1 ? prior.sPixels : route.sPixels, y: 0 }; axis = route.branchId;
          coordinates.set(key, { definitionId: definition.id, actorId: actor.actorId, branchId: route.branchId, tick: batch.tick, sPixels: route.sPixels }); }
        const member = { velocityX: Math.sign(after.x - before.x), actor, id: actor.actorId, before: projectedBefore, after: projectedAfter, worldBefore: before, worldAfter: after, axis, left: left.includes, right: right.includes };
        members.push(member); byId.set(member.id, member);
      }
      if (definitionUnknown) { censored = true; report({ definitionId: definition.id, reason: work > maximumWork ? 'encounter-work-capacity' : 'participant-coverage' }); }
      if (definition.kind === 'rendezvous') {
        const key = definition.id; let group = rendezvous.get(key);
        const finish = () => {
          if (!group) return; rendezvous.delete(key);
          const living = group.arrivals.filter(value => actors.has(value.actorId));
          if (!definitionUnknown && living.length >= definition.minimumParticipants) respond(definition, emit(definition, 'RendezvousCompleted', living.map(value => value.actorId), living.map(value => value.fact), { arrivalTimes: living.map(value => ({ actorId: value.actorId, sourceTick: value.time })), groupingToleranceTicks: definition.groupingToleranceTicks, overflow: group.overflow, groupingAuthority: 'declared-musical-window-not-collision', observationPrecision: 'recognition-boundary' }));
          else report({ definitionId: definition.id, reason: definitionUnknown ? 'rendezvous-censored' : 'rendezvous-insufficient-participants' });
          group = null;
        };
        for (const crossing of facts.filter(fact => fact.kind === 'PickupCrossing' && fact.gateId === definition.pickupId && fact.transition !== 'exit').sort((a, b) => (a.fraction ?? 1) - (b.fraction ?? 1) || a.actorId - b.actorId)) {
          if (!byId.has(crossing.actorId) || definitionUnknown) continue; const time = batch.tick - 1 + (crossing.fraction ?? 1);
          if (group && time > group.start + definition.groupingToleranceTicks) finish();
          if (!group) { if (rendezvous.size >= 256) { censored = true; break; } group = { definitionId: definition.id, start: time, arrivals: [], overflow: 0 }; rendezvous.set(key, group); }
          if (group.arrivals.some(value => value.actorId === crossing.actorId)) continue;
          if (group.arrivals.length >= definition.maximumParticipants) group.overflow++; else group.arrivals.push({ actorId: crossing.actorId, time, fact: { eventId: crossing.eventId, sourceEventIds: roots(crossing).slice(0, 64), causalSequence: crossing.causalSequence } });
        }
        if (group && (definitionUnknown || batch.tick >= group.start + definition.groupingToleranceTicks)) finish();
        continue;
      }
      const allowed = (a, b) => (a.left && b.right || b.left && a.right) && (!definition.participants.oppositeDirectionOnly || episodes.has(pairKey(definition.id, a.id, b.id)) || a.velocityX * b.velocityX < 0) && (definition.distanceMetric === 'euclidean' || a.axis === b.axis);
      const dense = new Map(), denseMembers = new Set(), small = Math.max(0.125, definition.enterRadius / 2);
      for (const member of members) { const key = `${definition.distanceMetric === 'euclidean' ? 'world' : member.axis}:${Math.floor(member.after.x / small)}:${definition.distanceMetric === 'euclidean' ? Math.floor(member.after.y / small) : 0}`, bucket = dense.get(key) || []; bucket.push(member); dense.set(key, bucket); }
      for (const [cell, bucket] of dense) if (bucket.length > 32) {
        for (const member of bucket) denseMembers.add(member.id);
        const a = bucket.filter(member => member.left).length, b = bucket.filter(member => member.right).length, both = bucket.filter(member => member.left && member.right).length;
        let pairCount = a * b - both * (both + 1) / 2;
        if (definition.participants.oppositeDirectionOnly) { const count = (side, direction) => bucket.filter(member => member[side] && member.velocityX === direction).length; pairCount = count('left', -1) * count('right', 1) + count('left', 1) * count('right', -1) - bucket.filter(member => member.left && member.right && member.velocityX === -1).length * bucket.filter(member => member.left && member.right && member.velocityX === 1).length; }
        const key = `${definition.id}/dense/${cell}`, ids = bucket.map(member => member.id), old = episodes.get(key);
        if (definitionUnknown || !pairCount && !old) continue;
        if (definition.densePolicy === 'censor') { censored = true; report({ definitionId: definition.id, reason: 'dense-pairs-censored', actorCount: bucket.length, pairCount }); continue; }
        seenEpisodes.add(key);
        censored = true; report({ definitionId: definition.id, reason: 'dense-detail-aggregated', actorCount: bucket.length, exactContainedPairs: pairCount, crossCellPairs: 'not-expanded', episodePolicy: 'occupied-spatial-cell', represented: Math.min(ids.length, definition.response.maximumVoices) });
        if (!old && episodes.size < maximumEpisodes && batch.tick >= (cooldowns.get(key)?.until ?? 0)) { const source = ids.flatMap(id => causes.get(id) || []), fact = emit(definition, 'EncounterBegan', ids, source, { aggregation: 'same-radius-cell-density', exactContainedPairs: pairCount, lostIndividualPairs: pairCount, representativePolicy: 'lowest-stable-actor-ids' });
          if (fact) { episodes.set(key, { definitionId: definition.id, episodeId: fact.observationId, participants: ids.slice(0, 64), dense: true, tick: batch.tick }); respond(definition, fact); } }
      }
      const bins = new Map(); let memberships = 0;
      for (const member of members) if (!denseMembers.has(member.id)) {
        const size = Math.max(8, definition.exitRadius), x1 = Math.floor((Math.min(member.before.x, member.after.x) - definition.exitRadius) / size), x2 = Math.floor((Math.max(member.before.x, member.after.x) + definition.exitRadius) / size), y1 = definition.distanceMetric === 'euclidean' ? Math.floor((Math.min(member.before.y, member.after.y) - definition.exitRadius) / size) : 0, y2 = definition.distanceMetric === 'euclidean' ? Math.floor((Math.max(member.before.y, member.after.y) + definition.exitRadius) / size) : 0;
        if ((x2 - x1 + 1) * (y2 - y1 + 1) > 64 || memberships + (x2 - x1 + 1) * (y2 - y1 + 1) > 65536) { censored = true; report({ definitionId: definition.id, actorId: member.id, reason: 'swept-bin-capacity' }); continue; }
        for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) { const key = `${definition.distanceMetric === 'euclidean' ? 'world' : member.axis}:${x}:${y}`, bucket = bins.get(key) || []; bucket.push(member); bins.set(key, bucket); memberships++; }
      }
      const candidates = new Map(); let exhausted = false;
      outer: for (const bucket of bins.values()) for (let i = 0; i < bucket.length; i++) for (let j = i + 1; j < bucket.length; j++) {
        if (++work > maximumWork) { exhausted = true; break outer; } const a = bucket[i], b = bucket[j], key = pairKey(definition.id, a.id, b.id); if (candidates.has(key) || !allowed(a, b)) continue;
        if (candidates.size >= definition.candidateLimit) { exhausted = true; break outer; } candidates.set(key, { key, a, b, ...closest(a, b, definition.distanceMetric !== 'euclidean') });
      }
      if (exhausted) { censored = true; report({ definitionId: definition.id, reason: 'candidate-pair-capacity', tested: candidates.size }); }
      const degree = new Map(); let selected = 0;
      for (const candidate of candidates.values()) if (episodes.has(candidate.key) && candidate.endDistance <= definition.exitRadius) { seenEpisodes.add(candidate.key); degree.set(candidate.a.id, (degree.get(candidate.a.id) || 0) + 1); degree.set(candidate.b.id, (degree.get(candidate.b.id) || 0) + 1); selected++; }
      for (const candidate of [...candidates.values()].sort((a, b) => a.distance - b.distance || a.a.id - b.a.id || a.b.id - b.b.id)) {
        const { key, a, b, distance, fraction, endDistance } = candidate, existing = episodes.get(key);
        if (existing && endDistance <= definition.exitRadius) { seenEpisodes.add(key); continue; }
        if (existing || distance > definition.enterRadius || definitionUnknown || exhausted || batch.tick < (cooldowns.get(key)?.until ?? 0) || selected >= definition.maximumPairs || (degree.get(a.id) || 0) >= definition.maximumNeighbors || (degree.get(b.id) || 0) >= definition.maximumNeighbors || episodes.size >= maximumEpisodes) continue;
        const at = { x: a.worldBefore.x + (a.worldAfter.x - a.worldBefore.x) * fraction, y: a.worldBefore.y + (a.worldAfter.y - a.worldBefore.y) * fraction }; const partnerAt = { x: b.worldBefore.x + (b.worldAfter.x - b.worldBefore.x) * fraction, y: b.worldBefore.y + (b.worldAfter.y - b.worldBefore.y) * fraction }; if (!inside(at, definition.region) || !inside(partnerAt, definition.region)) continue;
        const fact = emit(definition, 'EncounterBegan', [a.id, b.id].sort((x, y) => x - y), [...(causes.get(a.id) || []), ...(causes.get(b.id) || [])], { fraction, distancePixels: distance, position: at, metric: definition.distanceMetric });
        if (!fact) continue; selected++; degree.set(a.id, (degree.get(a.id) || 0) + 1); degree.set(b.id, (degree.get(b.id) || 0) + 1); episodes.set(key, { definitionId: definition.id, episodeId: fact.observationId, participants: [a.id, b.id], dense: false, tick: batch.tick }); seenEpisodes.add(key); respond(definition, fact);
      }
      for (const [key, state] of episodes) if (state.definitionId === definition.id && !seenEpisodes.has(key)) { emit(definition, 'EncounterEnded', state.participants, state.participants.flatMap(id => causes.get(id) || []), { episodeId: state.episodeId, reason: definitionUnknown || exhausted ? 'coverage-lost' : state.participants.some(id => !actors.has(id)) ? 'actor-removed' : 'separated' }); episodes.delete(key); if (cooldowns.size < maximumState) cooldowns.set(key, { definitionId: definition.id, until: batch.tick + definition.minimumSeparationTicks }); }
    }
    for (const [key, state] of cooldowns) if (state.until < batch.tick) cooldowns.delete(key);
    for (const [key, state] of coordinates) if (!actors.has(state.actorId)) coordinates.delete(key);
    if (coordinates.size > maximumState) { coordinates.clear(); censored = true; }
    lastFacts = output; return { facts: output, responses, completeness: { status: censored ? 'censored' : 'complete', diagnostics: [...diagnostics], diagnosticOverflow } };
  };
  return { configure, observe, snapshot: () => freeze(copy({ version: 1, boundary, serial, lastTick, episodes: [...episodes], cooldowns: [...cooldowns], rendezvous: [...rendezvous], pitchMemory: [...pitchMemory], coordinates: [...coordinates] })),
    restore(value) {
      if (JSON.stringify(value).length * 2 > 8 * 1048576) throw new Error('Encounter checkpoint byte capacity exceeded.');
      if (value?.version !== 1 || value.boundary != null && typeof value.boundary !== 'string' || !integer(value.serial) || !Number.isSafeInteger(value.lastTick) || value.lastTick < -1) throw new Error('Invalid encounter checkpoint.');
      const next = {}; for (const [name, maximum] of [['episodes', maximumEpisodes], ['cooldowns', maximumState], ['rendezvous', 256], ['pitchMemory', maximumState], ['coordinates', maximumState]]) { const entries = value[name]; if (!Array.isArray(entries) || entries.length > maximum || entries.some(entry => !Array.isArray(entry) || entry.length !== 2) || new Set(entries.map(entry => entry[0])).size !== entries.length || JSON.stringify(entries).length * 2 > 4 * 1048576) throw new Error('Encounter checkpoint capacity exceeded.'); for (const [key, state] of entries) { if (!plain(state) || name !== 'pitchMemory' && !definitions.some(definition => definition.id === state.definitionId) || name === 'pitchMemory' && (!integer(key) || !finite(state.pitchCents, 24000) || !Array.isArray(state.sourceEventIds) || state.sourceEventIds.length > 16 || state.sourceEventIds.some(id => !identity(id)))) throw new Error('Invalid encounter checkpoint identity.'); if (name === 'episodes' && (!(typeof state.episodeId === 'string' && state.episodeId.length > 0 && state.episodeId.length <= 512) || !Array.isArray(state.participants) || state.participants.length > 64 || state.participants.some(id => !integer(id))) || name === 'rendezvous' && (!Number.isFinite(state.start) || !Array.isArray(state.arrivals) || state.arrivals.length > 64) || name === 'cooldowns' && !integer(state.until) || name === 'coordinates' && (!integer(state.actorId) || !finite(state.sPixels, 1e9))) throw new Error('Invalid encounter checkpoint state.'); } next[name] = new Map(copy(entries)); }
      for (const [key, state] of next.rendezvous) if (key !== state.definitionId || !integer(state.overflow) || state.arrivals.some(arrival => !plain(arrival) || !integer(arrival.actorId) || !Number.isFinite(arrival.time) || arrival.time < state.start || arrival.time > state.start + definitions.find(value => value.id === state.definitionId).groupingToleranceTicks || !plain(arrival.fact) || !integer(arrival.fact.causalSequence) || !Array.isArray(arrival.fact.sourceEventIds) || !arrival.fact.sourceEventIds.length || arrival.fact.sourceEventIds.length > 64 || arrival.fact.sourceEventIds.some(id => !identity(id))) || new Set(state.arrivals.map(value => value.actorId)).size !== state.arrivals.length) throw new Error('Invalid rendezvous checkpoint arrivals.');
      for (const [key, state] of next.episodes) if (typeof key !== 'string' || key.length > 512 || !integer(state.tick) || state.tick > value.lastTick || typeof state.dense !== 'boolean' || new Set(state.participants).size !== state.participants.length || state.participants.length < 2) throw new Error('Invalid encounter episode checkpoint.');
      for (const [key, state] of next.coordinates) if (typeof key !== 'string' || key.length > 512 || !identity(state.branchId) || !integer(state.tick) || state.tick > value.lastTick) throw new Error('Invalid route encounter checkpoint.');
      episodes = next.episodes; cooldowns = next.cooldowns; rendezvous = next.rendezvous; pitchMemory = next.pitchMemory; coordinates = next.coordinates; boundary = value.boundary; serial = value.serial; lastTick = value.lastTick;
    }, reset() { episodes.clear(); cooldowns.clear(); rendezvous.clear(); pitchMemory.clear(); coordinates.clear(); boundary = null; lastTick = -1; lastFacts = []; diagnostics = []; },
    diagnostics: () => freeze({ definitions: definitions.length, geometry: definitions.map(value => ({ id: value.id, revision: value.revision, region: value.region, participants: value.participants, distanceMetric: value.distanceMetric, enterRadius: value.enterRadius, exitRadius: value.exitRadius, groupingToleranceTicks: value.groupingToleranceTicks })), episodes: episodes.size, rendezvous: rendezvous.size, pitchMemory: pitchMemory.size, diagnostics: copy(diagnostics), diagnosticOverflow, facts: copy(lastFacts) }) };
}
