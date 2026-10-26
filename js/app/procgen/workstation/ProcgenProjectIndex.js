const indexes = new WeakMap(), changes = new WeakMap(), identities = new WeakMap();
const identity = project => { let token = identities.get(project); if (!token) { token = {}; identities.set(project, token); } return token; };
let builds = 0, lookups = 0;
export function procgenLaneIndex(lanes) {
  let index = indexes.get(lanes);
  if (!index) { index = new Map(lanes.map((lane, position) => [lane.id, position])); indexes.set(lanes, index); builds++; }
  return index;
}
export const procgenLane = (lanes, id) => { lookups++; const position = procgenLaneIndex(lanes).get(id); return position == null ? null : lanes[position]; };
export function inheritProcgenLaneIndex(before, after) { indexes.set(after, procgenLaneIndex(before)); }
export function recordProcgenProjectChange(before, after, action) {
  const structural = ['procgen/addLane', 'procgen/removeLane'].includes(action.type);
  const laneIds = action.type === 'procgen/sceneMacro' ? action.targets.map(target => target.laneId) : action.type === 'procgen/launchedBatch' ? [...new Set(action.launches.map(launch => launch.laneId))] : action.laneId ? [action.laneId] : [];
  changes.set(after, Object.freeze({ beforeIdentity: identity(before), type: action.type, structural, laneIds: Object.freeze(laneIds),
    fields: Object.freeze(action.type === 'procgen/sceneMacro' ? ['instrumentControls'] : action.patch && typeof action.patch === 'object' ? Object.keys(action.patch) : []),
    revision: after.procgen.revision }));
  return after;
}
export const procgenProjectChange = (before, after) => changes.get(after)?.beforeIdentity === identity(before) ? changes.get(after) : null;
export const procgenIndexDiagnostics = () => ({ builds, lookups });
