import { createCausalPerformanceState } from './CausalPerformanceState.js';
import { freezeData } from '../../../core/CanonicalData.js';

const fail = () => { throw Object.assign(new Error('Captured lane routing is missing, malformed or outside covered history.'), { code: 'captured-lane-routing' }); };
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const row = value => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => ['id', 'sourceIndex'].includes(key)) && identifier(value.id) && Number.isSafeInteger(value.sourceIndex) && value.sourceIndex >= 0 && value.sourceIndex < 1024;
export function captureRevoiceLaneRouting(records, initial, covered) {
  if (!initial) return null;
  const state = createCausalPerformanceState(initial), initialLanes = state.snapshot().lanes.map(({ id, sourceIndex }) => ({ id, sourceIndex })), changes = [];
  let beforeIntent = 0, entries = initialLanes.length;
  for (const record of records) {
    if (record.kind === 'musical-intents') beforeIntent += record.payload.intents.length;
    else if (record.kind === 'input-observation' && record.payload?.kind === 'instrument-performance') {
      const previous = new Map(state.snapshot().lanes.map(lane => [lane.id, lane.sourceIndex]));
      const next = state.apply(record.payload.change), ids = new Set(next.lanes.map(lane => lane.id));
      const upserts = next.lanes.filter(lane => previous.get(lane.id) !== lane.sourceIndex).map(({ id, sourceIndex }) => ({ id, sourceIndex })), removed = [...previous.keys()].filter(id => !ids.has(id));
      if (!upserts.length && !removed.length) continue;
      entries += upserts.length + removed.length;
      if (entries > 65536 || changes.length >= 4096) fail();
      changes.push({ beforeIntent, upserts, removed });
    }
  }
  return freezeData({ schema: 'lemmings-captured-lane-routing/v1', covered: covered === true, initial: initialLanes, changes });
}
export function createCausalRenderLaneResolver(revoice) {
  const routing = revoice.laneRouting;
  if (routing == null) return intent => String(intent.laneId ?? 'unassigned');
  if (!routing || Object.getPrototypeOf(routing) !== Object.prototype || Object.keys(routing).some(key => !['schema', 'covered', 'initial', 'changes'].includes(key)) || routing.schema !== 'lemmings-captured-lane-routing/v1' || routing.covered !== true || !Array.isArray(routing.initial) || routing.initial.length > 1024 || !Array.isArray(routing.changes) || routing.changes.length > 4096) fail();
  const byId = new Map(), byIndex = new Map();
  const rebuild = () => { byIndex.clear(); for (const [id, index] of byId) { if (byIndex.has(index)) fail(); byIndex.set(index, id); } if ([...byIndex.keys()].some(index => index >= byIndex.size)) fail(); };
  for (const value of routing.initial) { if (!row(value) || byId.has(value.id)) fail(); byId.set(value.id, value.sourceIndex); } rebuild();
  let previous = 0, entries = routing.initial.length;
  for (const change of routing.changes) {
    if (!change || Object.getPrototypeOf(change) !== Object.prototype || Object.keys(change).some(key => !['beforeIntent', 'upserts', 'removed'].includes(key)) || !Number.isSafeInteger(change.beforeIntent) || change.beforeIntent < previous || change.beforeIntent > revoice.intents.length || !Array.isArray(change.upserts) || change.upserts.length > 1024 || change.upserts.some(value => !row(value)) || new Set(change.upserts.map(value => value.id)).size !== change.upserts.length || !Array.isArray(change.removed) || change.removed.length > 1024 || change.removed.some(value => !identifier(value)) || new Set(change.removed).size !== change.removed.length || change.removed.some(id => change.upserts.some(value => value.id === id))) fail();
    entries += change.upserts.length + change.removed.length; if (entries > 65536) fail(); previous = change.beforeIntent;
  }
  let cursor = 0, lastIndex = -1;
  return (intent, index) => {
    if (!Number.isSafeInteger(index) || index < lastIndex || index < 0 || index >= revoice.intents.length) fail(); lastIndex = index;
    while (cursor < routing.changes.length && routing.changes[cursor].beforeIntent <= index) {
      const change = routing.changes[cursor++]; for (const id of change.removed) { if (!byId.delete(id)) fail(); } for (const value of change.upserts) byId.set(value.id, value.sourceIndex); rebuild();
    }
    if (intent.laneId == null) return 'unassigned';
    const lane = typeof intent.laneId === 'number' ? byIndex.get(intent.laneId) : byId.has(intent.laneId) ? intent.laneId : null;
    if (lane == null) fail(); return lane;
  };
}
