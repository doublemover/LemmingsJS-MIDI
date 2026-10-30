import { plain, identity, finite, integer, freeze, copy } from './PhysicalSchema.js';
import { validatePhysicalTuning, tuningDegree } from './Tuning.js';

export function validateFormationHarmony(value) {
  if (!plain(value) || !identity(value.id) || !integer(value.revision) || !identity(value.ensembleId) ||
      !['laneX', 'routeDistance', '2DNeighborhood'].includes(value.metric) || value.metric === 'routeDistance' && !identity(value.routeId) ||
      !['ordered-spacing', 'clustered-chord'].includes(value.mapping ?? 'ordered-spacing') ||
      !['follow-formation', 'freeze-voicing'].includes(value.policy ?? 'follow-formation') ||
      !integer(value.maximumVoices ?? 16, 32) || !(value.maximumVoices ?? 16) ||
      !finite(value.spacingPixels ?? 16, 10000) || (value.spacingPixels ?? 16) <= 0 || !integer(value.degreeStep ?? 2, 32) ||
      !finite(value.hysteresisPixels ?? 2, 128) || (value.hysteresisPixels ?? 2) < 0 || !finite(value.slewSeconds ?? 0.05, 4) || (value.slewSeconds ?? 0.05) < 0) throw new Error('Invalid bounded formation harmony.');
  const register = value.register ?? { minCents: 2400, maxCents: 9600 }, rootPolicy = value.rootPolicy ?? 'anchor';
  if (!plain(register) || !finite(register.minCents, 24000) || !finite(register.maxCents, 24000) || register.maxCents < register.minCents || !['anchor', 'field'].includes(rootPolicy)) throw new Error('Invalid formation register/root.');
  return freeze({ id: value.id, revision: value.revision, ensembleId: value.ensembleId, metric: value.metric, routeId: value.routeId ?? null,
    mapping: value.mapping ?? 'ordered-spacing', policy: value.policy ?? 'follow-formation', maximumVoices: value.maximumVoices ?? 16,
    spacingPixels: value.spacingPixels ?? 16, degreeStep: value.degreeStep ?? 2, hysteresisPixels: value.hysteresisPixels ?? 2,
    slewSeconds: value.slewSeconds ?? 0.05, register: { ...register }, rootPolicy, tuning: validatePhysicalTuning(value.tuning) });
}
// Exact rectangular assignment is bounded to 32 representatives, never the full crowd.
export function minimumMotionAssignment(costs) {
  const n = costs.length;
  if (!n || n > 32 || costs.some(row => row.length !== n || row.some(value => !finite(value, 100000)))) throw new Error('Invalid formation assignment matrix.');
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0; const minimum = new Float64Array(n + 1).fill(Infinity), used = new Uint8Array(n + 1);
    do {
      used[j0] = 1; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const current = costs[i0 - 1][j - 1] - u[i0] - v[j];
        if (current < minimum[j]) { minimum[j] = current; way[j] = j0; }
        if (minimum[j] < delta) { delta = minimum[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minimum[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const result = new Array(n); for (let j = 1; j <= n; j++) result[p[j] - 1] = j - 1; return result;
}

export function createFormationHarmony({ maxStates = 4096, maxDescriptorWork = 262144 } = {}) {
  let definitions = [], states = new Map(), views = new Map(), boundary = null;
  const configure = next => { for (const definition of next) { const old = definitions.find(value => value.id === definition.id); if (old && JSON.stringify(old) !== JSON.stringify(definition) && definition.revision <= old.revision) throw new Error('Changed formations require a newer revision.'); } const previous = new Map(definitions.map(value => [value.id, JSON.stringify(value)])); definitions = next;
    for (const id of states.keys()) if (!next.some(value => value.id === id && JSON.stringify(value) === previous.get(id))) states.delete(id); };
  const observe = (batch, domain, fields) => {
    if (boundary !== `${batch.worldId}/${batch.generation}`) { states.clear(); boundary = `${batch.worldId}/${batch.generation}`; }
    views = new Map(); if (!definitions.length) return;
    const actors = batch.snapshot?.actors; if (!Array.isArray(actors) || actors.length > 32768) throw new Error('Formation requires a complete actor projection.');
    const actorMap = new Map(actors.map(actor => [actor.actorId, actor])); let work = 0, count = 0;
    for (const definition of definitions) {
      const membership = domain.ensembleView(definition.ensembleId);
      const neighborhood = definition.metric === '2DNeighborhood', coordinateMetric = neighborhood ? 'centroid-radius-pixels' : definition.metric === 'routeDistance' ? 'qualified-route-arc-pixels' : 'world-x-pixels';
      const source = { id: definition.id, revision: definition.revision, metric: definition.metric, coordinateMetric, routeId: definition.routeId, ensembleId: definition.ensembleId, membershipRevision: membership?.revision ?? null };
      if (membership?.completeness.status !== 'complete') { views.set(definition.id, freeze({ ...source, status: 'unknown', reason: 'ensemble-incomplete' })); continue; }
      const members = []; let x = 0, y = 0, unknown = null, branch = null;
      for (const id of membership.memberIds) {
        if (++work > maxDescriptorWork) throw new Error('Formation descriptor budget exceeded.');
        const actor = actorMap.get(id); if (!actor) { unknown = 'actor-projection-missing'; break; }
        let coordinate = actor.x;
        if (definition.metric === 'routeDistance') {
          const route = domain.routeCoordinate(id, definition.routeId);
          if (route?.status !== 'qualified' || branch != null && branch !== route.branchId) { unknown = 'route-coordinate-unqualified'; break; }
          coordinate = route.sPixels; branch = route.branchId;
        }
        members.push({ actorId: id, x: actor.x, y: actor.y, coordinate }); x += actor.x; y += actor.y;
      }
      if (unknown) { views.set(definition.id, freeze({ ...source, status: 'unknown', reason: unknown })); continue; }
      const centroid = { x: members.length ? x / members.length : 0, y: members.length ? y / members.length : 0 };
      if (definition.metric === '2DNeighborhood') for (const member of members) member.coordinate = Math.hypot(member.x - centroid.x, member.y - centroid.y);
      members.sort((a, b) => a.coordinate - b.coordinate || a.actorId - b.actorId);
      const mean = members.reduce((sum, member) => sum + member.coordinate, 0) / Math.max(1, members.length), dispersion = Math.sqrt(members.reduce((sum, member) => sum + (neighborhood ? member.coordinate ** 2 : (member.coordinate - mean) ** 2), 0) / Math.max(1, members.length));
      const previous = states.get(definition.id) || { assignments: [], spreadTier: 0 }, prior = new Map(previous.assignments.map(value => [value.actorId, value]));
      // Keep admitted actors while alive; fill remaining slots by evenly spaced physical rank.
      const selected = members.filter(member => prior.has(member.actorId)).slice(0, definition.maximumVoices), chosen = new Set(selected.map(member => member.actorId));
      const slots = Math.min(definition.maximumVoices, members.length) - selected.length;
      for (let slot = 0; slot < slots; slot++) {
        const target = slots === 1 ? Math.floor(members.length / 2) : Math.round(slot * (members.length - 1) / (slots - 1));
        for (let delta = 0; delta < members.length; delta++) { const candidate = members[(target + delta) % members.length]; if (!chosen.has(candidate.actorId)) { selected.push(candidate); chosen.add(candidate.actorId); break; } }
      }
      selected.sort((a, b) => a.coordinate - b.coordinate || a.actorId - b.actorId);
      let neighborRelations = selected.slice(1).map((member, index) => ({ beforeActorId: selected[index].actorId, afterActorId: member.actorId, distance: member.coordinate - selected[index].coordinate }));
      if (neighborhood) {
        const edges = new Map();
        for (const member of selected) {
          let nearest = null, distance = Infinity;
          for (const other of selected) if (other.actorId !== member.actorId) {
            if (++work > maxDescriptorWork) throw new Error('Formation descriptor budget exceeded.');
            const candidate = Math.hypot(member.x - other.x, member.y - other.y);
            if (candidate < distance || candidate === distance && other.actorId < nearest.actorId) { nearest = other; distance = candidate; }
          }
          if (nearest) { const beforeActorId = Math.min(member.actorId, nearest.actorId), afterActorId = Math.max(member.actorId, nearest.actorId); edges.set(`${beforeActorId}/${afterActorId}`, { beforeActorId, afterActorId, distance }); }
        }
        neighborRelations = [...edges.values()].sort((a, b) => a.beforeActorId - b.beforeActorId || a.afterActorId - b.afterActorId);
      }
      let spreadTier = previous.spreadTier;
      while (dispersion >= (spreadTier + 1) * definition.spacingPixels + definition.hysteresisPixels && spreadTier < 32) spreadTier++;
      while (spreadTier > 0 && dispersion < spreadTier * definition.spacingPixels - definition.hysteresisPixels) spreadTier--;
      const candidates = selected.map((_, index) => {
        const degree = index * definition.degreeStep + (definition.mapping === 'ordered-spacing' ? index * spreadTier : Math.floor(index / 3) * spreadTier * definition.tuning.cents.length);
        const indexInPeriod = degree % definition.tuning.cents.length, offset = definition.tuning.referenceCents + definition.tuning.cents[indexInPeriod];
        const minimumPeriod = Math.ceil((definition.register.minCents - offset) / definition.tuning.periodCents), maximumPeriod = Math.floor((definition.register.maxCents - offset) / definition.tuning.periodCents);
        if (maximumPeriod < minimumPeriod) throw new Error('Formation tuning cannot fit its declared register.');
        const period = Math.max(minimumPeriod, Math.min(maximumPeriod, Math.floor(degree / definition.tuning.cents.length)));
        return tuningDegree(definition.tuning, period * definition.tuning.cents.length + indexInPeriod);
      });
      const matrix = selected.map((actor, index) => candidates.map(pitch => Math.abs(pitch.cents - (prior.get(actor.actorId)?.pitch.cents ?? candidates[index].cents))));
      const matching = selected.length ? minimumMotionAssignment(matrix) : [], assignments = selected.map((actor, index) => {
        let pitch = definition.policy === 'freeze-voicing' && prior.has(actor.actorId) ? prior.get(actor.actorId).pitch : candidates[matching[index]];
        if (definition.rootPolicy === 'field' && !(definition.policy === 'freeze-voicing' && prior.has(actor.actorId))) { const field = fields.view(actor.actorId); if (field?.status !== 'complete' || !field.field) return { actorId: actor.actorId, status: 'unknown', reason: 'field-root-unavailable' };
          pitch = tuningDegree(field.field.tuning, pitch.degree); }
        return { actorId: actor.actorId, status: 'complete', pitch, reason: definition.policy === 'freeze-voicing' && prior.has(actor.actorId) ? 'frozen-voicing' : 'observed-formation', coordinate: actor.coordinate };
      });
      if ((count += assignments.length) > maxStates) throw new Error('Formation assignment capacity exceeded.');
      states.set(definition.id, { assignments: assignments.filter(value => value.status === 'complete'), spreadTier });
      views.set(definition.id, freeze({ ...source, status: 'complete',
        memberCount: members.length, representativeCount: selected.length, aggregated: members.length - selected.length, centroid, dispersion, spreadTier, assignments,
        neighborMetric: neighborhood ? 'euclidean-pixels' : coordinateMetric, neighborPolicy: neighborhood ? 'nearest-selected-representative' : 'ordered-selected', neighborRelations }));
    }
  };
  return { configure, observe, definition: id => definitions.find(value => value.id === id),
    pitch(id, actorId) { const view = views.get(id); if (view?.status !== 'complete') return { status: 'unknown', reason: view?.reason || 'formation-unobserved' }; return view.assignments.find(value => value.actorId === actorId) || { status: 'unrepresented', reason: 'bounded-formation-representatives' }; },
    snapshot: () => freeze({ version: 2, boundary, signatures: definitions.map(value => [value.id, JSON.stringify(value)]), states: [...states].map(([id, state]) => ({ id, ...copy(state) })) }),
    restore(value) { const emptyLegacy = value?.version === 1 && Array.isArray(value.states) && value.states.length === 0;
      if (!emptyLegacy && (value?.version !== 2 || JSON.stringify(value.signatures) !== JSON.stringify(definitions.map(value => [value.id, JSON.stringify(value)]))) || !Array.isArray(value.states) || value.states.length > definitions.length || value.boundary != null && typeof value.boundary !== 'string') throw new Error('Invalid or unbound formation checkpoint.'); const next = new Map(); let count = 0;
      for (const state of value.states) { const definition = definitions.find(item => item.id === state.id); if (!definition || next.has(state.id) || !integer(state.spreadTier, 32) || !Array.isArray(state.assignments) || state.assignments.length > definition.maximumVoices || (count += state.assignments.length) > maxStates) throw new Error('Invalid formation assignment checkpoint.');
        const seen = new Set(); for (const value of state.assignments) { if (!integer(value.actorId) || seen.has(value.actorId) || value.status !== 'complete' || !finite(value.coordinate, Number.MAX_SAFE_INTEGER) || !['observed-formation', 'frozen-voicing'].includes(value.reason) || !finite(value.pitch?.cents, 24000) || !finite(value.pitch?.referenceHz, 20000) || value.pitch.referenceHz <= 0 || !Number.isSafeInteger(value.pitch?.degree) || Math.abs(value.pitch.degree) > 4096) throw new Error('Invalid saved harmonic voice.');
          if (definition.rootPolicy === 'anchor') { const expected = tuningDegree(definition.tuning, value.pitch.degree); if (['cents', 'referenceHz', 'tuningId', 'degree', 'period'].some(key => value.pitch[key] !== expected[key]) || JSON.stringify(value.pitch.ratio ?? null) !== JSON.stringify(expected.ratio ?? null)) throw new Error('Saved formation tuning differs from its bound definition.'); }
          seen.add(value.actorId); }
        next.set(state.id, { assignments: copy(state.assignments), spreadTier: state.spreadTier }); }
      states = next; boundary = value.boundary; views.clear(); },
    reset() { states.clear(); views.clear(); boundary = null; }, diagnostics: () => freeze({ formations: definitions.length, views: [...views.values()] }) };
}
