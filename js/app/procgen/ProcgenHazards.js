import { Animation } from '../../render/Animation.js';
import { MapObject } from '../../level/MapObject.js';
import { Trigger } from '../../level/Trigger.js';
import { TriggerTypes as Types } from '../../level/TriggerTypes.js';
import { assemblyPlacementReady } from './ProcgenAssemblyPlacement.js';
import { procgenObjectImage } from './ProcgenObjectPresentation.js';

const LANE_HEIGHT = 96;
const hazardType = object => {
  const image = object.piece.image, type = image.trigger_effect_id;
  if (type === Types.TRAP && object.role === 'trap' || type === Types.DROWN && object.role === 'liquid') return type;
  if (object.role !== 'hazard' || type !== Types.KILL && type !== Types.FRYING) return Types.NO_TRIGGER;
  const id = object.piece.id;
  return type === Types.KILL && (id === 7 || id === 8 || id === 10) ? Types.FRYING : type;
};

// Only live actor queries create owners. Rendering can inspect these records,
// but cannot populate a world-sized trigger grid or restart an animation.
class ProcgenHazards {
  constructor(world) {
    this.world = world;
    this.chunks = new Map(); this.revision = 0; this.ownerCount = 0;
    this.maxChunks = Math.max(16, 3 * (world.maxActors + world.laneCount * world.stall.settings.maxSpawnAllowance));
    this.stats = { contacts: 0, traps: 0, drowning: 0, fire: 0, killed: 0, created: 0, evicted: 0, peakChunks: 0 };
  }
  _key(lane, chunk) { return lane * 0x800000 + chunk; }
  _bounds(object, lane) {
    const image = procgenObjectImage(object);
    return { x1: object.x + image.trigger_left, y1: lane * LANE_HEIGHT + object.y + image.trigger_top,
      x2: object.x + image.trigger_left + image.trigger_width, y2: lane * LANE_HEIGHT + object.y + image.trigger_top + image.trigger_height };
  }
  placementReady(lane, chunk, object, descriptor) {
    if (!hazardType(object)) return false;
    if (this.world.terrainGrowth?.objectReady && !this.world.terrainGrowth.objectReady(lane, chunk, descriptor.objects.indexOf(object))) return false;
    const world = this.world, terrain = world.terrain, image = procgenObjectImage(object), bounds = this._bounds(object, lane);
    if (object.assembly) return bounds.x1 < bounds.x2 && bounds.y1 < bounds.y2 && assemblyPlacementReady(world, lane, object, descriptor);
    const origin = chunk * terrain.chunkWidth, top = lane * LANE_HEIGHT;
    if (![bounds.x1, bounds.y1, bounds.x2, bounds.y2, object.supportY].every(Number.isFinite) ||
        bounds.x1 >= bounds.x2 || bounds.y1 >= bounds.y2 || bounds.x1 < origin || bounds.x2 > origin + terrain.chunkWidth ||
        bounds.y1 < top || bounds.y2 > top + LANE_HEIGHT || object.y < 0 || object.supportY >= LANE_HEIGHT) return false;
    const liquid = object.role === 'liquid';
    if (Math.max(object.x + image.width, bounds.x2) + (liquid ? 1 : 0) > world.generatedThrough[lane]) return false;
    if (liquid && (bounds.x1 < object.x || bounds.x2 > object.x + image.width || bounds.y1 < top + object.y || bounds.y2 > top + object.supportY)) return false;
    const solid = (x, y) => {
      const edits = world.editChunks.get(world._editKey(x, top + y)), edit = edits?.[y * 32 + x % 32] || 0;
      return edit ? edit > 1 : x >= world.leftEdgeX && terrain.solidSample(world.laneSeeds[lane], chunk, x - origin, y, descriptor, world.terrainGrowth?.stateFor?.(lane, chunk));
    };
    for (let dx = 0; dx < image.width; dx++) if (!solid(object.x + dx, object.supportY)) return false;
    if (liquid) for (let y = object.y; y <= object.supportY; y++) {
      if (!solid(object.x - 1, y) || !solid(object.x + image.width, y)) return false;
    }
    return true;
  }
  _refresh(record, create) {
    const world = this.world, key = this._key(record.lane, record.chunk), revision = world.terrainTileRevisions.get(key) || 0;
    const through = Math.min(world.generatedThrough[record.lane], (record.chunk + 1) * world.terrain.chunkWidth);
    if (record.revision === revision && record.through === through && (!create || record.complete)) return;
    record.revision = revision; record.through = through; record.complete = create;
    for (let index = 0; index < record.entries.length; index++) {
      const entry = record.entries[index];
      if (!entry) continue;
      const enabled = this.placementReady(record.lane, record.chunk, entry.object, record.descriptor);
      if (enabled !== entry.enabled) { entry.enabled = enabled; this.revision++; }
      if (!enabled || entry.owner || !create) continue;
      const object = entry.object, image = procgenObjectImage(object), type = hazardType(object), bounds = this._bounds(object, record.lane);
      entry.owner = new MapObject({ id: object.piece.id, x: object.x, y: record.lane * LANE_HEIGHT + object.y, drawProperties: 0 }, image, new Animation(), type, world.runtime);
      entry.trigger = new Trigger(type, bounds.x1, bounds.y1, bounds.x2, bounds.y2, type === Types.TRAP ? image.frameCount : 0, image.trap_sound_effect_id, entry.owner);
      entry.trigger.runtime = world.runtime;
      this.stats.created++; this.ownerCount++; this.revision++;
    }
  }
  _chunk(lane, chunk, tick) {
    const world = this.world, terrain = world.terrain;
    if (chunk < 0 || chunk * terrain.chunkWidth >= world.generatedThrough[lane]) return null;
    const key = this._key(lane, chunk); let record = this.chunks.get(key);
    if (!record) {
      if (this.chunks.size >= this.maxChunks) this.prune(tick, true);
      if (this.chunks.size >= this.maxChunks) return null;
      const descriptor = terrain.describe(world.laneSeeds[lane], chunk);
      record = { lane, chunk, descriptor, entries: descriptor.objects.map(object => hazardType(object) ? { object, enabled: false, activated: false, owner: null, trigger: null } : null), revision: -1, through: -1, complete: false, lastTouch: tick };
      this.chunks.set(key, record); this.stats.peakChunks = Math.max(this.stats.peakChunks, this.chunks.size);
    }
    record.lastTouch = tick; this._refresh(record, true); return record;
  }
  trigger(x, y, actor, tick = this.world.tickIndex) {
    const terrain = this.world.terrain, lane = actor?.laneIndex ?? Math.floor(y / LANE_HEIGHT);
    if (!terrain?.objects?.length || lane < 0 || lane >= this.world.laneCount || y < lane * LANE_HEIGHT || y >= (lane + 1) * LANE_HEIGHT) return Types.NO_TRIGGER;
    const chunk = Math.floor(x / terrain.chunkWidth), record = this._chunk(lane, chunk, tick);
    if (!record) return Types.NO_TRIGGER;
    for (const entry of record.entries) {
      const trigger = entry?.trigger;
      if (!entry?.enabled || !trigger || x < trigger.x1 || x >= trigger.x2 || y < trigger.y1 || y >= trigger.y2) continue;
      // Trigger reports DISABLED before checking bounds; prefilter the real
      // rectangle so a nearby cooling trap cannot suppress another hazard.
      const type = trigger.trigger(x, y, tick, actor);
      if (type === Types.NO_TRIGGER || type === Types.DISABLED) continue;
      entry.activated = true; this.revision++; this.stats.contacts++;
      const name = type === Types.TRAP ? 'traps' : type === Types.DROWN ? 'drowning' : type === Types.FRYING ? 'fire' : 'killed';
      this.stats[name]++; return type;
    }
    return Types.NO_TRIGGER;
  }
  nearby(lane, x, { ahead = 40, behind = 8 } = {}, out = []) {
    out.length = 0;
    const world = this.world, terrain = world?.terrain;
    if (!terrain?.objects?.length || !Number.isInteger(lane) || lane < 0 || lane >= world.laneCount || !Number.isFinite(x)) return out;
    const left = Math.max(world.leftEdgeX, x - Math.max(0, Math.min(32, behind))), right = Math.min(world.generatedThrough[lane], x + Math.max(0, Math.min(64, ahead)));
    const first = Math.max(0, Math.floor(left / terrain.chunkWidth)), last = Math.min(first + 2, Math.floor((right - 1) / terrain.chunkWidth));
    for (let chunk = first; chunk <= last; chunk++) {
      const record = this._chunk(lane, chunk, world.tickIndex);
      if (!record) continue;
      for (let index = 0; index < record.entries.length && out.length < 8; index++) {
        const entry = record.entries[index], trigger = entry?.trigger;
        if (!entry?.enabled || !trigger || trigger.x2 <= left || trigger.x1 >= right) continue;
        out.push({ lane, chunk, objectIndex: index, type: trigger.type, x1: trigger.x1, y1: trigger.y1, x2: trigger.x2, y2: trigger.y2,
          objectX: entry.object.x, objectY: lane * LANE_HEIGHT + entry.object.y, width: entry.object.piece.image.width, height: entry.object.piece.image.height,
          supportY: entry.object.supportY == null ? null : lane * LANE_HEIGHT + entry.object.supportY, enabled: true, cooling: trigger.disabledUntilTick > world.tickIndex, disabledUntilTick: trigger.disabledUntilTick });
      }
    }
    return out;
  }
  peek(lane, chunk, objectIndex) {
    const record = this.chunks.get(this._key(lane, chunk));
    if (!record) return null;
    this._refresh(record, false);
    const entry = record.entries[objectIndex]; return entry?.enabled && entry.owner ? entry : null;
  }
  getFrame(entry, tick) {
    return !entry.activated && (entry.trigger.type === Types.TRAP || !entry.owner.animation.loop) ? entry.owner.animation.frames[0] : entry.owner.getFrame(tick);
  }
  prune(tick, urgent = false) {
    for (const [key, record] of this.chunks) {
      if (record.lastTouch >= tick - (urgent ? 1 : 32) || record.entries.some(entry => entry?.trigger?.disabledUntilTick > tick)) continue;
      this.chunks.delete(key); this.ownerCount -= record.entries.filter(entry => entry?.owner).length; this.stats.evicted++; this.revision++;
      if (urgent && this.chunks.size < this.maxChunks) break;
    }
  }
  snapshot() { return { ...this.stats, cachedChunks: this.chunks.size, maxChunks: this.maxChunks, liveOwners: this.ownerCount }; }
  reset() { this.chunks.clear(); this.ownerCount = 0; this.revision++; for (const key of Object.keys(this.stats)) this.stats[key] = 0; }
  dispose() { this.reset(); this.world = null; }
}
export { ProcgenHazards, hazardType };
