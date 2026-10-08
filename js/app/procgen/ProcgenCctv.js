import { ProcgenCctvDirector } from './ProcgenCctvDirector.js';
import { LANE_HEIGHT } from './ProcgenLaneWorld.js';

const CCTV_INTERVAL_MS = 100;
const CCTV_MAX_WINDOWS = 8;
const CCTV_REPLACE_LEAD = 24;
const progress = (world, lane) => Math.max(0, (world.stall?.lanes[lane]?.maxX || 36) - 36);
const rankCctvLanes = world => Array.from({ length: world.laneCount }, (_, lane) => lane)
  .sort((a, b) => progress(world, b) - progress(world, a) || a - b);
const selectCctvLanes = (world, previous = []) => {
  const ranked = rankCctvLanes(world), count = Math.min(CCTV_MAX_WINDOWS, ranked.length);
  const selected = previous.filter(lane => ranked.includes(lane)).slice(0, count);
  for (const lane of ranked) {
    if (selected.includes(lane)) continue;
    if (selected.length < count) { selected.push(lane); continue; }
    let worst = 0;
    for (let i = 1; i < selected.length; i++) if (progress(world, selected[i]) < progress(world, selected[worst])) worst = i;
    if (progress(world, lane) > progress(world, selected[worst]) + CCTV_REPLACE_LEAD) selected[worst] = lane;
  }
  return selected;
};
const cctvLayout = (width, height, count) => {
  const columns = Math.min(count, width >= 700 ? 4 : 2), rows = Math.ceil(count / Math.max(1, columns));
  const bandHeight = count ? Math.min(height * 0.38, 28 + rows * 104) : 0;
  return { columns, rows, bandHeight, tileWidth: width / Math.max(1, columns), tileHeight: (bandHeight - 24) / Math.max(1, rows) };
};

