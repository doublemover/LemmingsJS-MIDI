import { plain, identity, finite, integer, point, bounds, boundedList, freeze, copy } from './PhysicalSchema.js';

const EPS = 1e-9, cross = (ax, ay, bx, by) => ax * by - ay * bx;
const inside = (p, b) => p.x >= b.x1 && p.x < b.x2 && p.y >= b.y1 && p.y < b.y2;
export function validatePickupGate(input) {
  if (!plain(input) || !identity(input.id) || !integer(input.revision ?? 0) || input.worldAnchor != null && input.worldAnchor !== 'world') throw new Error('A pickup needs a stable ID, revision and world anchor.');
  const geometry = input.geometry;
  if (!plain(geometry) || !['segment', 'polyline', 'band'].includes(geometry.kind)) throw new Error('Choose segment, polyline or rectangular band geometry.');
  let shape;
  if (geometry.kind === 'band') shape = { kind: 'band', bounds: bounds(geometry.bounds) };
  else {
    const points = boundedList(geometry.points, 65, point, 'pickup vertices');
    if (points.length < 2 || geometry.kind === 'segment' && points.length !== 2 || points.some((p, i) => i && Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) < 0.001)) throw new Error('Pickup edges must be at least 0.001 pixels long.');
    shape = { kind: geometry.kind, points };
  }
  const laneScope = input.laneScope == null ? null : boundedList(input.laneScope, 1024, value => { if (!integer(value, 1023)) throw new Error('Invalid pickup lane scope.'); return value; }, 'pickup lanes');
  const trigger = input.trigger ?? 'cross', directionPolicy = input.directionPolicy ?? 'either', hysteresis = input.hysteresis ?? 0;
  if (!['cross', 'enter', 'exit', 'occupancy'].includes(trigger) || shape.kind !== 'band' && trigger !== 'cross' ||
      !['either', 'positive', 'negative', 'alternating'].includes(directionPolicy) || !finite(hysteresis, 32) || hysteresis < 0) throw new Error('Invalid pickup trigger, direction or hysteresis.');
  const pitch = input.pitchMap ?? { mode: 'fixed', baseCents: 6900 };
  if (!plain(pitch) || !['fixed', 'local-linear', 'strings'].includes(pitch.mode) || !finite(pitch.baseCents, 24000) ||
      !finite(pitch.spanCents ?? 0, 24000) || Math.abs(pitch.baseCents + (pitch.spanCents ?? 0)) > 24000 || !integer(pitch.strings ?? 1, 128) || (pitch.strings ?? 1) < 1) throw new Error('Invalid gate-local pitch map.');
  if (input.ensembleId != null && !identity(input.ensembleId)) throw new Error('Invalid pickup ensemble reference.');
  return freeze({ id: input.id, revision: input.revision ?? 0, worldAnchor: 'world', geometry: shape, laneScope,
    trigger, directionPolicy, hysteresis, bypass: input.bypass === true, ensembleId: input.ensembleId ?? null,
    retriggerOnEdit: input.retriggerOnEdit === true, pitchMap: { mode: pitch.mode, baseCents: pitch.baseCents,
      spanCents: pitch.spanCents ?? 0, strings: pitch.strings ?? 1 }, voicePolicy: trigger === 'occupancy' ? 'hold-until-exit' : 'one-shot' });
}
export const pickupBounds = gate => gate.geometry.kind === 'band' ? gate.geometry.bounds : {
  x1: Math.min(...gate.geometry.points.map(p => p.x)), x2: Math.max(...gate.geometry.points.map(p => p.x)),
  y1: Math.min(...gate.geometry.points.map(p => p.y)), y2: Math.max(...gate.geometry.points.map(p => p.y)) };
