import { getProcgenActorVisibility } from '../ProcgenActorVisibility.js';
import { createProcgenActionCodes, formatProcgenActionMask } from '../ProcgenActorActions.js';

const EMPTY = Object.freeze({ action: '', terrain: '' });
const EMPTY_ACTORS = Object.freeze([]);

// Lane facts share the completed publication. Contact reads remain lazy and
// never reveal terrain or create hazard owners.
export function createProcgenLaneObserver(world) {
  let tick = -1, generation = -1, revision = -1, serial = 0, actors = null, actorCount = -1, actionOwner = null;
  let leaders = [], masks = new Uint16Array(0), orders = new Float64Array(0), observations = [];
  let projection = null, codes = new Map(), fallbackBuilds = 0, actorVisits = 0, contactQueries = 0, indexAllocations = 0, observationAllocations = 0;
  const index = () => {
    const next = getProcgenActorVisibility(world), population = world.actors || EMPTY_ACTORS;
    revision = world.terrainRevision;
    if (tick === world.tickIndex && generation === world.generation && actors === population && actorCount === population.length &&
        projection === next && actionOwner === world.actions && leaders.length === world.laneCount) return;
    tick = world.tickIndex; generation = world.generation; actors = population; actorCount = actors.length; projection = next; serial++;
    if (actionOwner !== world.actions) { actionOwner = world.actions; codes = createProcgenActionCodes(world.actions); }
    if (leaders.length !== world.laneCount) {
      leaders = new Array(world.laneCount); masks = new Uint16Array(world.laneCount); orders = new Float64Array(world.laneCount);
      observations.length = world.laneCount; indexAllocations++;
    }
    if (projection) { projection.publish(); return; }
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
    const previous = observations[lane];
    if (previous?.serial === serial && previous.revision === revision) return previous.value;
    const actor = projection ? projection.semanticObservationLeader(lane) : leaders[lane];
    if (!actor) return save(lane, EMPTY);
    const x = Math.floor(actor.x), y = Math.floor(actor.y), direction = actor.lookRight === false ? -1 : 1;
    const tags = [], ahead = x + direction * 4;
    const known = px => px >= (world.leftEdgeX || 0) && px < (world.generatedThrough?.[lane] ?? world.width);
    const ground = (px, py) => { if (!known(px)) return false; contactQueries++; return !!world.hasGroundAt(px, py); };
    if (ground(x, y) || ground(x, y + 1)) tags.push('ground');
    if (known(ahead) && !ground(ahead, y) && !ground(ahead, y + 1) && !ground(ahead, y + 4)) tags.push('gap');
    if (ground(x + direction * 2, y - 5) || ground(ahead, y - 5)) tags.push('wall');
    if (known(ahead) && world.hasSteelAt?.(ahead, y - 5)) tags.push('steel');
    const chunkWidth = world.terrain?.chunkWidth || 256, first = Math.max(0, Math.floor((x - 8) / chunkWidth));
    for (let chunk = first; chunk <= first + 1; chunk++) {
      const record = world.hazards?.chunks?.get(lane * 0x800000 + chunk);
      if (record?.entries.some(entry => entry?.enabled && entry.trigger && entry.trigger.x2 > x - 8 && entry.trigger.x1 < x + 16 && entry.trigger.y2 > y - 12 && entry.trigger.y1 < y + 8)) { tags.push('hazard'); break; }
    }
    const mask = projection ? projection.semanticActionMask(lane) : masks[lane], order = projection ? projection.semanticActionOrder(lane) : orders[lane];
    return save(lane, Object.freeze({ action: formatProcgenActionMask(mask, order), terrain: tags.join(' '), x: actor.x, y: actor.y }));
  };
  observe.getStats = () => ({ fallbackBuilds, actorVisits, contactQueries, indexAllocations, observationAllocations });
  return observe;
}
