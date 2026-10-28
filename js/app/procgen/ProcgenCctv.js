import { ProcgenCctvDirector } from './ProcgenCctvDirector.js';

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
  const tileWidth = width / Math.max(1, columns);
  // A 2:1 image box makes individual actors readable without dominating the main view.
  const preferredTileHeight = 30 + Math.max(1, tileWidth - 8) / 2;
  const bandHeight = count ? Math.min(height * 0.52, 24 + rows * preferredTileHeight) : 0;
  return { columns, rows, bandHeight, tileWidth, tileHeight: count ? Math.max(0, bandHeight - 24) / Math.max(1, rows) : 0 };
};

// Eight small views share the existing world, sprites and raster methods. No
// second simulation, sound subscription, timer or entity camera is created.
class ProcgenCctv {
  constructor(renderer) {
    this.renderer = renderer; this.enabled = false; this.slots = []; this.views = new Map(); this.layout = null;
    this.lastUpdateMs = -Infinity; this.lastStateKey = ''; this.renderKey = ''; this.refreshes = 0;
    this.generation = -1; this.actorScans = 0; this.director = new ProcgenCctvDirector(); this.onChange = null; this.lastSelectionKey = '';
  }
  getState() {
    return { enabled: this.enabled, mode: this.director.mode, motion: this.renderer.motionPolicy?.automaticCamera === false ? 'held' : 'automatic', pins: [...this.director.pins], slots: this.slots.map(lane => ({ lane, rank: this.views.get(lane)?.rank,
      reason: this.director.mode === 'director' ? this.director.reasons.get(lane) || 'Distance leader' : 'Distance leader', pinned: this.director.pins.has(lane) })) };
  }
  setEnabled(enabled) { if (this.enabled === !!enabled) return; this.enabled = !!enabled; this.lastStateKey = ''; this.renderKey = ''; this.renderer.render(); this.onChange?.(this.getState()); }
  setMode(mode) { if (this.director.setMode(mode)) { if (mode === 'leaders') this.slots = []; this.lastStateKey = ''; this.renderer.render(); } }
  setPins(lanes) { if (this.director.setPins(lanes, this.renderer.world.laneCount)) { this.lastStateKey = ''; this.renderer.render(); } }
  togglePin(lane) { const changed = this.director.togglePin(lane, this.renderer.world.laneCount); if (changed) { this.lastStateKey = ''; this.renderer.render(); } return changed; }
  prepare(presentationMs) {
    const r = this.renderer, dpr = r.presentationDpr || Math.min(2, r.window.devicePixelRatio || 1);
    const width = r.canvas.width / dpr, height = r.canvas.height / dpr;
    const count = Math.min(CCTV_MAX_WINDOWS, r.world.laneCount);
    if (this.layoutWidth !== width || this.layoutHeight !== height || this.layoutCount !== count) {
      this.layout = cctvLayout(width, height, count); this.layoutWidth = width; this.layoutHeight = height; this.layoutCount = count;
    }
    r.overviewBandHeight = this.enabled && r.overviewActive ? this.layout.bandHeight : 0;
    if (!this.enabled || !r.overviewActive) return;
    const now = presentationMs ?? r.window.performance?.now?.() ?? 0, world = r.world;
    const directorTime = r.motionPolicy?.presentationTime(now) ?? now;
    const key = [world.generation, world.tickIndex, world.terrainRevision, world.frontierRevision, width, height, world.sprites?.activePreference, this.director.revision].join(':');
    const resized = this.width !== width || this.height !== height || this.lastAppearance !== world.sprites?.activePreference || this.lastSprites !== world.sprites;
    const controlsChanged = this.lastDirectorRevision !== this.director.revision;
    if (!controlsChanged && (!resized && key === this.lastStateKey || !resized && now - this.lastUpdateMs < CCTV_INTERVAL_MS)) return;
    if (this.generation !== world.generation) { this.slots = []; this.releaseViews(); this.generation = world.generation; }
    const ranked = rankCctvLanes(world);
    if (r.motionPolicy?.automaticCamera !== false || controlsChanged || !this.slots.length) this.slots = this.director.mode === 'director' ? this.director.select(world, ranked, this.slots, directorTime) : selectCctvLanes(world, this.slots);
    else this.slots = this.slots.filter(lane => lane >= 0 && lane < world.laneCount);
    const selected = new Set(this.slots), leaders = new Map(), actorsByLane = new Map();
    const visit = actor => {
      this.actorScans++;
      const lane = actor.laneIndex ?? Math.floor(actor.y / (world.laneHeight || 96));
      if (!selected.has(lane) || actor.failureReason || actor.removed || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return;
      const previous = leaders.get(lane);
      if (!previous || actor.x > previous.x || actor.x === previous.x && actor.id < previous.id) leaders.set(lane, actor);
      let actors = actorsByLane.get(lane);
      if (!actors) { actors = []; actorsByLane.set(lane, actors); }
      actors.push(actor);
    };
    const lease = this.renderer.actorVisibility?.acquireSnapshot();
    if (this.renderer.actorVisibility && (!lease || !this.renderer.actorVisibility.isCurrent())) { lease?.release(); return; }
    try {
      if (lease) {
        for (const lane of selected) for (const actor of lease.frame.semanticLanes[lane] || []) visit(actor);
      } else {
        for (const actor of world.actors) visit(actor);
      }
      const ranks = new Map(ranked.map((lane, index) => [lane, index + 1]));
      for (const lane of this.slots) this.refresh(lane, leaders.get(lane), actorsByLane.get(lane) || [], ranks.get(lane));
    } finally { lease?.release(); }
    for (const lane of this.views.keys()) if (!selected.has(lane)) this.releaseView(lane);
    this.width = width; this.height = height; this.lastAppearance = world.sprites?.activePreference; this.lastSprites = world.sprites; this.lastUpdateMs = now; this.lastStateKey = key;
    this.renderKey = key; this.refreshes++; this.lastDirectorRevision = this.director.revision;
    const state = this.getState(), selectionKey = JSON.stringify(state);
    if (selectionKey !== this.lastSelectionKey) { this.lastSelectionKey = selectionKey; try { this.onChange?.(state); } catch { /* Controls cannot interrupt rendering. */ } }
  }
  createView() {
    const r = this.renderer, view = Object.create(r);
    view.buffer = r.resources.canvas(); view.bufferContext = view.buffer.getContext('2d', { alpha: false });
    view.terrainBuffer = r.resources.canvas(); view.terrainContext = view.terrainBuffer.getContext('2d', { alpha: false });
    view.objectBuffer = r.resources.canvas(); view.objectContext = view.objectBuffer.getContext('2d');
    if (!view.bufferContext || !view.terrainContext || !view.objectContext) {
      for (const canvas of [view.buffer, view.terrainBuffer, view.objectBuffer]) r.resources.release(canvas);
      throw new Error('CCTV canvas context unavailable');
    }
    view.imageKey = {}; view.sceneryImageKey = {};
    view.tileRevisions = new Map(); view.actorDots = new Map(); view.objectDots = new Map(); view.objectPlacements = [];
    view.rasterStep = 1; view.image = null; view.lastTerrainKey = ''; view.lastGeometryKey = ''; view.lastPlacementKey = ''; view.lastObjectKey = '';
    view.terrainRebuilds = view.terrainCacheHits = 0;
    return view;
  }
  refresh(lane, leader, actors, rank) {
    const r = this.renderer, world = r.world;
    let view = this.views.get(lane);
    if (!view) { view = this.createView(); this.views.set(lane, view); }
    const width = 128, imageWidth = Math.max(1, this.layout.tileWidth - 8), imageHeight = Math.max(1, this.layout.tileHeight - 30);
    const height = Math.max(32, Math.min(64, Math.round(width * imageHeight / imageWidth)));
    if (!view.image || view.buffer.width !== width || view.buffer.height !== height) {
      for (const canvas of [view.buffer, view.terrainBuffer, view.objectBuffer]) r.resources.resize(canvas, width, height);
      r.resources.replaceImage(view.terrainContext, width, height, view.imageKey, ({ image, pixels, key }) => { view.image = image; view.pixels = pixels; view.imageKey = key; }); view.lastTerrainKey = '';
    }
    view.viewWidth = width; view.viewHeight = height;
    const motionOriginKey = [this.director.revision, width, height, world.generation].join(':');
    if (r.motionPolicy?.automaticCamera !== false || view.motionOriginKey !== motionOriginKey) {
      view.originX = Math.max(0, Math.floor((leader?.x ?? world.stall.lanes[lane].maxX ?? 36) - width * 0.55));
      view.originY = lane * (world.laneHeight || 96) + Math.max(0, Math.min((world.laneHeight || 96) - height, Math.floor((leader?.y ?? lane * (world.laneHeight || 96) + 60) - lane * (world.laneHeight || 96) - height * 0.6)));
      view.motionOriginKey = motionOriginKey;
    }
    const geometry = [lane, view.originX, view.originY, width, height, world.generation].join(':');
    const terrainKey = geometry + ':' + world.terrainRevision + ':' + world.frontierRevision;
    if (terrainKey !== view.lastTerrainKey) { view._terrainPixels(width, height, geometry !== view.lastGeometryKey); view.lastTerrainKey = terrainKey; view.lastGeometryKey = geometry; }
    view.bufferContext.imageSmoothingEnabled = false; view.bufferContext.drawImage(view.terrainBuffer, 0, 0); view._drawObjects();
    let drawn = 0;
    if (leader) { const live = r.actorVisibility?.renderActor(leader.id) || (!r.actorVisibility ? leader : null); if (live) { live.render(view); drawn++; } }
    for (const actor of actors) if (drawn < 64 && actor !== leader && actor.x >= view.originX - 24 && actor.x <= view.originX + width + 24) { const live = r.actorVisibility?.renderActor(actor.id) || (!r.actorVisibility ? actor : null); if (live) { live.render(view); drawn++; } }
    view.leaderId = leader?.id ?? null; view.actionLabel = leader?.actionName?.toUpperCase() || leader?.action?.constructor?.name?.replace(/^Action|System$/g, '').toUpperCase() || ''; view.rank = rank; view.distance = Math.round(progress(world, lane)); view.drawn = drawn;
  }
  draw(context, dpr) {
    const r = this.renderer;
    if (!this.enabled || !r.overviewActive || !this.layout || !this.slots.length) return;
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
      const reason = (r.motionPolicy?.automaticCamera === false ? 'Motion held · ' : '') + (this.director.mode === 'director' ? this.director.reasons.get(lane) : 'Distance leader');
      context.font = 9 * dpr + 'px monospace'; context.fillText?.((this.director.pins.has(lane) ? '[PIN] ' : '') + reason, x * dpr, (y + 13) * dpr); context.font = 11 * dpr + 'px monospace';
      const imageWidth = Math.max(1, tileWidth - 8), imageHeight = Math.max(1, tileHeight - 30);
      // The integer raster may round or hit its cap. Fit it uniformly instead of stretching either axis.
      const scale = Math.min(imageWidth / view.buffer.width, imageHeight / view.buffer.height);
      const drawWidth = view.buffer.width * scale, drawHeight = view.buffer.height * scale;
      const drawX = x + (imageWidth - drawWidth) / 2, drawY = y + 25 + (imageHeight - drawHeight) / 2;
      context.drawImage(view.buffer, drawX * dpr, drawY * dpr, drawWidth * dpr, drawHeight * dpr); context.restore?.();
    }
    context.restore?.();
  }
  releaseView(lane) {
    const view = this.views.get(lane); if (!view) return;
    for (const canvas of [view.buffer, view.terrainBuffer, view.objectBuffer]) this.renderer.resources.release(canvas);
    this.renderer.resources.release(view.imageKey); this.renderer.resources.release(view.sceneryImageKey);
    view.image = view.pixels = view.bufferContext = view.terrainContext = view.objectContext = null;
    view.objectPlacements.length = 0; view.tileRevisions.clear(); this.views.delete(lane);
  }
  releaseViews() { for (const lane of this.views.keys()) this.releaseView(lane); this.lastStateKey = this.renderKey = ''; this.lastUpdateMs = -Infinity; }
  dispose() { this.onChange = null; this.releaseViews(); this.slots = []; this.director.reset(); }
}
export { ProcgenCctv, rankCctvLanes, selectCctvLanes, cctvLayout, CCTV_INTERVAL_MS, CCTV_MAX_WINDOWS };