const edges = gate => gate.geometry.kind === 'band' ? (() => { const b = gate.geometry.bounds; return [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y1 }, { x: b.x2, y: b.y2 }, { x: b.x1, y: b.y2 }, { x: b.x1, y: b.y1 }]; })() : gate.geometry.points;
export function sweptPickupCrossings(gate, before, after) {
  if (![before?.x, before?.y, after?.x, after?.y].every(Number.isFinite)) return [];
  const dx = after.x - before.x, dy = after.y - before.y;
  if (!dx && !dy) return [];
  const points = edges(gate), lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y)), total = lengths.reduce((a, b) => a + b, 0), hits = [];
  let offset = 0;
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i], b = points[i + 1], ex = b.x - a.x, ey = b.y - a.y, denominator = cross(dx, dy, ex, ey);
    if (Math.abs(denominator) > EPS) {
      const t = cross(a.x - before.x, a.y - before.y, ex, ey) / denominator, u = cross(a.x - before.x, a.y - before.y, dx, dy) / denominator;
      // Arrival owns a boundary, departure does not. Collinear travel is silent.
      if (t > EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) hits.push({ fraction: Math.min(1, t),
        local01: (offset + Math.max(0, Math.min(1, u)) * lengths[i]) / total,
        direction: denominator > 0 ? 'positive' : 'negative', edge: i });
    }
    offset += lengths[i];
  }
  hits.sort((a, b) => a.fraction - b.fraction || a.edge - b.edge);
  const unique = hits.filter((hit, i) => !i || Math.abs(hit.fraction - hits[i - 1].fraction) > EPS);
  if (gate.geometry.kind !== 'band') return unique.map(hit => ({ ...hit, transition: 'cross' }));
  return unique.flatMap((hit, i) => {
    const previous = i ? unique[i - 1].fraction : 0, next = i + 1 < unique.length ? unique[i + 1].fraction : 1;
    const left = Math.max(0, hit.fraction - Math.min(1e-6, (hit.fraction - previous) / 2));
    const right = hit.fraction + Math.min(1e-6, Math.max(EPS * 4, (next - hit.fraction) / 2));
    const a = inside({ x: before.x + dx * left, y: before.y + dy * left }, gate.geometry.bounds), b = inside({ x: before.x + dx * right, y: before.y + dy * right }, gate.geometry.bounds);
    return a === b ? [] : [{ ...hit, transition: b ? 'enter' : 'exit' }];
  });
}
const distanceToGate = (gate, p) => {
  let distance = Infinity; const points = edges(gate);
  for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy)); }
  return distance;
};
export function createPickupQueryPlan(gates, { chunkSize = 128, maxCells = 65536, maxQueryCells = 1024 } = {}) {
  const cells = new Map(), byId = new Map(); let entries = 0;
  for (const gate of gates) {
    if (byId.has(gate.id)) throw new Error('Duplicate pickup ID.'); byId.set(gate.id, gate);
    const b = pickupBounds(gate), x1 = Math.floor((b.x1 - gate.hysteresis) / chunkSize), x2 = Math.floor((b.x2 + gate.hysteresis) / chunkSize), y1 = Math.floor((b.y1 - gate.hysteresis) / chunkSize), y2 = Math.floor((b.y2 + gate.hysteresis) / chunkSize);
    const size = (x2 - x1 + 1) * (y2 - y1 + 1);
    if (size > 4096 || entries + size > maxCells) throw new Error('Pickup spatial index capacity exceeded; reduce gate extent.');
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) { const key = `${x}:${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(gate); entries++; }
  }
  return { byId, stats: () => ({ cells: cells.size, entries }), query(before, after, laneId) {
    const x1 = Math.floor(Math.min(before.x, after.x) / chunkSize), x2 = Math.floor(Math.max(before.x, after.x) / chunkSize), y1 = Math.floor(Math.min(before.y, after.y) / chunkSize), y2 = Math.floor(Math.max(before.y, after.y) / chunkSize);
    if (![x1, x2, y1, y2].every(Number.isSafeInteger) || (x2 - x1 + 1) * (y2 - y1 + 1) > maxQueryCells) return { status: 'unknown', reason: 'movement-query-capacity', gates: [] };
    const found = new Set();
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (const gate of cells.get(`${x}:${y}`) || []) if (!gate.bypass && (!gate.laneScope || gate.laneScope.includes(laneId))) found.add(gate);
    return { status: 'complete', gates: [...found].sort((a, b) => a.id.localeCompare(b.id)) };
  } };
}
export function createPickupGateObserver({ maxStates = 16384, maxObservations = 8192 } = {}) {
  let plan = createPickupQueryPlan([]), signatures = new Map(), boundary = null, incomplete = null, configured = false;
  const states = new Map(), recent = new Map();
  const key = (gate, actor) => `${gate}/${actor}`;
  const configure = gates => {
    const next = createPickupQueryPlan(gates), changed = new Set(gates.filter(g => signatures.get(g.id) !== JSON.stringify(g)).map(g => g.id));
    for (const id of signatures.keys()) if (!next.byId.has(id)) changed.add(id);
    if (!configured) changed.clear(); configured = true;
    const retired = [];
    for (const [id, state] of states) if (changed.has(state.gateId)) { if (state.sounding) retired.push({ ...state, reason: 'pickup-edited' }); states.delete(id); }
    plan = next; signatures = new Map(gates.map(g => [g.id, JSON.stringify(g)]));
    return { changed, retired };
  };
  const observe = (batch, membership = () => ({ status: 'complete', includes: true }), changed = new Set()) => {
    if (boundary !== `${batch.worldId}:${batch.generation}`) { states.clear(); recent.clear(); boundary = `${batch.worldId}:${batch.generation}`; }
    incomplete = null; const observations = [];
    const actors = new Map((batch.snapshot?.actors || []).map(actor => [actor.actorId, actor]));
    for (const [id, state] of states) if (batch.snapshot && !actors.has(state.actorId)) { if (state.sounding) observations.push({ occupancy: true, gateId: state.gateId, actorId: state.actorId, laneId: state.laneId, transition: 'exit', reason: 'actor-missing', fraction: 0, sourceEventIds: [], observationId: `${batch.batchId}:${id}:missing` }); states.delete(id); }
    // Editing onto an already-present actor establishes silent membership. No
    // swept path is synthesized between the old and new authored geometry.
    for (const actor of actors.values()) {
      const query = plan.query(actor, actor, actor.laneId);
      if (query.status !== 'complete') { incomplete = query.reason; continue; }
      for (const gate of query.gates) if (changed.has(gate.id) && gate.geometry.kind === 'band' && inside(actor, gate.geometry.bounds)) {
        if (states.size >= maxStates) { incomplete = 'pickup-state-capacity'; continue; }
        const sounding = gate.retriggerOnEdit && gate.trigger === 'occupancy';
        states.set(key(gate.id, actor.actorId), { gateId: gate.id, actorId: actor.actorId, laneId: actor.laneId, inside: true, sounding, armed: true, ordinal: sounding ? 1 : 0 });
        if (sounding && observations.length < maxObservations) observations.push({ gateId: gate.id, gateRevision: gate.revision, actorId: actor.actorId, laneId: actor.laneId, transition: 'enter', occupancy: true, fraction: 0, pitchCents: gate.pitchMap.baseCents, sourceEventIds: [], editRetrigger: true, observationId: `${batch.batchId}:pickup-edit:${gate.id}:${actor.actorId}`, reason: 'explicit-retrigger-on-edit' });
      }
    }
    for (const fact of batch.facts) if (fact.kind === 'MotionCommitted') {
      const query = plan.query(fact.positionBefore, fact.positionAfter, fact.laneId);
      if (query.status !== 'complete') { incomplete = query.reason; continue; }
      const crossed = [];
      for (const gate of query.gates) {
        const selected = membership(gate.ensembleId, fact.actorId);
        if (selected.status !== 'complete') { incomplete = 'ensemble-coverage-unknown'; continue; }
        if (!selected.includes) continue;
        const id = key(gate.id, fact.actorId), held = states.get(id);
        if (!held && states.size >= maxStates) { incomplete = 'pickup-state-capacity'; continue; }
        const state = held || { gateId: gate.id, actorId: fact.actorId, laneId: fact.laneId, inside: gate.geometry.kind === 'band' && inside(fact.positionBefore, gate.geometry.bounds), sounding: false, armed: true, ordinal: 0 };
        states.set(id, state);
        if (!state.armed && distanceToGate(gate, fact.positionBefore) > gate.hysteresis) state.armed = true;
        for (const hit of sweptPickupCrossings(gate, fact.positionBefore, fact.positionAfter)) {
          const exit = hit.transition === 'exit', allowedDirection = gate.directionPolicy === 'either' || gate.directionPolicy === 'alternating' || gate.directionPolicy === hit.direction;
          const lifecycleExit = gate.trigger === 'occupancy' && exit && state.sounding;
          if (hit.transition !== 'cross') state.inside = !exit;
          if (!lifecycleExit && (!state.armed || !allowedDirection || changed.has(gate.id) && !gate.retriggerOnEdit ||
              gate.trigger !== 'cross' && gate.trigger !== 'occupancy' && gate.trigger !== hit.transition || gate.trigger === 'occupancy' && exit)) continue;
          if (observations.length + crossed.length >= maxObservations) { incomplete = 'pickup-observation-capacity'; break; }
          state.ordinal++; state.armed = gate.hysteresis === 0 || gate.geometry.kind === 'band';
          if (gate.trigger === 'occupancy') state.sounding = !exit;
          const local = gate.pitchMap.mode === 'strings' ? Math.round(hit.local01 * (gate.pitchMap.strings - 1)) / Math.max(1, gate.pitchMap.strings - 1) : hit.local01;
          crossed.push({ ...hit, gateId: gate.id, gateRevision: gate.revision, actorId: fact.actorId, laneId: fact.laneId,
            actionInstanceId: fact.actionInstanceId, ordinal: state.ordinal, occupancy: gate.trigger === 'occupancy',
            polarity: gate.directionPolicy === 'alternating' && state.ordinal % 2 === 0 ? -1 : 1,
            pitchCents: gate.pitchMap.baseCents + (gate.pitchMap.mode === 'fixed' ? 0 : local * gate.pitchMap.spanCents),
            precision: 'derived-endpoint-interpolation', sourceEventIds: [fact.eventId], causalSequence: fact.causalSequence,
            observationId: `${fact.eventId}:pickup:${gate.id}:${state.ordinal}` });
        }
      }
      crossed.sort((a, b) => a.fraction - b.fraction || a.gateId.localeCompare(b.gateId)); observations.push(...crossed);
    }
    for (const observation of observations) recent.set(observation.gateId, freeze({ ...observation, tick: batch.tick }));
    return freeze({ observations, completeness: incomplete ? { status: 'incomplete', reason: incomplete } : { status: 'complete' } });
  };
  return { configure, observe, reset() { states.clear(); recent.clear(); boundary = null; }, snapshot: () => freeze({ version: 1, boundary, states: [...states.values()].map(copy) }),
    restore(value) { if (value?.version !== 1 || value.boundary != null && typeof value.boundary !== 'string' || !Array.isArray(value.states) || value.states.length > maxStates) throw new Error('Invalid pickup checkpoint.');
      const next = new Map(); for (const state of value.states) { if (!plan.byId.has(state.gateId) || !integer(state.actorId) || !integer(state.ordinal) || typeof state.armed !== 'boolean' || typeof state.sounding !== 'boolean') throw new Error('Invalid pickup ownership.'); const id = key(state.gateId, state.actorId); if (next.has(id)) throw new Error('Duplicate pickup ownership.'); next.set(id, copy(state)); } states.clear(); for (const [id, state] of next) states.set(id, state); boundary = value.boundary; },
    diagnostics: () => freeze({ states: states.size, queryPlan: plan.stats(), completeness: incomplete, recent: [...recent.values()] }) };
}
