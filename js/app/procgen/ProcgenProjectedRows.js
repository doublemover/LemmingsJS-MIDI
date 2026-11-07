import { ProcgenActorEffectPass } from './ProcgenActorEffectPass.js';
import { MAX_RENDER_DIMENSION } from './ProcgenRenderResources.js';

class ProcgenProjectedRows {
  constructor(renderer) { this.renderer = renderer; this.views = []; this.entities = []; this.active = false; }
  createView() {
    const r = this.renderer, view = Object.create(r), created = [];
    try {
      for (const [canvas, context, alpha] of [['buffer', 'bufferContext', false], ['terrainBuffer', 'terrainContext', false], ['objectBuffer', 'objectContext', true]]) {
        view[canvas] = r.resources.canvas(); created.push(view[canvas]); view[context] = view[canvas].getContext('2d', { alpha });
        if (!view[context]) throw new Error('Projected lane canvas context unavailable.');
      }
      view.imageKey = {}; view.sceneryImageKey = {}; view.sceneryBuffer = view.sceneryContext = view.sceneryImage = view.sceneryPixels = null;
      view.image = null; view.tileRevisions = new Map(); view.actorDots = new Map(); view.objectDots = new Map(); view.objectPlacements = [];
      view.presentedActorBounds = new Map(); view.presentationEntities = []; view.presentation = r.presentation; view.actorEffects = r.actorEffects;
      view.actorEffectPass = new ProcgenActorEffectPass(view); view.actorEffectPass.outlines = r.actorEffectPass.outlines;
      view._effectActor = view._presentationActor = null; view.lastTerrainKey = view.lastGeometryKey = view.lastPlacementKey = view.lastObjectKey = view.lastSceneryKey = '';
      view.terrainCacheHits = view.terrainRebuilds = 0; return view;
    } catch (error) { for (const canvas of created) r.resources.release(canvas); throw error; }
  }
  releaseView(view) {
    const resources = this.renderer.resources;
    for (const key of [view.buffer, view.terrainBuffer, view.objectBuffer, view.sceneryBuffer, view.imageKey, view.sceneryImageKey]) if (key) resources.release(key);
    view.actorEffectPass.dispose(); view.image = view.pixels = view.sceneryImage = view.sceneryPixels = null;
    view.objectPlacements.length = 0; view.presentedActorBounds.clear(); view.tileRevisions.clear();
  }
  clear() { for (const view of this.views) this.releaseView(view); this.views.length = 0; this.entities.length = 0; this.active = false; }
  render(layout, start, force) {
    const r = this.renderer, world = r.world, dpr = r.presentationDpr, indices = layout.laneIndices;
    if (!this.active) {
      for (const canvas of [r.buffer, r.terrainBuffer, r.objectBuffer, r.sceneryBuffer]) if (canvas) r.resources.resize(canvas, 1, 1);
      r.resources.release(r.imageKey); r.resources.release(r.sceneryImageKey); r.imageKey = {}; r.sceneryImageKey = {}; r.image = r.pixels = r.sceneryImage = r.sceneryPixels = null;
      r.lastTerrainKey = r.lastGeometryKey = r.lastObjectKey = r.lastPlacementKey = r.lastSceneryKey = ''; this.active = true;
    }
    while (this.views.length > layout.count) this.releaseView(this.views.pop());
    const keys = this.views.flatMap(view => [view.buffer, view.terrainBuffer, view.objectBuffer, view.sceneryBuffer, view.imageKey, view.sceneryImageKey]).filter(Boolean);
    const available = r.resources.budgetBytes - r.resources.bytes + r.resources.cacheBytes + r.resources.bytesFor(keys), bytesPerPixel = 16 + (world.scenery ? 8 : 0) + (r.decorationLayer ? 12 : 0);
    let step = Math.max(1, r.qualityDivisor), width = Math.max(1, Math.ceil(r.canvas.width / (r.scale * dpr * step))), height = Math.max(1, Math.ceil(r.laneHeight / step));
    while ((width > MAX_RENDER_DIMENSION || height > MAX_RENDER_DIMENSION || width * height * layout.count * bytesPerPixel > available) && step < 256) {
      step *= 2; width = Math.max(1, Math.ceil(r.canvas.width / (r.scale * dpr * step))); height = Math.max(1, Math.ceil(r.laneHeight / step));
    }
    r.rasterStep = step; r.viewWidth = width * step; r.viewHeight = height * step * layout.count; r.originX = Math.floor(r.cameraX / step) * step; r.originY = (indices[0] || 0) * r.laneHeight;
    const appearance = world.sprites?.activePreference || world.sprites?.getPreference?.(), key = ['rows', indices.join(','), r.originX, width, height, step, r.canvas.width, r.canvas.height, r.scale,
      layout.rowHeight, layout.stripHeight, world.generation, world.tickIndex, world.terrainRevision, world.frontierRevision, world.hazards?.revision || 0, world.scenery?.revision || 0,
      r.motionPolicy.revision, r.presentation.demandRevision, r.presentation.domKey(), r.selectionRevision, r.actorEffects.frameKey(start, r.effectVisibleActors)].join(':');
    if (!force && r.lastFrameKey === key && r.lastAppearance === appearance && r.lastSprites === world.sprites && r.lastDecorationLayer === r.decorationLayer) { r.frameCacheHits++; r.lastFrameMs = (r.window.performance?.now?.() ?? start) - start; return false; }
    r.context.imageSmoothingEnabled = false; r.context.fillStyle = '#101927'; r.context.fillRect(0, 0, r.canvas.width, r.canvas.height);
    r.effectVisibleActors.clear(); r.effectTelemetryActors.clear(); r.presentedActorBounds.clear(); r.renderedActors = 0; this.entities.length = 0;
    r.workstationRows = []; layout.scale = r.scale; layout.rowSourceY = []; const entities = new Map(), lease = r.actorVisibility.acquireSnapshot();
    try {
      for (let row = 0; row < layout.count; row++) {
        const lane = indices[row]; let view = this.views[row]; if (!view) { view = this.createView(); this.views.push(view); }
        view.rasterStep = step; view.viewWidth = r.viewWidth; view.viewHeight = height * step; view.originX = r.originX; view.originY = lane * r.laneHeight; view._effectPresentationMs = start;
        if (!view.image || view.buffer.width !== width || view.buffer.height !== height) {
          for (const canvas of [view.buffer, view.terrainBuffer, view.objectBuffer]) r.resources.resize(canvas, width, height);
          r.resources.replaceImage(view.terrainContext, width, height, view.imageKey, ({ image, pixels, key }) => { view.image = image; view.pixels = pixels; view.imageKey = key; });
          view.lastTerrainKey = view.lastGeometryKey = view.lastPlacementKey = view.lastObjectKey = '';
        }
        const geometry = [view.originX, view.originY, width, height, step, world.generation].join(':'), terrain = geometry + ':' + world.terrainRevision + ':' + world.frontierRevision;
        if (terrain !== view.lastTerrainKey) { const previous = view.terrainRebuilds; view._terrainPixels(width, height, geometry !== view.lastGeometryKey); r.terrainRebuilds += view.terrainRebuilds - previous; view.lastTerrainKey = terrain; view.lastGeometryKey = geometry; } else r.terrainCacheHits++;
        view.bufferContext.imageSmoothingEnabled = false; view.bufferContext.drawImage(view.terrainBuffer, 0, 0); view._drawScenery(terrain, width, height); r.decorationLayer?.draw(view, !!r.reducedMotion?.matches); view._drawObjects();
        view.actorDots.clear(); view.presentedActorBounds.clear(); const padding = r.actorEffects.mailboxes.size ? 64 : 32;
        for (const actor of r.actorVisibility.query(view.originY - padding, view.viewHeight + padding * 2, false)) {
          if (actor.failureReason || actor.removed || actor.x < view.originX - padding || actor.x > view.originX + view.viewWidth + padding) continue;
          view._presentationActor = r.presentation.entitiesDemanded ? actor : null;
          try { actor.render(view); r.renderedActors++; } finally { view._presentationActor = null; }
        }
        view._flushDots(view.actorDots); world.characterParticles?.render(view);
        let leader = null;
        for (const actor of r.actorVisibility.physicalActors(lane)) if (!actor.failureReason && !actor.removed && actor.x >= r.originX && actor.x < r.originX + r.viewWidth && (!leader || actor.x > leader.x || actor.x === leader.x && actor.id < leader.id)) leader = actor;
        const availableHeight = Math.max(1, layout.rowHeight - layout.stripHeight), crop = Math.min(r.laneHeight, availableHeight / r.scale);
        const focus = r.inspectionRowAnchor?.lane === lane ? r.inspectionRowAnchor.worldY - lane * r.laneHeight : leader ? leader.y - lane * r.laneHeight : r.laneHeight - 25;
        const sourceY = Math.max(0, Math.min(r.laneHeight - crop, focus - crop * 0.6)); layout.rowSourceY[row] = sourceY;
        r.workstationRows.push({ lane, sourceY: lane * r.laneHeight + sourceY, sourceHeight: crop, destinationY: row * layout.rowHeight, destinationHeight: crop * r.scale });
        r.context.drawImage(view.buffer, 0, sourceY / step, width, crop / step, 0, row * layout.rowHeight * dpr, r.canvas.width, crop * r.scale * dpr);
        if (r.presentation.entitiesDemanded) for (const entity of view._worldInspectionEntities()) if (!entities.has(entity.id)) entities.set(entity.id, entity);
        for (const [actor, bounds] of view.presentedActorBounds) r.presentedActorBounds.set(actor, bounds);
      }
    } finally { lease?.release(); }
    this.entities.push(...entities.values()); r.onWorkstationFrame?.();
    if (r.presentation.demanded) r.presentation.publish(r.presentation.entitiesDemanded ? this.entities : [], snapshot => { if (r.presentation.entitiesDemanded) r._drawWorldInspection(snapshot); });
    r.lastFrameKey = key; r.lastAppearance = appearance; r.lastSprites = world.sprites; r.lastDecorationLayer = r.decorationLayer; r.lastFrameMs = (r.window.performance?.now?.() ?? start) - start; return true;
  }
  dispose() { this.clear(); this.renderer = null; }
}

export { ProcgenProjectedRows };
