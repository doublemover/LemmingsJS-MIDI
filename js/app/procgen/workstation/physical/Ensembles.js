import { plain, identity, integer, bounds, actorKey, freeze, copy, boundedList } from './PhysicalSchema.js';

export function validateEnsembleDefinition(input) {
  if (!plain(input) || !identity(input.id) || !['fixedAtAdmission', 'dynamic'].includes(input.membershipMode) ||
      !integer(input.maximumMembers, 16384) || input.maximumMembers < 1 || !['allow', 'exclusive'].includes(input.overlapPolicy ?? 'allow')) throw new Error('Invalid ensemble identity, membership mode or capacity.');
  let nodes = 0, explicitIdentities = 0;
  const read = (value, depth = 0) => {
    if (!plain(value) || ++nodes > 64 || depth > 8) throw new Error('Ensemble selector complexity exceeded.');
    if (['union', 'intersection', 'difference'].includes(value.kind)) {
      if (!Array.isArray(value.selectors) || value.selectors.length < 2 || value.selectors.length > 8 || value.kind === 'difference' && value.selectors.length !== 2) throw new Error('Invalid ensemble set operator.');
      return { kind: value.kind, selectors: value.selectors.map(child => read(child, depth + 1)) };
    }
    if (value.kind === 'actors' && (explicitIdentities += value.identities?.length || 0) > 32768) throw new Error('Ensemble explicit identity capacity exceeded.');
    if (value.kind === 'actors') return { kind: value.kind, identities: boundedList(value.identities, 16384, entry => {
      if (!plain(entry) || !identity(entry.worldId) || !integer(entry.generation) || !integer(entry.actorId)) throw new Error('An explicit ensemble actor needs world, generation and actor identity.');
      return { worldId: entry.worldId, generation: entry.generation, actorId: entry.actorId }; }, 'ensemble actors') };
    if (['birthCohort', 'crewProject'].includes(value.kind) && identity(value.id)) return { kind: value.kind, id: value.id };
    if (value.kind === 'region') return { kind: value.kind, bounds: bounds(value.bounds) };
    if (value.kind === 'route' && identity(value.routeId) && (value.branchId == null || identity(value.branchId))) return { kind: value.kind, routeId: value.routeId, branchId: value.branchId ?? null };
    if (value.kind === 'action' && typeof value.action === 'string' && /^[A-Z][A-Z_-]{0,63}$/i.test(value.action)) return { kind: value.kind, action: value.action.toUpperCase() };
    if (value.kind === 'ability' && ['climb', 'parachute'].includes(value.ability)) return { kind: value.kind, ability: value.ability, enabled: value.enabled !== false };
    if (value.kind === 'lane' && integer(value.laneId, 1023)) return { kind: value.kind, laneId: value.laneId };
    throw new Error('Unknown or unqualified ensemble selector.');
  };
  const captureBoundary = input.captureBoundary ?? { mode: 'first-complete' };
  if (!plain(captureBoundary) || !['first-complete', 'tick', 'cohort-complete'].includes(captureBoundary.mode) ||
      captureBoundary.mode === 'tick' && (!integer(captureBoundary.tick) || !integer(captureBoundary.generation)) ||
      captureBoundary.mode === 'cohort-complete' && !identity(captureBoundary.cohortId)) throw new Error('Invalid ensemble capture boundary.');
  return freeze({ id: input.id, selector: read(input.selector), membershipMode: input.membershipMode, maximumMembers: input.maximumMembers,
    overlapPolicy: input.overlapPolicy ?? 'allow', captureBoundary: copy(captureBoundary), lifecycle: 'retain-fixed-roster-until-definition-replaced' });
}
const identitySets = new WeakMap();
const evaluate = (selector, actor, source, routeFor, budget) => {
  if (--budget.remaining < 0) return null;
  if (selector.selectors) {
    const values = selector.selectors.map(child => evaluate(child, actor, source, routeFor, budget));
    if (selector.kind === 'union') return values.includes(true) ? true : values.includes(null) ? null : false;
    if (selector.kind === 'intersection') return values.includes(false) ? false : values.includes(null) ? null : true;
    return values[0] === false || values[1] === true ? false : values.includes(null) ? null : true;
  }
  if (selector.kind === 'actors') { let keys = identitySets.get(selector); if (!keys) { keys = new Set(selector.identities.map(id => actorKey(id.worldId, id.generation, id.actorId))); identitySets.set(selector, keys); } return keys.has(actorKey(source.worldId, source.generation, actor.actorId)); }
  if (selector.kind === 'birthCohort') return actor.birthCohortId == null ? null : actor.birthCohortId === selector.id;
  if (selector.kind === 'crewProject') return Array.isArray(actor.crewOriginIds) && actor.crewOriginComplete !== false ? actor.crewOriginIds.includes(selector.id) : null;
  if (selector.kind === 'region') { const b = selector.bounds; return actor.x >= b.x1 && actor.x < b.x2 && actor.y >= b.y1 && actor.y < b.y2; }
  if (selector.kind === 'route') { const route = routeFor(actor.actorId, selector.routeId); return route?.status === 'qualified' ? !selector.branchId || route.branchId === selector.branchId : null; }
  if (selector.kind === 'action') return typeof actor.action === 'string' ? actor.action.toUpperCase() === selector.action : null;
  if (selector.kind === 'ability') return typeof actor.abilities?.[selector.ability] === 'boolean' ? actor.abilities[selector.ability] === selector.enabled : null;
  if (selector.kind === 'lane') return actor.laneId === selector.laneId;
  return null;
};
export function createEnsembleResolver({ maxDefinitions = 128, maxMemberships = 32768 } = {}) {
  let definitions = [], views = new Map(), signatures = new Map(), revision = 0;
  const rosters = new Map();
  const configure = values => {
    if (!Array.isArray(values) || values.length > maxDefinitions) throw new Error('Ensemble definition capacity exceeded.');
    const next = values.map(validateEnsembleDefinition), ids = new Set();
    for (const definition of next) { if (ids.has(definition.id)) throw new Error('Duplicate ensemble ID.'); ids.add(definition.id); }
    for (const id of rosters.keys()) if (!ids.has(id) || signatures.get(id) !== JSON.stringify(next.find(definition => definition.id === id))) rosters.delete(id);
    definitions = next; signatures = new Map(next.map(definition => [definition.id, JSON.stringify(definition)]));
  };
  const observe = (batch, routeFor = () => null) => {
    const snapshot = batch.snapshot, valid = snapshot && snapshot.tick === batch.tick && snapshot.generation === batch.generation && batch.completeness?.status === 'complete';
    const actors = valid ? snapshot.actors : [], lookup = new Map(actors.map(actor => [actorKey(batch.worldId, batch.generation, actor.actorId), actor]));
    const proposals = new Map(), owners = new Map(), budget = { remaining: 262144 }; let allocated = 0;
    for (const definition of definitions) {
      const previous = views.get(definition.id), oldRoster = rosters.get(definition.id);
      let status = valid ? 'complete' : 'unknown', reason = valid ? null : 'completed-source-unavailable', roster = oldRoster;
      const boundary = definition.captureBoundary, eligible = boundary.mode === 'first-complete' || boundary.mode === 'tick' && batch.tick === boundary.tick && batch.generation === boundary.generation ||
        boundary.mode === 'cohort-complete' && snapshot?.cohorts?.some(cohort => cohort.id === boundary.cohortId && cohort.status === 'complete');
      if (!roster || definition.membershipMode === 'dynamic') {
        const matches = [], unknown = [];
        for (const actor of actors) { const result = evaluate(definition.selector, actor, batch, routeFor, budget); if (result === true) matches.push(actor); else if (result === null) unknown.push(actor.actorId); }
        if (unknown.length) { status = 'unknown'; reason = budget.remaining < 0 ? 'selector-work-capacity' : 'selector-evidence-unavailable'; }
        if (matches.length > definition.maximumMembers || allocated + matches.length > maxMemberships) { status = 'capped'; reason = 'membership-capacity'; roster = []; }
        else if (definition.membershipMode === 'fixedAtAdmission' && !eligible) { status = 'pending'; reason = 'capture-boundary-not-observed'; roster = []; }
        else roster = matches.map(actor => ({ key: actorKey(batch.worldId, batch.generation, actor.actorId), worldId: batch.worldId, generation: batch.generation,
          actorId: actor.actorId, admittedTick: batch.tick, birthCohortId: actor.birthCohortId ?? null, birthLaneId: actor.spawnLaneIndex ?? null, crewOriginIds: actor.crewOriginIds || [] })).sort((a, b) => a.actorId - b.actorId);
        if (status !== 'complete') roster = [];
        if (definition.membershipMode === 'fixedAtAdmission' && status === 'complete') rosters.set(definition.id, roster);
      }
      allocated += roster.length;
      const members = roster.map(member => { const current = lookup.get(member.key); return { ...member, active: !!current, laneId: current?.laneId ?? null,
        reason: current ? 'present' : batch.worldId !== member.worldId || batch.generation !== member.generation ? 'source-identity-changed' : 'missing-or-terminated' }; });
      for (const member of members) if (member.active) { if (!owners.has(member.key)) owners.set(member.key, []); owners.get(member.key).push(definition); }
      proposals.set(definition.id, { definition, previous, members, status, reason });
    }
    const next = new Map();
    for (const [id, proposal] of proposals) {
      const { definition, previous, members } = proposal; let { status, reason } = proposal;
      if (members.some(member => member.active && owners.get(member.key).length > 1 && owners.get(member.key).some(owner => owner.overlapPolicy === 'exclusive'))) { status = 'conflict'; reason = 'exclusive-ensemble-overlap'; }
      const old = new Map((previous?.members || []).map(member => [member.key, member])), current = new Map(members.map(member => [member.key, member]));
      const entered = members.filter(member => member.active && !old.get(member.key)?.active).map(member => ({ key: member.key, actorId: member.actorId, reason: old.has(member.key) ? 'resolved-existing-identity' : definition.membershipMode === 'fixedAtAdmission' ? 'captured-admission' : 'selector-entered' }));
      const left = [...old.values()].filter(member => member.active && !current.get(member.key)?.active).map(member => ({ key: member.key, actorId: member.actorId, reason: !lookup.has(member.key) ? 'missing-or-terminated' : 'selector-disqualified' }));
      next.set(id, freeze({ id, revision: ++revision, sourceRevision: snapshot?.revision ?? null, batchId: batch.batchId, worldId: batch.worldId, generation: batch.generation,
        tick: batch.tick, membershipMode: definition.membershipMode, completeness: { status, reason }, members, memberIds: status === 'complete' ? members.filter(member => member.active).map(member => member.actorId) : [], entered, left }));
    }
    views = next; return Object.freeze([...views.values()]);
  };
  return { configure, observe, view: id => views.get(id) ?? null,
    membership(id, actorId) { if (id == null) return { status: 'complete', includes: true }; const view = views.get(id); return { status: view?.completeness.status ?? 'unknown', includes: view?.memberIds.includes(actorId) ?? false }; },
    snapshot: () => freeze({ version: 1, revision, definitions: definitions.map(copy), rosters: [...rosters].map(([id, members]) => ({ id, members: copy(members) })) }),
    restore(value) { if (value?.version !== 1 || !integer(value.revision) || !Array.isArray(value.rosters) || value.rosters.length > maxDefinitions || JSON.stringify(value.definitions) !== JSON.stringify(definitions)) throw new Error('Incompatible ensemble checkpoint.');
      const next = new Map(); let count = 0; for (const roster of value.rosters) { const definition = definitions.find(entry => entry.id === roster.id);
        if (!definition || definition.membershipMode !== 'fixedAtAdmission' || next.has(roster.id) || !Array.isArray(roster.members) || roster.members.length > definition.maximumMembers || (count += roster.members.length) > maxMemberships) throw new Error('Invalid fixed roster.');
        const keys = new Set(); for (const member of roster.members) { if (!identity(member.worldId) || !integer(member.generation) || !integer(member.actorId) || !integer(member.admittedTick) || member.key !== actorKey(member.worldId, member.generation, member.actorId) || keys.has(member.key)) throw new Error('Invalid fixed member identity.'); keys.add(member.key); }
        next.set(roster.id, copy(roster.members)); }
      rosters.clear(); for (const [id, members] of next) rosters.set(id, members); revision = value.revision; views.clear(); },
    resetDynamic() { views.clear(); }, diagnostics: () => ({ definitions: definitions.length, fixedRosters: rosters.size, memberships: [...views.values()].reduce((count, view) => count + view.members.length, 0) }) };
}
