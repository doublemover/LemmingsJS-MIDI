import { getProcgenActorVisibility } from '../ProcgenActorVisibility.js';
import { createProcgenActionCodes, formatProcgenActionMask } from '../ProcgenActorActions.js';

const EMPTY = Object.freeze({ action: '', terrain: '' });
const EMPTY_ACTORS = Object.freeze([]);

// Lane facts share the completed publication. Contact reads remain lazy and
// never reveal terrain or create hazard owners.
export function createProcgenLaneObserver(world) {
  let tick = -1, generation = -1, revision = -1, serial = 0, actors = null, actorCount = -1, actionOwner = null;
  let leaders = [], masks = new Uint16Array(0), orders = new Float64Array(0), observations = [];
  let projection = null, projectionRevision = null, codes = new Map(), fallbackBuilds = 0, actorVisits = 0, contactQueries = 0, unknownContactQueries = 0, indexAllocations = 0, observationAllocations = 0;
  const index = () => {
    const next = getProcgenActorVisibility(world), population = world.actors || EMPTY_ACTORS;
    next?.publish(); const nextRevision = next?.revision ?? null;
    revision = world.terrainRevision;
    if (tick === world.tickIndex && generation === world.generation && actors === population && actorCount === population.length &&
        projection === next && projectionRevision === nextRevision && actionOwner === world.actions && leaders.length === world.laneCount) return;
    tick = world.tickIndex; generation = world.generation; actors = population; actorCount = actors.length; projection = next; projectionRevision = nextRevision; serial++;
    if (actionOwner !== world.actions) { actionOwner = world.actions; codes = createProcgenActionCodes(world.actions); }
    if (leaders.length !== world.laneCount) {
      leaders = new Array(world.laneCount); masks = new Uint16Array(world.laneCount); orders = new Float64Array(world.laneCount);
      observations.length = world.laneCount; indexAllocations++;
    }
    if (projection) return;
    fallbackBuilds++; leaders.fill(null); masks.fill(0); orders.fill(0);
    for (const actor of actors) {
      actorVisits++; const lane = actor.laneIndex;
      if (actor.failureReason || actor.removed || !actor.action || lane < 0 || lane >= world.laneCount || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) continue;
      if (!leaders[lane] || actor.x > leaders[lane].x || actor.x === leaders[lane].x && actor.id < leaders[lane].id) leaders[lane] = actor;
      const code = codes.get(actor.action);
      if (code != null) {
        const bit = 1 << code;
        if (!(masks[lane] & bit)) orders[lane] = orders[lane] * 16 + code + 1;
        masks[lane] |= bit;
      }
    }
  };
  const save = (lane, value) => {
    let entry = observations[lane];
    if (!entry) { entry = observations[lane] = {}; observationAllocations++; }
    entry.serial = serial; entry.revision = revision; entry.value = value; return value;
  };
  const observe = lane => {
    if (!Number.isInteger(lane) || lane < 0 || lane >= world.laneCount) return EMPTY;
    if (world._stepping && world._musicCompletedTick !== world.tickIndex) return observations[lane]?.value || EMPTY;
    index();
    if (projection && !projection.isCurrent()) return EMPTY;
    const previous = observations[lane];
    if (previous?.serial === serial && previous.revision === revision) return previous.value;
    const lease = projection?.acquireSnapshot();
    try {
      if (projection && (!lease || !projection.isCurrent())) return EMPTY;
      const actor = lease ? lease.frame.observationLeaders[lane] : leaders[lane];
      if (!actor) return save(lane, EMPTY);
      const x = Math.floor(actor.x), y = Math.floor(actor.y), direction = actor.lookRight === false ? -1 : 1;
      const tags = [], ahead = x + direction * 4; let unknown = false;
      const known = (px, py) => px >= (world.leftEdgeX || 0) && px < (world.generatedThrough?.[Math.floor(py / (world.laneHeight || 96))] ?? world.width);
      const contact = (px, py, steel = false) => {
        let value = null;
        if (known(px, py)) {
          contactQueries++;
          value = steel ? world.peekSteelAt ? world.peekSteelAt(px, py) : !!world.hasSteelAt?.(px, py) : world.peekGroundAt ? world.peekGroundAt(px, py) : !!world.hasGroundAt(px, py);
        }
        if (value == null) { unknown = true; unknownContactQueries++; return null; } return value;
      };
      if (contact(x, y) === true || contact(x, y + 1) === true) tags.push('ground');
      if (contact(ahead, y) === false && contact(ahead, y + 1) === false && contact(ahead, y + 4) === false) tags.push('gap');
      if (contact(x + direction * 2, y - 5) === true || contact(ahead, y - 5) === true) tags.push('wall');
      if (contact(ahead, y - 5, true) === true) tags.push('steel');
      const chunkWidth = world.terrain?.chunkWidth || 256, first = Math.max(0, Math.floor((x - 8) / chunkWidth));
      for (let chunk = first; chunk <= first + 1; chunk++) {
        const record = world.hazards?.chunks?.get(lane * 0x800000 + chunk);
        if (record?.entries.some(entry => entry?.enabled && entry.trigger && entry.trigger.x2 > x - 8 && entry.trigger.x1 < x + 16 && entry.trigger.y2 > y - 12 && entry.trigger.y1 < y + 8)) { tags.push('hazard'); break; }
      }
      const mask = lease ? lease.frame.actionMasks[lane] : masks[lane], order = lease ? lease.frame.actionOrders[lane] : orders[lane];
      return save(lane, Object.freeze({ action: formatProcgenActionMask(mask, order), terrain: tags.join(' '), x: actor.x, y: actor.y, ...(unknown ? { terrainCoverage: 'partial' } : {}) }));
    } finally { lease?.release(); }
  };
  observe.getStats = () => ({ fallbackBuilds, actorVisits, contactQueries, unknownContactQueries, indexAllocations, observationAllocations });
  return observe;
}
