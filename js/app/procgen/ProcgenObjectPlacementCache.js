import { assemblyPlacementReady } from './ProcgenAssemblyPlacement.js';
import { procgenObjectImage } from './ProcgenObjectPresentation.js';
import { peekProcgenTileRevision } from './ProcgenTerrainRetention.js';

const unprepared = state => state?.complete === false && state.active?.length === 0 && !state.plan;

// Geometry and terrain masks are canonical world coordinates. A viewport only
// projects these entries; animation and trap owners are sampled during painting.
class ProcgenObjectPlacementCache {
  constructor(world, resources, { maxTiles = 512, maxClipBytes = 2 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxTiles) || maxTiles < 1 || !Number.isSafeInteger(maxClipBytes) || maxClipBytes < 0) throw new Error('Invalid placement cache limits.');
    this.world = world; this.resources = resources; this.tiles = new Map(); this.maxTiles = maxTiles; this.maxClipBytes = maxClipBytes;
    this.clipBytes = 0; this.stagedClipBytes = 0; this.stats = { hits: 0, misses: 0, placementRebuilds: 0, clipPixelsSampled: 0, maskAllocations: 0, peakClipBytes: 0, evictions: 0 };
  }
  _dependencies(lane, chunk, descriptor) {
    const world = this.world, width = world.terrain.chunkWidth, chunks = new Set([chunk]);
    const include = (left, right) => { for (let cx = Math.floor(left / width); cx <= Math.floor(right / width); cx++) if (cx >= 0) chunks.add(cx); };
    for (const object of descriptor.objects) {
      include(object.x - (object.role === 'liquid' ? 1 : 0), object.x + object.piece.image.width);
      if (object.assembly) {
        include(object.assembly.bounds.x1, object.assembly.bounds.x2 - 1);
        for (const point of [...object.assembly.contacts, ...object.assembly.foundationSupports]) include(point.x, point.x);
      }
    }
    const key = [world.generation, world.leftEdgeX];
    for (const cx of chunks) {
      const state = world.terrainGrowth?.stateFor?.(lane, cx);
      key.push(cx, peekProcgenTileRevision(world, lane * 0x800000 + cx), Math.max(0, Math.min(width, world.generatedThrough[lane] - cx * width)), unprepared(state) ? -1 : state?.revision || 0);
    }
    for (const object of descriptor.objects) key.push(object.x, object.y, object.supportY, object.clipToTerrain, object.role, object.flip, object.flipY, object.phase, object.animation, object.assembly?.sourceRevision || '');
    return key.join(':');
  }
  get(lane, chunk, descriptor) {
    const world = this.world, terrain = world.terrain, width = terrain.chunkWidth, key = lane * 0x800000 + chunk, signature = this._dependencies(lane, chunk, descriptor);
    if (this.generation !== world.generation) { this.clear(); this.generation = world.generation; }
    let entry = this.tiles.get(key);
    const assetsMatch = entry?.images.length === descriptor.objects.length && entry.images.every((image, index) => image === descriptor.objects[index].piece.image);
    if (entry?.signature === signature && assetsMatch) { this.stats.hits++; this.tiles.delete(key); this.tiles.set(key, entry); return entry.placements; }
    this.stats.misses++; const previous = entry;
    entry = { signature, images: descriptor.objects.map(object => object.piece.image), placements: [], clipBytes: 0 };
    const seed = world.laneSeeds[lane], top = lane * (world.laneHeight || 96);
    const matchesTerrain = (x, y) => {
      if (x < world.leftEdgeX || x >= world.generatedThrough[lane] || y < 0 || y >= (world.laneHeight || 96)) return false;
      const edits = world.editChunks.get(world._editKey(x, top + y)), edit = edits?.[y * 32 + x % 32] || 0;
      if (edit) return edit > 1;
      const cx = Math.floor(x / width), state = world.terrainGrowth?.stateFor?.(lane, cx);
      if (unprepared(state)) return false;
      const source = cx === chunk ? descriptor : terrain.describe(seed, cx);
      return terrain.solidSample(seed, cx, x - cx * width, y, source, state);
    };
    for (let objectIndex = 0; objectIndex < descriptor.objects.length; objectIndex++) {
      const object = descriptor.objects[objectIndex], image = procgenObjectImage(object), hazard = ['trap', 'liquid', 'hazard'].includes(object.role);
      if (world.terrainGrowth?.objectReady && !world.terrainGrowth.objectReady(lane, chunk, objectIndex)) continue;
      if (object.x + image.width + (object.role === 'liquid' ? 1 : 0) > world.generatedThrough[lane]) continue;
      if (object.assembly && !assemblyPlacementReady(world, lane, object, descriptor, { readOnly: true })) continue;
      if (hazard && world.hazards && !world.hazards.placementReady(lane, chunk, object, descriptor, { readOnly: true })) continue;
      if (object.supportY != null && !hazard) {
        let supported = true;
        for (let dx = 0; dx < image.width; dx++) if (!matchesTerrain(object.x + dx, object.supportY)) { supported = false; break; }
        if (!supported) continue;
      }
      const placement = { image, x: object.x, y: top + object.y, lane, chunk, objectIndex, sourceObjectId: object.piece.id, role: object.role, assemblyId: object.assembly?.id || null,
        phase: object.phase, animation: object.animation, clip: null, clippedFrames: null };
      placement.needsClip = object.clipToTerrain === true;
      if (placement.needsClip) {
        const bytes = image.width * image.height;
        if (!Number.isSafeInteger(bytes) || bytes < 0 || entry.clipBytes + bytes > this.maxClipBytes) throw new Error('Aggregate object terrain masks exceed the display cache budget');
        entry.clipBytes += bytes;
      }
      entry.placements.push(placement);
    }
    while (this.tiles.size && (this.tiles.size + (previous ? 0 : 1) > this.maxTiles || this.clipBytes + entry.clipBytes > this.maxClipBytes)) {
      let victim; for (const candidate of this.tiles.keys()) if (candidate !== key) { victim = candidate; break; }
      if (victim === undefined) break; this._retire(victim); this.stats.evictions++;
    }
    if (this.clipBytes + entry.clipBytes > this.maxClipBytes) throw new Error('Staged object terrain masks exceed the retained plus candidate display cache budget');
    // Admit the complete candidate before allocating or sampling any clip mask.
    this.resources?.retain(entry, entry.clipBytes);
    this.stagedClipBytes = entry.clipBytes; this.stats.peakClipBytes = Math.max(this.stats.peakClipBytes, this.clipBytes + this.stagedClipBytes);
    try {
      const visiblePlacements = []; let retainedBytes = 0;
      for (const placement of entry.placements) {
        if (placement.needsClip) {
          const { image } = placement;
          placement.clip = new Uint8Array(image.width * image.height); this.stats.maskAllocations++; placement.clippedFrames = new Map();
          let visible = false;
          for (let dy = 0; dy < image.height; dy++) for (let dx = 0; dx < image.width; dx++) {
            this.stats.clipPixelsSampled++;
            if (matchesTerrain(placement.x + dx, placement.y - top + dy)) { placement.clip[dy * image.width + dx] = 1; visible = true; }
          }
          if (!visible) continue;
          retainedBytes += placement.clip.byteLength;
        }
        delete placement.needsClip; visiblePlacements.push(placement);
      }
      entry.placements = visiblePlacements; this.resources?.retain(entry, retainedBytes); entry.clipBytes = retainedBytes;
      if (previous) this._retire(key);
      this.stats.placementRebuilds++; this.clipBytes += entry.clipBytes; this.tiles.set(key, entry);
    } catch (error) { this.resources?.release(entry); throw error; }
    finally { this.stagedClipBytes = 0; }
    return entry.placements;
  }
  _retire(key) {
    const entry = this.tiles.get(key); if (!entry) return;
    for (const placement of entry.placements) if (placement.clippedFrames) for (const bitmap of placement.clippedFrames.values()) this.resources?.release(bitmap);
    this.resources?.release(entry); this.clipBytes -= entry.clipBytes; this.tiles.delete(key);
  }
  getStats() { return { ...this.stats, tiles: this.tiles.size, clipBytes: this.clipBytes, stagedClipBytes: this.stagedClipBytes, maxTiles: this.maxTiles, maxClipBytes: this.maxClipBytes }; }
  clear() { for (const key of this.tiles.keys()) this._retire(key); }
  dispose() { this.clear(); this.world = this.resources = null; }
}

export { ProcgenObjectPlacementCache };
