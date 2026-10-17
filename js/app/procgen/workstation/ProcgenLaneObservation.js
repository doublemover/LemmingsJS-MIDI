import { LemmingStateType as State } from '../../../lemmings/LemmingStateType.js';

const ACTIONS = { WALKING: 'walk', FALLING: 'fall', JUMPING: 'jump', DIGGING: 'dig', CLIMBING: 'climb', HOISTING: 'climb',
  BUILDING: 'build', BLOCKING: 'block', BASHING: 'bash', FLOATING: 'float', MINING: 'mine', SHRUG: 'idle' };
const EMPTY = Object.freeze({ action: '', terrain: '' });

// Observe completed physical state. No descriptors or hazards are prepared here.
// Actor indexing runs once per tick, and contact samples only run for requested lanes.
export function createProcgenLaneObserver(world) {
  let tick = -1, generation = -1, revision = -1, leaders = [], actions = [], observations = [];
  const names = new Map(Object.entries(ACTIONS).map(([state, name]) => [world.actions?.[State[state]], name]));
  const index = () => {
    if (tick === world.tickIndex && generation === world.generation && revision === world.terrainRevision) return;
    tick = world.tickIndex; generation = world.generation; revision = world.terrainRevision;
    leaders = new Array(world.laneCount); actions = new Array(world.laneCount); observations = new Array(world.laneCount);
    for (const actor of world.actors || []) {
      const lane = actor.laneIndex;
      if (actor.failureReason || actor.removed || !actor.action || lane < 0 || lane >= world.laneCount) continue;
      if (!leaders[lane] || actor.x > leaders[lane].x) leaders[lane] = actor;
      const name = names.get(actor.action);
      if (name) (actions[lane] ||= new Set()).add(name);
    }
  };
  return lane => {
    if (!Number.isInteger(lane) || lane < 0 || lane >= world.laneCount) return EMPTY;
    index();
    if (observations[lane]) return observations[lane];
    const actor = leaders[lane];
    if (!actor) return observations[lane] = EMPTY;
    const x = Math.floor(actor.x), y = Math.floor(actor.y), direction = actor.lookRight === false ? -1 : 1;
    const tags = [], ahead = x + direction * 4;
    const known = px => px >= (world.leftEdgeX || 0) && px < (world.generatedThrough?.[lane] ?? world.width);
    const ground = (px, py) => known(px) && !!world.hasGroundAt(px, py);
    if (ground(x, y) || ground(x, y + 1)) tags.push('ground');
    if (known(ahead) && !ground(ahead, y) && !ground(ahead, y + 1) && !ground(ahead, y + 4)) tags.push('gap');
    if (ground(x + direction * 2, y - 5) || ground(ahead, y - 5)) tags.push('wall');
    if (known(ahead) && world.hasSteelAt?.(ahead, y - 5)) tags.push('steel');
    const chunkWidth = world.terrain?.chunkWidth || 256, first = Math.max(0, Math.floor((x - 8) / chunkWidth));
    for (let chunk = first; chunk <= first + 1; chunk++) {
      const record = world.hazards?.chunks?.get(lane * 0x800000 + chunk);
      if (record?.entries.some(entry => entry?.enabled && entry.trigger && entry.trigger.x2 > x - 8 && entry.trigger.x1 < x + 16 && entry.trigger.y2 > y - 12 && entry.trigger.y1 < y + 8)) { tags.push('hazard'); break; }
    }
    return observations[lane] = { action: [...(actions[lane] || [])].join(' '), terrain: tags.join(' '), x: actor.x, y: actor.y };
  };
}