// Eight small views share the existing world, sprites and raster methods. No
// second simulation, sound subscription, timer or entity camera is created.
class ProcgenCctv {
  constructor(renderer) {
    this.renderer = renderer; this.slots = []; this.views = new Map(); this.layout = null;
    this.lastUpdateMs = -Infinity; this.lastStateKey = ''; this.renderKey = ''; this.refreshes = 0;
    this.generation = -1; this.actorScans = 0; this.director = new ProcgenCctvDirector(); this.onChange = null; this.lastSelectionKey = '';
  }
  getState() {
    return { mode: this.director.mode, pins: [...this.director.pins], slots: this.slots.map(lane => ({ lane, rank: this.views.get(lane)?.rank,
      reason: this.director.mode === 'director' ? this.director.reasons.get(lane) || 'Distance leader' : 'Distance leader', pinned: this.director.pins.has(lane) })) };
  }
  setMode(mode) { if (this.director.setMode(mode)) { if (mode === 'leaders') this.slots = []; this.lastStateKey = ''; this.renderer.render(); } }
  setPins(lanes) { if (this.director.setPins(lanes, this.renderer.world.laneCount)) { this.lastStateKey = ''; this.renderer.render(); } }
  togglePin(lane) { const changed = this.director.togglePin(lane, this.renderer.world.laneCount); if (changed) { this.lastStateKey = ''; this.renderer.render(); } return changed; }
  prepare() {
    const r = this.renderer, dpr = Math.min(2, r.window.devicePixelRatio || 1);
    const width = r.canvas.width / dpr, height = r.canvas.height / dpr;
    const count = Math.min(CCTV_MAX_WINDOWS, r.world.laneCount);
    if (this.layoutWidth !== width || this.layoutHeight !== height || this.layoutCount !== count) {
      this.layout = cctvLayout(width, height, count); this.layoutWidth = width; this.layoutHeight = height; this.layoutCount = count;
    }
    r.overviewBandHeight = r.overviewActive ? this.layout.bandHeight : 0;
    if (!r.overviewActive) return;
    const now = r.window.performance?.now?.() || 0, world = r.world;
    const key = [world.generation, world.tickIndex, world.terrainRevision, world.frontierRevision, width, height, world.sprites?.activePreference, this.director.revision].join(':');
    const resized = this.width !== width || this.height !== height || this.lastAppearance !== world.sprites?.activePreference || this.lastSprites !== world.sprites;
    const controlsChanged = this.lastDirectorRevision !== this.director.revision;
    if (!controlsChanged && (!resized && key === this.lastStateKey || !resized && now - this.lastUpdateMs < CCTV_INTERVAL_MS)) return;
    if (this.generation !== world.generation) { this.slots = []; this.views.clear(); this.generation = world.generation; }
    const ranked = rankCctvLanes(world);
    this.slots = this.director.mode === 'director' ? this.director.select(world, ranked, this.slots, now) : selectCctvLanes(world, this.slots);
    const selected = new Set(this.slots), leaders = new Map(), actorsByLane = new Map();
    for (const actor of world.actors) {
      this.actorScans++;
      const lane = actor.laneIndex ?? Math.floor(actor.y / LANE_HEIGHT);
      if (!selected.has(lane) || actor.failureReason || actor.removed || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) continue;
      const previous = leaders.get(lane);
      if (!previous || actor.x > previous.x || actor.x === previous.x && actor.id < previous.id) leaders.set(lane, actor);
      let actors = actorsByLane.get(lane);
      if (!actors) { actors = []; actorsByLane.set(lane, actors); }
      actors.push(actor);
    }
    const ranks = new Map(ranked.map((lane, index) => [lane, index + 1]));
    for (const lane of this.slots) this.refresh(lane, leaders.get(lane), actorsByLane.get(lane) || [], ranks.get(lane));
    for (const lane of this.views.keys()) if (!selected.has(lane)) this.views.delete(lane);
    this.width = width; this.height = height; this.lastAppearance = world.sprites?.activePreference; this.lastSprites = world.sprites; this.lastUpdateMs = now; this.lastStateKey = key;
    this.renderKey = key; this.refreshes++; this.lastDirectorRevision = this.director.revision;
    const state = this.getState(), selectionKey = JSON.stringify(state);
    if (selectionKey !== this.lastSelectionKey) { this.lastSelectionKey = selectionKey; try { this.onChange?.(state); } catch { /* Controls cannot interrupt rendering. */ } }
  }
  createView() {
    const r = this.renderer, document = r.canvas.ownerDocument, view = Object.create(r);
    view.buffer = document.createElement('canvas'); view.bufferContext = view.buffer.getContext('2d', { alpha: false });
    view.terrainBuffer = document.createElement('canvas'); view.terrainContext = view.terrainBuffer.getContext('2d', { alpha: false });
    view.objectBuffer = document.createElement('canvas'); view.objectContext = view.objectBuffer.getContext('2d');
    view.tileRevisions = new Map(); view.actorDots = new Map(); view.objectDots = new Map(); view.objectPlacements = [];
    view.rasterStep = 1; view.image = null; view.lastTerrainKey = ''; view.lastGeometryKey = ''; view.lastPlacementKey = ''; view.lastObjectKey = '';
    view.terrainRebuilds = view.terrainCacheHits = 0;
    return view;
  }
  refresh(lane, leader, actors, rank) {
    const r = this.renderer, world = r.world;
    let view = this.views.get(lane);
    if (!view) { view = this.createView(); this.views.set(lane, view); }
    const width = 128, height = Math.max(32, Math.min(64, Math.round(width * (this.layout.tileHeight - 18) / this.layout.tileWidth)));
    if (!view.image || view.buffer.width !== width || view.buffer.height !== height) {
      view.buffer.width = view.terrainBuffer.width = view.objectBuffer.width = width;
      view.buffer.height = view.terrainBuffer.height = view.objectBuffer.height = height;
      view.image = view.terrainContext.createImageData(width, height); view.pixels = new Uint32Array(view.image.data.buffer); view.lastTerrainKey = '';
    }
    view.viewWidth = width; view.viewHeight = height;
    view.originX = Math.max(0, Math.floor((leader?.x ?? world.stall.lanes[lane].maxX ?? 36) - width * 0.55));
    view.originY = lane * LANE_HEIGHT + Math.max(0, Math.min(LANE_HEIGHT - height, Math.floor((leader?.y ?? lane * LANE_HEIGHT + 60) - lane * LANE_HEIGHT - height * 0.6)));
    const geometry = [lane, view.originX, view.originY, width, height, world.generation].join(':');
    const terrainKey = geometry + ':' + world.terrainRevision + ':' + world.frontierRevision;
    if (terrainKey !== view.lastTerrainKey) { view._terrainPixels(width, height, geometry !== view.lastGeometryKey); view.lastTerrainKey = terrainKey; view.lastGeometryKey = geometry; }
    view.bufferContext.imageSmoothingEnabled = false; view.bufferContext.drawImage(view.terrainBuffer, 0, 0); view._drawObjects();
    let drawn = 0;
    if (leader) { leader.render(view); drawn++; }
    for (const actor of actors) if (drawn < 64 && actor !== leader && actor.x >= view.originX - 24 && actor.x <= view.originX + width + 24) { actor.render(view); drawn++; }
    view.leaderId = leader?.id ?? null; view.actionLabel = leader?.action?.constructor?.name?.replace(/^Action|System$/g, '').toUpperCase() || ''; view.rank = rank; view.distance = Math.round(progress(world, lane)); view.drawn = drawn;
  }
  draw(context, dpr) {
    const r = this.renderer;
    if (!r.overviewActive || !this.layout || !this.slots.length) return;
    const { columns, bandHeight, tileWidth, tileHeight } = this.layout, top = r.canvas.height / dpr - bandHeight;
    context.save?.(); context.imageSmoothingEnabled = false;
    context.fillStyle = '#10151c'; context.fillRect(0, top * dpr, r.canvas.width, bandHeight * dpr);
    context.font = 11 * dpr + 'px monospace'; context.textBaseline = 'top'; context.fillStyle = '#c7d3df';
    context.fillText?.('LEMMINGS CCTV  ' + (this.director.mode === 'director' ? 'DIRECTOR' : 'EIGHT LEADERS'), 8 * dpr, (top + 5) * dpr);
    for (let i = 0; i < this.slots.length; i++) {
      const lane = this.slots[i], view = this.views.get(lane); if (!view) continue;
      const x = i % columns * tileWidth + 4, y = top + 24 + Math.floor(i / columns) * tileHeight;
      context.save?.(); context.beginPath?.(); context.rect?.(x * dpr, y * dpr, (tileWidth - 8) * dpr, tileHeight * dpr); context.clip?.();
      context.fillStyle = this.director.pins.has(lane) ? '#ffcc38' : '#aab7c5';
      context.fillText?.('LANE ' + (lane + 1) + '  #' + view.rank + '  ' + view.distance + (view.leaderId == null ? '  NO LIVE ACTOR' : '  ' + view.actionLabel), x * dpr, y * dpr);
      const reason = this.director.mode === 'director' ? this.director.reasons.get(lane) : 'Distance leader';
      context.font = 9 * dpr + 'px monospace'; context.fillText?.((this.director.pins.has(lane) ? '[PIN] ' : '') + reason, x * dpr, (y + 13) * dpr); context.font = 11 * dpr + 'px monospace';
      context.drawImage(view.buffer, x * dpr, (y + 25) * dpr, Math.max(1, tileWidth - 8) * dpr, Math.max(1, tileHeight - 30) * dpr); context.restore?.();
    }
    context.restore?.();
  }
  dispose() { this.onChange = null; this.views.clear(); this.slots = []; this.director.reset(); }
}
export { ProcgenCctv, rankCctvLanes, selectCctvLanes, cctvLayout, CCTV_INTERVAL_MS, CCTV_MAX_WINDOWS };
