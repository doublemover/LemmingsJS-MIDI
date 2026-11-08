import { procgenLaneCollectionChange } from './ProcgenProjectIndex.js';

const MAX_GROUPS = 128, MAX_PINS = 64, MAX_HISTORY = 32, HISTORY_BYTES = 256 * 1024;
const unique = (values, allowed, cap) => [...new Set((Array.isArray(values) ? values.slice(0, 2048) : []).filter(value => allowed.has(value)))].slice(0, cap);
const cleanName = value => String(value || '').trim().slice(0, 64);

export function createLaneNavigationMetadata({ getState = () => ({}), setState = () => {} } = {}) {
  let source = null, lanes = [], indices = new Map(), labels = new Map(), groupsByLane = new Map(), identity, initialized = false, disposed = false, revision = 0, groupSerial = 0;
  let cacheVisiblePositions = new Map(), cacheOrderPositions = new Map();
  const soloLaneIds = new Set();
  const stats = { fullBuilds: 0, incrementalUpdates: 0, rowVisits: 0, labelUpdates: 0 };
  let value = { version: 1, order: [], groups: [], collapsed: [], pinned: [] }, serialized = JSON.stringify(value), undo = [], redo = [], retainedBytes = 0, dropped = 0, cache = null;
  const normalize = data => {
    const ids = new Set(lanes.map(lane => lane.id)), claimed = new Set(), groupIds = new Set(), groups = [];
    for (const group of Array.isArray(data?.groups) ? data.groups.slice(0, MAX_GROUPS) : []) {
      const id = String(group?.id || '').slice(0, 64), name = cleanName(group?.name); if (!id || !name || groupIds.has(id)) continue; groupIds.add(id);
      const laneIds = unique(group.laneIds, ids, 1024).filter(id => !claimed.has(id)); for (const id of laneIds) claimed.add(id); groups.push({ id, name, laneIds });
    }
    const order = unique(data?.order, ids, 1024), retained = new Set(order); for (const lane of lanes) if (!retained.has(lane.id)) order.push(lane.id);
    return { version: 1, order, groups, collapsed: unique(data?.collapsed, groupIds, MAX_GROUPS), pinned: unique(data?.pinned, ids, MAX_PINS) };
  };
  const publish = next => {
    value = normalize(next); serialized = JSON.stringify(value); groupsByLane = new Map(); for (const group of value.groups) for (const id of group.laneIds) groupsByLane.set(id, group.id);
    revision++; cache = null; setState(value);
  };
  const trim = () => {
    retainedBytes = [...undo, ...redo].reduce((bytes, entry) => bytes + entry.length * 2, 0);
    while (undo.length + redo.length > MAX_HISTORY || retainedBytes > HISTORY_BYTES) {
      const removed = undo.length ? undo.shift() : redo.shift(); retainedBytes -= removed.length * 2; dropped++;
    }
  };
  const edit = transform => {
    if (disposed) return false;
    const draft = JSON.parse(serialized), accepted = transform(draft); if (accepted === false) return false;
    const next = normalize(draft); if (JSON.stringify(next) === serialized) return false;
    undo.push(serialized); redo = []; publish(next); trim(); return true;
  };
  return {
    sync(next, documentIdentity) {
      if (disposed || initialized && source === next && identity === documentIdentity) return revision;
      const change = initialized && identity === documentIdentity && source ? procgenLaneCollectionChange(source, next) : null;
      if (change && !change.structural && next.length === lanes.length && change.laneIds.every(id => !indices.has(id) || next[indices.get(id)]?.id === id)) {
        let labelsChanged = false;
        for (const id of change.laneIds) {
          const index = indices.get(id); if (index == null) continue; stats.rowVisits++;
          const previous = lanes[index], lane = next[index]; lanes[index] = lane;
          if (lane.solo) soloLaneIds.add(id); else soloLaneIds.delete(id);
          if (previous.name !== lane.name || previous.role !== lane.role) { labels.set(id, `${lane.name || ''} ${lane.role || ''} ${lane.id}`.toLocaleLowerCase()); labelsChanged = true; stats.labelUpdates++; }
          if (cache) {
            const visible = cacheVisiblePositions.get(id), ordered = cacheOrderPositions.get(id);
            if (visible != null) cache.lanes[visible] = lane; if (ordered != null) cache.ordered[ordered] = lane;
          }
        }
        source = next; stats.incrementalUpdates++; if (labelsChanged) { revision++; cache = null; } return revision;
      }
      if (next.length > 1024 || new Set(next.map(lane => lane.id)).size !== next.length) throw new Error('Invalid admitted lane identities.');
      const replacement = initialized && identity !== documentIdentity; source = next; lanes = next.slice(); indices = new Map(lanes.map((lane, index) => [lane.id, index])); stats.fullBuilds++; stats.rowVisits += lanes.length;
      soloLaneIds.clear(); for (const lane of lanes) if (lane.solo) soloLaneIds.add(lane.id);
      labels = new Map(lanes.map(lane => [lane.id, `${lane.name || ''} ${lane.role || ''} ${lane.id}`.toLocaleLowerCase()]));
      if (replacement) { undo = []; redo = []; retainedBytes = 0; dropped = 0; groupSerial = 0; }
      const incoming = getState(); publish(replacement ? incoming !== value ? incoming : {} : initialized ? value : incoming); identity = documentIdentity; initialized = true; return revision;
    },
    get revision() { return revision; },
    allLanes: () => lanes,
    soloLaneIds: () => soloLaneIds,
    diagnostics: () => ({ ...stats }),
    getState() { return { ...value, groups: value.groups.map(group => ({ ...group, laneIds: [...group.laneIds] })), order: [...value.order], collapsed: [...value.collapsed], pinned: [...value.pinned], undoCount: undo.length, redoCount: redo.length, retainedBytes, dropped }; },
    orderedLanes() { return value.order.map(id => lanes[indices.get(id)]); },
    visible(query = '') {
      const text = String(query).slice(0, 256).trim().toLocaleLowerCase(); if (cache?.revision === revision && cache.query === text) return cache;
      const terms = text.split(/\s+/).filter(Boolean), pinned = new Set(value.pinned), collapsed = new Set(value.collapsed), ordered = value.order.map(id => lanes[indices.get(id)]);
      const accepted = lane => terms.length ? terms.every(term => labels.get(lane.id).includes(term)) : pinned.has(lane.id) || !collapsed.has(groupsByLane.get(lane.id));
      const selected = ordered.filter(accepted), visible = [...selected.filter(lane => pinned.has(lane.id)), ...selected.filter(lane => !pinned.has(lane.id))];
      cacheVisiblePositions = new Map(visible.map((lane, index) => [lane.id, index])); cacheOrderPositions = new Map(ordered.map((lane, index) => [lane.id, index]));
      cache = { revision, query: text, lanes: visible, laneIndices: visible.map(lane => indices.get(lane.id)), ordered }; return cache;
    },
    groupFor(id) { return groupsByLane.get(id) || null; },
    createGroup(name) {
      let created = null;
      const accepted = edit(draft => { const text = cleanName(name); if (!text || draft.groups.length >= MAX_GROUPS) return false;
        do { created = 'lane-group-' + ++groupSerial; } while (draft.groups.some(group => group.id === created)); draft.groups.push({ id: created, name: text, laneIds: [] });
      }); return accepted ? created : null;
    },
    renameGroup(id, name) { return edit(draft => { const group = draft.groups.find(group => group.id === id), text = cleanName(name); if (!group || !text) return false; group.name = text; }); },
    removeGroup(id) { return edit(draft => { if (!draft.groups.some(group => group.id === id)) return false; draft.groups = draft.groups.filter(group => group.id !== id); draft.collapsed = draft.collapsed.filter(value => value !== id); }); },
    assign(id, groupId = null) { return edit(draft => {
      if (!indices.has(id) || groupId != null && !draft.groups.some(group => group.id === groupId)) return false;
      for (const group of draft.groups) { group.laneIds = group.laneIds.filter(value => value !== id); if (group.id === groupId) group.laneIds.push(id); }
    }); },
    toggleCollapsed(id) { return edit(draft => { if (!draft.groups.some(group => group.id === id)) return false; draft.collapsed = draft.collapsed.includes(id) ? draft.collapsed.filter(value => value !== id) : [...draft.collapsed, id]; }); },
    togglePinned(id) { return edit(draft => { if (!indices.has(id)) return false; if (draft.pinned.includes(id)) draft.pinned = draft.pinned.filter(value => value !== id); else { if (draft.pinned.length >= MAX_PINS) return false; draft.pinned.push(id); } }); },
    move(id, delta) { return edit(draft => { const from = draft.order.indexOf(id); if (from < 0 || !Number.isInteger(delta)) return false; const to = Math.max(0, Math.min(draft.order.length - 1, from + delta)); draft.order.splice(from, 1); draft.order.splice(to, 0, id); }); },
    reveal(id) { const group = groupsByLane.get(id); return group && value.collapsed.includes(group) ? edit(draft => { draft.collapsed = draft.collapsed.filter(value => value !== group); }) : false; },
    undo() { if (disposed || !undo.length) return false; redo.push(serialized); publish(JSON.parse(undo.pop())); trim(); return true; },
    redo() { if (disposed || !redo.length) return false; undo.push(serialized); publish(JSON.parse(redo.pop())); trim(); return true; },
    dispose() { disposed = true; source = null; lanes = []; indices.clear(); labels.clear(); groupsByLane.clear(); soloLaneIds.clear(); cacheVisiblePositions.clear(); cacheOrderPositions.clear(); undo = []; redo = []; cache = null; retainedBytes = 0; value = { version: 1, order: [], groups: [], collapsed: [], pinned: [] }; serialized = ''; }
  };
}
