import { plain, identity, finite, integer, bounds, boundedList, freeze, copy } from './PhysicalSchema.js';
import { validatePhysicalTuning, nearestTuningPitch, tuningDegree } from './Tuning.js';
import { createPickupQueryPlan } from './PickupGates.js';

export function validateHarmonicField(value) {
  if (!plain(value) || !identity(value.id) || !integer(value.revision) || !Number.isSafeInteger(value.priority ?? 0) || Math.abs(value.priority ?? 0) > 10000) throw new Error('Invalid harmonic field.');
  const geometry = { kind: 'band', bounds: bounds(value.geometry?.bounds) }, boundary = value.boundary ?? 'hysteretic', width = value.width ?? 2;
  if (value.geometry?.kind !== 'band' || !['step', 'hysteretic', 'morph'].includes(boundary) || !finite(width, 128) || width < 0 || boundary === 'morph' && !width) throw new Error('Invalid harmonic field geometry or boundary.');
  const policy = value.heldPolicy ?? 'retain-onset', deletionPolicy = value.deletionPolicy ?? 'retain';
  if (!['retain-onset', 'retune-held', 'release-retrigger'].includes(policy) || !['retain', 'release', 'rebind'].includes(deletionPolicy)) throw new Error('Invalid field voice policy.');
  const coordinateMap = value.coordinateMap ?? { mode: 'nearest' };
  if (!plain(coordinateMap) || !['nearest', 'x-degrees', 'y-degrees', 'x-bend', 'y-bend'].includes(coordinateMap.mode) ||
      !finite(coordinateMap.origin ?? 0) || !finite(coordinateMap.pixelsPerDegree ?? 16, 10000) || (coordinateMap.pixelsPerDegree ?? 16) <= 0 ||
      !finite(coordinateMap.centsPerPixel ?? 1, 1000)) throw new Error('Invalid field coordinate map.');
  const laneScope = value.laneScope == null ? null : boundedList(value.laneScope, 1024, lane => { if (!integer(lane, 1023)) throw new Error('Invalid field lane.'); return lane; }, 'field lanes');
  if (value.ensembleId != null && !identity(value.ensembleId) || value.materialTag != null && !identity(value.materialTag)) throw new Error('Invalid field selector.');
  return freeze({ id: value.id, revision: value.revision, priority: value.priority ?? 0, geometry, boundary, width,
    hysteresis: boundary === 'hysteretic' ? width : 0, laneScope, ensembleId: value.ensembleId ?? null, materialTag: value.materialTag ?? null,
    heldPolicy: policy, deletionPolicy, tuning: validatePhysicalTuning(value.tuning), bypass: value.bypass === true,
    coordinateMap: { mode: coordinateMap.mode, origin: coordinateMap.origin ?? 0, pixelsPerDegree: coordinateMap.pixelsPerDegree ?? 16, centsPerPixel: coordinateMap.centsPerPixel ?? 1 },
    slewSeconds: value.slewSeconds == null ? 0.03 : finite(value.slewSeconds, 4) && value.slewSeconds >= 0 ? value.slewSeconds : (() => { throw new Error('Invalid field slew.'); })() });
}
const depth = (actor, b) => Math.min(actor.x - b.x1, b.x2 - actor.x, actor.y - b.y1, b.y2 - actor.y);
export function createHarmonicFieldResolver({ maxActors = 32768, maxQueries = 262144, getMaterialTag = () => ({ status: 'unknown' }) } = {}) {
  let fields = [], plan = createPickupQueryPlan([]), states = new Map(), views = new Map(), boundary = null, pendingEdit = null, lastRevision = null;
  const configure = (next, graphRevision, editCommandId = null) => {
    for (const field of next) { const prior = fields.find(value => value.id === field.id); if (prior && JSON.stringify(prior) !== JSON.stringify(field) && field.revision <= prior.revision) throw new Error('Changed harmonic fields require a newer revision.'); }
    const nextPlan = createPickupQueryPlan(next), changed = lastRevision !== null && JSON.stringify(next) !== JSON.stringify(fields);
    if (changed && next.some(field => field.heldPolicy === 'release-retrigger') && !identity(editCommandId)) throw new Error('Field retrigger edits need an applied mapping-edit command identity.');
    if (changed) pendingEdit = { graphRevision, commandId: editCommandId };
    for (const [id, state] of states) if (!next.some(field => field.id === state.fieldId && field.revision === state.fieldRevision)) states.delete(id);
    fields = next; plan = nextPlan; lastRevision = graphRevision;
  };
  const observe = (batch, domain) => {
    if (boundary !== `${batch.worldId}/${batch.generation}`) { states.clear(); boundary = `${batch.worldId}/${batch.generation}`; }
    views = new Map(); if (!fields.length && !states.size) return;
    const actors = batch.snapshot?.actors;
    if (!Array.isArray(actors) || actors.length > maxActors || batch.snapshot?.completeness?.status && batch.snapshot.completeness.status !== 'complete') throw new Error('Harmonic fields require a complete bounded actor projection.');
    const living = new Set(); let work = 0;
    for (const actor of actors) {
      living.add(actor.actorId); const prior = states.get(actor.actorId), query = plan.query(actor, actor, actor.laneId);
      if (query.status !== 'complete') throw new Error('Harmonic field spatial query is incomplete.');
      const candidates = [];
      for (const field of query.gates) {
        if (++work > maxQueries) throw new Error('Harmonic field query budget exceeded.');
        const member = domain.membership(field.ensembleId, actor.actorId); if (member.status !== 'complete') throw new Error('Harmonic field membership is unknown.');
        if (!member.includes) continue;
        if (field.materialTag) { const material = getMaterialTag(actor, batch); if (material.status !== 'complete') { views.set(actor.actorId, freeze({ status: 'unknown', reason: 'material-evidence-unavailable' })); continue; } if (material.tag !== field.materialTag) continue; }
        const distance = depth(actor, field.geometry.bounds), retained = prior?.fieldId === field.id && prior?.fieldRevision === field.revision;
        if (distance >= (retained ? -field.hysteresis : 0)) candidates.push({ field, distance });
      }
      candidates.sort((a, b) => b.field.priority - a.field.priority || a.field.id.localeCompare(b.field.id));
      const selected = candidates[0];
      if (!selected) { if (!views.has(actor.actorId)) views.set(actor.actorId, freeze({ status: 'complete', field: null, previousFieldId: prior?.fieldId ?? null, edit: pendingEdit })); states.delete(actor.actorId); continue; }
      if (views.get(actor.actorId)?.status === 'unknown') continue;
      const { field, distance } = selected;
      states.set(actor.actorId, { actorId: actor.actorId, fieldId: field.id, fieldRevision: field.revision });
      views.set(actor.actorId, freeze({ status: 'complete', field, actor: { x: actor.x, y: actor.y }, previousFieldId: prior?.fieldId ?? null,
        boundaryDistancePixels: distance, blend01: field.boundary === 'morph' ? Math.max(0, Math.min(1, distance / field.width)) : 1, edit: pendingEdit }));
    }
    for (const id of states.keys()) if (!living.has(id)) states.delete(id);
    pendingEdit = null;
  };
  const pitch = (actorId, baseCents) => {
    const view = views.get(actorId); if (!view || view.status !== 'complete' || !view.field) return { status: view?.status ?? 'complete', pitch: null, view };
    const field = view.field, map = field.coordinateMap, coordinate = map.mode.startsWith('x-') ? view.actor.x : view.actor.y;
    let result;
    if (map.mode.endsWith('-degrees')) result = tuningDegree(field.tuning, Math.floor((coordinate - map.origin) / map.pixelsPerDegree));
    else result = nearestTuningPitch(field.tuning, baseCents);
    if (map.mode.endsWith('-bend')) result = { ...result, cents: result.cents + (coordinate - map.origin) * map.centsPerPixel, continuousBendCents: (coordinate - map.origin) * map.centsPerPixel };
    const cents = baseCents + (result.cents - baseCents) * view.blend01; if (!finite(cents, 24000)) throw new Error('Field pitch exceeds semantic range.');
    return { status: 'complete', pitch: freeze({ ...result, cents, fieldId: field.id, fieldRevision: field.revision, blend01: view.blend01 }), view };
  };
  return { configure, observe, pitch, view: actorId => views.get(actorId) ?? null,
    snapshot: () => freeze({ version: 1, boundary, pendingEdit, states: [...states.values()].map(copy) }),
    restore(value) { if (value?.version !== 1 || !Array.isArray(value.states) || value.states.length > maxActors || value.boundary != null && typeof value.boundary !== 'string') throw new Error('Invalid field checkpoint.'); const next = new Map();
      for (const state of value.states) { if (!integer(state.actorId) || next.has(state.actorId) || !fields.some(field => field.id === state.fieldId && field.revision === state.fieldRevision)) throw new Error('Invalid field membership.'); next.set(state.actorId, { actorId: state.actorId, fieldId: state.fieldId, fieldRevision: state.fieldRevision }); }
      if (value.pendingEdit != null && (!plain(value.pendingEdit) || value.pendingEdit.graphRevision !== lastRevision || value.pendingEdit.commandId != null && !identity(value.pendingEdit.commandId))) throw new Error('Invalid pending field edit.');
      states = next; boundary = value.boundary; views.clear(); pendingEdit = value.pendingEdit ? { graphRevision: value.pendingEdit.graphRevision, commandId: value.pendingEdit.commandId } : null; },
    reset() { states.clear(); views.clear(); boundary = null; }, diagnostics: () => freeze({ fields: fields.length, memberships: states.size, views: [...views].map(([actorId, view]) => ({ actorId, ...view })) }) };
}
