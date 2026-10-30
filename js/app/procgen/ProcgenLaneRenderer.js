import { ProcgenActorVisibility, registerProcgenActorVisibility } from './ProcgenActorVisibility.js';
import { ProcgenCctv } from './ProcgenCctv.js';
import { DecorationLayer } from '../../decorations/DecorationLayer.js';
import { createProcgenCameraController } from './ProcgenCameraController.js';
import { ProcgenRenderResources, MAX_RENDER_DIMENSION } from './ProcgenRenderResources.js';
import { ProcgenObjectPlacementCache } from './ProcgenObjectPlacementCache.js';
import { ProcgenActorEffectDisplay } from './ProcgenActorEffectDisplay.js';
import { ProcgenActorEffectPass } from './ProcgenActorEffectPass.js';
import { ProcgenPresentationHost } from './ProcgenPresentationHost.js';
import { ProcgenProjectedRows } from './ProcgenProjectedRows.js';
import { peekProcgenTileRevision } from './ProcgenTerrainRetention.js';
import { createInstrumentMotionPolicy } from '../resources/InstrumentMotionPolicy.js';

const unprepared = state => state?.complete === false && state.active?.length === 0 && !state.plan;

class ProcgenLaneRenderer {
  constructor({ canvas, world, assets, windowRef = window, renderBudget, deferPresentation = false }) {
    this.actorVisibility = new ProcgenActorVisibility(world, { budgetAdapter: renderBudget?.budgetAdapter });
    registerProcgenActorVisibility(world, this.actorVisibility);
    this.canvas = canvas; this.world = world; this.assets = assets; this.window = windowRef;
    this.surfaceWidth = canvas.width; this.surfaceHeight = canvas.height;
    this.resources = new ProcgenRenderResources(canvas.ownerDocument, renderBudget);
    try {
      this.objectTileCache = new ProcgenObjectPlacementCache(world, this.resources);
      this.motionPolicy = createInstrumentMotionPolicy({ document: canvas.ownerDocument, window: windowRef, budget: this.resources, maxTransitions: 1280 });
      this.presentation = new ProcgenPresentationHost(this); this.selectedWorldEntityId = null; this.selectionRevision = 0;
      this.projectedRows = new ProcgenProjectedRows(this);
      this.actorEffects = new ProcgenActorEffectDisplay({ budget: this.resources, motionPolicy: this.motionPolicy }); this.actorEffectPass = new ProcgenActorEffectPass(this); this._effectActor = null; this.effectVisibleActors = new Set(); this.effectTelemetryActors = new Set();
      this.presentedActorBounds = new Map(); this.presentationEntities = []; this._presentationActor = null;
      this.buffer = this.resources.canvas(); this.terrainBuffer = this.resources.canvas(); this.objectBuffer = this.resources.canvas();
      this.imageKey = {}; this.sceneryImageKey = {}; this.lifecycleState = 'recovering'; this.recoveryAttempts = 0; this.recoveryLimit = 3; this.nextRecoveryMs = 0; this.qualityDivisor = 1;
      this.contextListeners = []; this.pendingContextListeners = []; this.presentationActive = false;
      this.lastObjectKey = ''; this.lastPlacementKey = ''; this.objectPlacements = [];
      this.frames = new WeakMap(); this.objectFrames = new WeakMap();
      this.dotColors = new WeakMap(); this.actorDots = new Map(); this.objectDots = new Map();
      this.scale = 3; this.cameraX = 0; this.cameraY = 0; this.follow = true;
      this.image = null; this.lastTerrainKey = ''; this.lastGeometryKey = ''; this.tileRevisions = new Map(); this.lastFrameMs = 0; this.renderedActors = 0;
      this.rasterStep = 1; this.viewWidth = 0; this.viewHeight = 0;
      this.terrainRebuilds = 0; this.terrainCacheHits = 0;
      this.frameCacheHits = 0; this.lastFrameKey = null; this.lastAppearance = null; this.lastSprites = null; this.lastHud = null; this.lastHudSprites = null; this.lastDecorationLayer = null;
      this.camera = createProcgenCameraController(this, { deferBinding: deferPresentation });
      this.decorationLayer = assets.decorationPack ? new DecorationLayer(canvas.ownerDocument, assets.decorationPack, this.resources) : null;
      this.reducedMotion = this.motionPolicy;
      this.releaseMotion = this.motionPolicy.subscribe(() => {
        if (!this.presentationActive || this.lifecycleState !== 'ready' || this.window.document?.hidden === true) return;
        this.camera?.resetPresentationClock(); this.lastFrameKey = null;
        if (!this.world._stepping || this.world._musicCompletedTick === this.world.tickIndex) this.render(true);
      });
      this.markerDash = [4, 4]; this.markerSolidDash = [];
      this.cctv = new ProcgenCctv(this);
      const lost = event => { event.preventDefault?.(); if (this.lifecycleState !== 'disposed') this._failDisplay(new Error('Canvas context lost'), true); };
      const restored = () => { if (this.lifecycleState !== 'disposed') this.recover(); };
      this.resources.onContextLost = event => { event.preventDefault?.(); if (this.lifecycleState !== 'disposed') this._failDisplay(new Error('Canvas backing context lost')); };
      this.resources.onContextRestored = restored;
      this.pendingContextListeners = [['contextlost', lost], ['contextrestored', restored]];
      if (!deferPresentation) this.activatePresentation();
      this._acquireContexts();
    } catch (error) {
      this.actorEffects?.dispose(); this.releaseMotion?.(); this.motionPolicy?.dispose(); this.actorEffectPass?.dispose(); this.actorVisibility.dispose(); this.camera?.dispose(); this.cctv?.dispose(); this.decorationLayer?.dispose(); this.objectTileCache?.dispose(); if (this.presentationActive) this.resources.release(canvas); this.resources.dispose();
      throw error;
    }
  }
  activatePresentation() {
    if (this.lifecycleState === 'disposed') return false;
    if (this.presentationActive) return true;
    if (!this.camera.activate()) return false;
    for (const [event, listener] of this.pendingContextListeners) { this.canvas.addEventListener?.(event, listener); this.contextListeners.push([event, listener]); }
    this.pendingContextListeners.length = 0; this.presentationActive = true; if (this.canvas.dataset) this.canvas.dataset.displayState = this.lifecycleState; return true;
  }
  getPresentationState() {
    const snapshot = this.presentation.getSnapshot();
    return Object.freeze({ ...this.presentation.getStatus(), generation: snapshot?.generation ?? null, physicalTick: snapshot?.physicalTick ?? null, projectionRevision: snapshot?.projectionRevision ?? null,
      contentRect: snapshot?.rect ?? null, logicalSize: snapshot?.logicalSize ?? null, backingSize: snapshot?.backingSize ?? null, capabilities: snapshot?.capabilities ?? Object.freeze({ inspect: false, edit: false }) });
  }
  get laneHeight() { return this.world.laneHeight || 96; }
  _acquireContexts() {
    try {
      for (const [canvas, key, opaque] of [[this.canvas, 'context', true], [this.buffer, 'bufferContext', true], [this.terrainBuffer, 'terrainContext', true], [this.objectBuffer, 'objectContext', false]]) {
        this[key] = canvas.getContext('2d', { alpha: !opaque });
        if (!this[key] || this[key].isContextLost?.()) throw new Error('Canvas 2D context unavailable');
      }
      this.actorEffects?.setVisible(!this.window.document?.hidden); this._displayState('ready'); return true;
    } catch (error) { this._failDisplay(error); return false; }
  }
  _displayState(state, error = null) {
    const reason = error ? String(error.message || error) : null, changed = state !== this.lifecycleState || reason !== this.displayError;
    this.lifecycleState = state; this.displayError = reason;
    if (this.presentationActive && this.canvas.dataset) this.canvas.dataset.displayState = state;
    try { if (changed) this.onDisplayState?.({ state, reason: this.displayError, attempts: this.recoveryAttempts }); } catch { /* Status listeners cannot break the display host. */ }
  }
  _releasePresentation() {
    this.presentation?.invalidate('The world display is preparing a new projection.');
    this.actorEffects?.clear({ profiles: false }); this.actorEffectPass?.reset(); this.effectVisibleActors?.clear(); this.effectTelemetryActors?.clear();
    for (const release of [() => this.projectedRows?.clear(), () => this.decorationLayer?.reset?.(), () => this.objectTileCache.clear(), () => this.cctv?.releaseViews()]) {
      try { release(); } catch { this.resources.retirementFailures++; }
    }
    this.resources.clear({ preserveKinds: ['effect-profile'] }); if (this.presentationActive) this.resources.release(this.canvas);
    this.image = this.pixels = this.sceneryImage = this.sceneryPixels = null;
    this.frames = new WeakMap(); this.objectFrames = new WeakMap(); this.dotColors = new WeakMap();
    this.objectPlacements.length = 0; this.tileRevisions.clear(); this.lastFrameKey = null;
    this.presentedActorBounds.clear(); this.presentationEntities.length = 0; this._presentationActor = null;
    this.lastTerrainKey = this.lastGeometryKey = this.lastObjectKey = this.lastPlacementKey = this.lastSceneryKey = '';
    this.sceneryBuffer = this.sceneryContext = null;
  }
  _failDisplay(error, lost = false) {
    if (this.lifecycleState === 'disposed') return;
    this.actorEffects?.setVisible(false); this._releasePresentation();
    this.nextRecoveryMs = (this.window.performance?.now?.() ?? Date.now()) + 250 * 2 ** this.recoveryAttempts;
    this._displayState(lost ? 'lost' : this.recoveryAttempts >= this.recoveryLimit ? 'unavailable' : 'recovering', error);
  }
  recover() {
    if (this.lifecycleState === 'disposed') return false;
    this.recoveryAttempts = 0; this.qualityDivisor = 1; this.nextRecoveryMs = 0;
    this._releasePresentation(); this.camera.resetPresentationClock?.();
    const ready = this._acquireContexts(); if (ready) this._displayState('ready'); return ready;
  }
  getDisplayState() { return { motion: this.motionPolicy?.getState() || null, projectedRowSurfaces: this.projectedRows?.views.length || 0, state: this.lifecycleState, reason: this.displayError, attempts: this.recoveryAttempts, qualityDivisor: this.qualityDivisor, ...this.resources.getStats() }; }
  resize(request = null) {
    if (!this.presentationActive) return false;
    if (this.lifecycleState === 'disposed') return false;
    if (request) {
      if (!Number.isSafeInteger(request.width) || request.width < 1 || !Number.isSafeInteger(request.height) || request.height < 1) throw new Error('Invalid requested display dimensions.');
      this.surfaceWidth = request.width; this.surfaceHeight = request.height; this.requestedSurface = true;
    }
    const key = `${this.requestedSurface ? this.surfaceWidth : this.canvas.width}:${this.requestedSurface ? this.surfaceHeight : this.canvas.height}:${this.window.devicePixelRatio}:${this.workstationLayout?.laneIndices?.join(',') || this.workstationLayout?.firstLane}:${this.workstationLayout?.count}:${this.workstationLayout?.rowHeight}:${this.workstationLayout?.stripHeight}`;
    if (key === this.lastResizeKey && this.canvas.width === this.managedWidth && this.canvas.height === this.managedHeight && this.lifecycleState === 'ready') return false;
    this.lastTerrainKey = ''; this.lastGeometryKey = '';
    const rendered = this.render(true); this.lastResizeKey = rendered ? key : null; return rendered;
  }
  _drawScenery(terrainKey, width, height) {
    const scenery = this.world.scenery; if (!scenery) return;
    if (!this.sceneryBuffer) {
      this.sceneryBuffer = this.resources.canvas(); this.sceneryContext = this.sceneryBuffer.getContext('2d');
      if (!this.sceneryContext) throw new Error('Scenery canvas context unavailable');
    }
    const reducedMotion = !!this.reducedMotion?.matches;
    const key = `${terrainKey}:${scenery.revision}:${reducedMotion}`;
    if (!this.sceneryImage || this.sceneryBuffer.width !== width || this.sceneryBuffer.height !== height) {
      this.resources.resize(this.sceneryBuffer, width, height);
      this.resources.replaceImage(this.sceneryContext, width, height, this.sceneryImageKey, ({ image, pixels, key }) => { this.sceneryImage = image; this.sceneryPixels = pixels; this.sceneryImageKey = key; }); this.lastSceneryKey = '';
    }
    if (key !== this.lastSceneryKey) {
      this.sceneryPixels.fill(0);
      const first = Math.max(0, Math.floor(this.originY / this.laneHeight)), last = Math.min(this.world.laneCount, Math.ceil((this.originY + this.viewHeight) / this.laneHeight));
      const drawPixel = (x, y, color) => {
        const px = Math.floor((x - this.originX) / this.rasterStep), py = Math.floor((y - this.originY) / this.rasterStep), index = py * width + px;
        if (px >= 0 && py >= 0 && px < width && py < height && this.pixels[index] === 0xff0e0807) this.sceneryPixels[index] = color;
      };
      for (let lane = first; lane < last; lane++) scenery.drawLane({ lane, left: this.originX, right: this.originX + this.viewWidth, top: this.originY, bottom: this.originY + this.viewHeight, drawPixel, reducedMotion });
      this.sceneryContext.putImageData(this.sceneryImage, 0, 0); this.lastSceneryKey = key;
    }
    this.bufferContext.drawImage(this.sceneryBuffer, 0, 0);
  }
  _frameCanvas(frame) {
    let bitmap = this.frames.get(frame);
    if (!bitmap) {
      bitmap = this.resources.canvas(); this.resources.resize(bitmap, frame.width, frame.height, { cache: true,
        retire: () => { this.frames.delete(frame); } });
      const context = bitmap.getContext('2d'); if (!context) throw new Error('Sprite canvas context unavailable');
      const key = {}, pixels = this.resources.image(context, frame.width, frame.height, key);
      try {
        pixels.data.set(frame.getData());
        const mask = frame.getMask();
        let visible = 0;
        for (let i = 0; i < mask.length; i++) { if (!mask[i]) pixels.data[i * 4 + 3] = 0; else if (pixels.data[i * 4 + 3]) visible++; }
        bitmap.procgenVisiblePixels = visible;
        context.putImageData(pixels, 0, 0); this.frames.set(frame, bitmap);
      } finally { this.resources.release(key); }
    }
    this.resources.touch(bitmap);
    return bitmap;
  }
  beginActorAction(actor) {
    if (this.effectTelemetryActors && this.effectTelemetryActors.size < 16) this.effectTelemetryActors.add(actor.id);
    const previous = this._effectActor;
    this._effectActor = this.actorEffects?.mailboxes.has(actor.id) && this.actorEffects.getProfile(actor.id, actor.patchId).enabled ? actor : null;
    if (this._effectActor) this.effectVisibleActors.add(actor.id);
    return previous;
  }
  endActorAction(previous) { this._effectActor = previous; }
  drawFrame(frame, x, y) {
    if (!frame) return;
    const step = this.rasterStep;
    if (frame.width < step && frame.height < step) {
      const px = Math.floor((x - this.originX) / step), py = Math.floor((y - this.originY) / step);
      if (px >= 0 && py >= 0 && px < this.buffer.width && py < this.buffer.height) {
        let color = this.dotColors.get(frame);
        if (color == null) {
          const counts = new Map(), data = new Uint32Array(frame.getData().buffer), mask = frame.getMask(); let best = 0;
          for (let i = 0; i < data.length; i++) if (mask[i]) {
            const count = (counts.get(data[i]) || 0) + 1; counts.set(data[i], count);
            if (count > best) { best = count; color = data[i]; }
          }
          this.dotColors.set(frame, color || 0);
        }
        if (color) { this.actorDots.set(py * this.buffer.width + px, color); if (this._presentationActor && Object.hasOwn(this, 'presentation')) this._captureActorBounds({ x: this.originX + px * step, y: this.originY + py * step, width: step, height: step }); }
      }
      return;
    }
    const bitmap = this._frameCanvas(frame);
    let effectDrawn = false;
    if (this._effectActor && Object.hasOwn(this, 'actorEffects')) {
      try { effectDrawn = this.actorEffectPass.draw(frame, bitmap, this._effectActor, x, y, this._effectPresentationMs); } catch { this.actorEffectPass.failures++; }
    }
    if (!effectDrawn) {
      this.bufferContext.drawImage(bitmap, Math.round((x + frame.offsetX - this.originX) / step),
        Math.round((y + frame.offsetY - this.originY) / step), frame.width / step, frame.height / step);
    }
    if (bitmap.procgenVisiblePixels) this._captureActorFrame(frame, x, y);
  }
  _captureActorFrame(frame, x, y) {
    if (!Object.hasOwn(this, 'presentation') || !this.presentation.entitiesDemanded || !this._presentationActor) return;
    const step = this.rasterStep;
    this._captureActorBounds({ x: this.originX + Math.round((x + (frame.offsetX || 0) - this.originX) / step) * step,
      y: this.originY + Math.round((y + (frame.offsetY || 0) - this.originY) / step) * step, width: frame.width, height: frame.height });
  }
  _captureActorBounds(bounds) {
    if (!Object.hasOwn(this, 'presentation') || !this.presentation.entitiesDemanded || !this._presentationActor) return;
    const actor = this._presentationActor, left = bounds.x, top = bounds.y, previous = this.presentedActorBounds.get(actor);
    const x1 = previous ? Math.min(left, previous.x) : left, y1 = previous ? Math.min(top, previous.y) : top;
    const x2 = previous ? Math.max(left + bounds.width, previous.x + previous.width) : left + bounds.width, y2 = previous ? Math.max(top + bounds.height, previous.y + previous.height) : top + bounds.height;
    this.presentedActorBounds.set(actor, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
  }
  setWorldSelection(id, { render = true } = {}) {
    if (this.lifecycleState === 'disposed' || this.selectedWorldEntityId === id) return false;
    this.selectedWorldEntityId = id; this.selectionRevision++; if (render) this.render(false); return true;
  }
  _worldInspectionEntities() {
    const world = this.world, entities = this.presentationEntities; entities.length = 0;
    for (const [actor, bounds] of this.presentedActorBounds) {
      entities.push({ id: `${world.generation}:actor:${actor.id}`, kind: 'actor', actorId: actor.id, lane: actor.laneIndex,
        label: `Actor ${actor.id} · lane ${(actor.laneIndex ?? 0) + 1}`, action: actor.action?.actionName || actor.action?.getActionName?.() || null, bounds });
      const contact = actor._physicalContactSpan;
      if (contact?.anchor && contact.lastObservedTick === world.tickIndex) entities.push({ id: `${world.generation}:contact:${contact.spanId}`, kind: 'contact', actorId: actor.id, lane: actor.laneIndex,
        label: `Support contact · actor ${actor.id}`, cause: 'Completed support cell', bounds: { x: contact.anchor.x - 1, y: contact.anchor.y - 1, width: 3, height: 3 } });
    }
    for (const placement of this.objectPlacements) if (placement.presented) entities.push({ id: `${world.generation}:object:${placement.lane}:${placement.chunk}:${placement.objectIndex}:${placement.sourceObjectId ?? ''}`,
      kind: 'object', lane: placement.lane, label: `${placement.role || 'Source object'} ${placement.sourceObjectId ?? placement.objectIndex} · lane ${placement.lane + 1}`,
      cause: placement.assemblyId ? `Source assembly ${placement.assemblyId}` : null, bounds: placement.dot != null ? { x: this.originX + placement.dot % this.buffer.width * this.rasterStep, y: this.originY + Math.floor(placement.dot / this.buffer.width) * this.rasterStep, width: this.rasterStep, height: this.rasterStep } : { x: placement.x, y: placement.y, width: placement.image.width, height: placement.image.height } });
    return entities;
  }
  _drawWorldInspection(snapshot) {
    const context = this.context, dpr = this.presentationDpr || 1;
    context.save?.(); context.imageSmoothingEnabled = false;
    for (const entity of snapshot.entities) {
      if (entity.kind === 'contact') {
        context.fillStyle = '#8ad8c7';
        for (const region of entity.regions) context.fillRect(region.x * dpr, region.y * dpr, Math.max(1, region.width * dpr), Math.max(1, region.height * dpr));
      }
      if (entity.id !== this.selectedWorldEntityId) continue;
      context.strokeStyle = '#ffe49a'; context.lineWidth = Math.max(1, dpr);
      for (const region of entity.regions) context.strokeRect?.(region.x * dpr, region.y * dpr, Math.max(1, region.width * dpr), Math.max(1, region.height * dpr));
      const region = entity.regions[0]; context.font = `${10 * dpr}px monospace`; context.fillStyle = '#ffe49a';
      context.fillText?.(entity.kind === 'actor' ? `#${entity.actorId}` : entity.kind.toUpperCase(), Math.max(0, region.x * dpr), Math.max(10 * dpr, region.y * dpr - 3 * dpr));
    }
    context.restore?.();
  }
  getGameViewRect() { return { x: this.originX, y: this.originY, w: this.viewWidth, h: this.viewHeight }; }
  drawParticlePixel(x, y, color, opacity) {
    const step = this.rasterStep, px = Math.round((x - this.originX) / step), py = Math.round((y - this.originY) / step);
    if (px < 0 || py < 0 || px >= this.buffer.width || py >= this.buffer.height) return;
    const context = this.bufferContext, alpha = context.globalAlpha;
    context.globalAlpha = opacity; context.fillStyle = `rgb(${color & 255},${(color >>> 8) & 255},${(color >>> 16) & 255})`;
    context.fillRect(px, py, 1 / step, 1 / step); context.globalAlpha = alpha;
  }
  _terrainPixels(width, height, reset = true) {
    const world = this.world, terrain = world.terrain, step = this.rasterStep, x0 = this.originX, y0 = this.originY;
    const pixels = this.pixels, dirty = [];
    if (reset || !terrain) { pixels.fill(0xff0e0807); this.tileRevisions.clear(); }
    const firstLane = Math.max(0, Math.floor(y0 / this.laneHeight)), lastLane = Math.min(world.laneCount - 1, Math.floor((y0 + this.viewHeight) / this.laneHeight));
    if (terrain) {
      const chunkWidth = terrain.chunkWidth;
      for (let lane = firstLane; lane <= lastLane; lane++) {
        const py0 = Math.max(0, Math.ceil((lane * this.laneHeight - y0) / step)), py1 = Math.min(height, Math.ceil(((lane + 1) * this.laneHeight - y0) / step));
        if (py0 >= py1) continue;
        const through = Math.min(x0 + this.viewWidth, world.generatedThrough[lane]);
        for (let cx = Math.floor(x0 / chunkWidth); cx * chunkWidth < through; cx++) {
          const px0 = Math.max(0, Math.ceil((cx * chunkWidth - x0) / step)), px1 = Math.min(width, Math.ceil((Math.min((cx + 1) * chunkWidth, through) - x0) / step));
          if (px0 >= px1) continue;
          const tileKey = lane * 0x800000 + cx, revision = peekProcgenTileRevision(world, tileKey);
          const materialization = world.terrainGrowth?.stateFor?.(lane, cx), hidden = unprepared(materialization);
          const tileRevision = revision + ':' + Math.min(chunkWidth, through - cx * chunkWidth) + ':' + (hidden ? 'unprepared' : materialization?.revision || 0);
          if (!reset && this.tileRevisions.get(tileKey) === tileRevision) continue;
          this.tileRevisions.set(tileKey, tileRevision); dirty.push([px0, py0, px1 - px0, py1 - py0]);
          const seed = world.laneSeeds[lane], descriptor = hidden ? null : step >= 8 || materialization ? materialization?.plan?.descriptor || terrain.describe(seed, cx) : null;
          const tile = hidden || descriptor ? null : terrain.getChunk(seed, cx, true).pixels;
          for (let py = py0; py < py1; py++) {
            const y = Math.floor(y0 + py * step), localY = y - lane * this.laneHeight, row = localY * chunkWidth;
            const output = py * width;
            for (let px = px0; px < px1; px++) {
              const x = Math.floor(x0 + px * step), color = hidden || x < world.leftEdgeX ? 0 : descriptor ? terrain.rasterSample(seed, cx, x - cx * chunkWidth, localY, descriptor, materialization) : tile[row + x - cx * chunkWidth];
              const editKey = world._editKey(x, y), editIndex = localY * 32 + x % 32;
              const edit = (world.editChunks.peekValue ? world.editChunks.peekValue(editKey, editIndex) : world.editChunks.get(editKey)?.[editIndex]) || 0;
              pixels[output + px] = 0xff0e0807;
              if (edit === 1) continue;
              if (edit === 4) pixels[output + px] = 0xff86cbea;
              else if (color) pixels[output + px] = color;
            }
          }
        }
      }
    } else {
      for (let py = 0; py < height; py++) {
        const y = Math.floor(y0 + py * step), lane = Math.floor(y / this.laneHeight);
        if (lane >= world.laneCount) break;
        const piece = this.assets.groundPieces[world.laneSeeds[lane] % Math.max(1, this.assets.groundPieces.length)];
        for (let px = 0; px < width; px++) {
          const x = Math.floor(x0 + px * step), color = world.groundColorAt(x, y);
          if (!color) continue;
          const ci = piece ? piece.frame[(y % piece.height) * piece.width + x % piece.width] : 1;
          pixels[py * width + px] = color === 3 ? 0xff86cbea : piece?.image?.palette?.getColor(ci & 128 ? 1 : ci) || 0xff5e8191;
        }
      }
    }
    if (reset || !terrain || dirty.length > 32) this.terrainContext.putImageData(this.image, 0, 0);
    else for (const rect of dirty) this.terrainContext.putImageData(this.image, 0, 0, ...rect);
    if (reset || !terrain || dirty.length) this.terrainRebuilds++;
    else this.terrainCacheHits++;
  }
  _flushDots(dots, context = this.bufferContext) {
    for (const [index, color] of dots) {
      context.fillStyle = `rgb(${color & 255},${(color >>> 8) & 255},${(color >>> 16) & 255})`;
      context.fillRect(index % this.buffer.width, Math.floor(index / this.buffer.width), 1, 1);
    }
  }
  _prepareObjectPlacements() {
    const world = this.world, terrain = world.terrain, width = terrain.chunkWidth, step = this.rasterStep;
    const key = `${this.lastGeometryKey}:${world.frontierRevision}:${world.terrainRevision}`;
    if (key === this.lastPlacementKey) return;
    this.lastPlacementKey = key; this.objectPlacements.length = 0;
    const bins = new Map();
    const first = Math.max(0, Math.floor(this.originY / this.laneHeight)), last = Math.min(world.laneCount - 1, Math.floor((this.originY + this.viewHeight) / this.laneHeight));
    const laneStride = Math.max(1, Math.floor(step / this.laneHeight)), chunkStride = Math.max(1, Math.floor(step / width));
    for (let lane = first; lane <= last; lane += laneStride) {
      const end = Math.min(this.originX + this.viewWidth, world.generatedThrough[lane]);
      for (let cx = Math.floor(this.originX / width); cx * width < end; cx += chunkStride) {
        if (unprepared(world.terrainGrowth?.stateFor?.(lane, cx))) continue;
        const descriptor = terrain.describe(world.laneSeeds[lane], cx);
        for (const shape of this.objectTileCache.get(lane, cx, descriptor)) {
          const placement = { ...shape, px: (shape.x - this.originX) / step, py: (shape.y - this.originY) / step };
          if (shape.image.width < step && shape.image.height < step) {
            const x = Math.floor(placement.px), y = Math.floor(placement.py);
            if (x >= 0 && y >= 0 && x < this.buffer.width && y < this.buffer.height) bins.set(y * this.buffer.width + x, placement);
          } else this.objectPlacements.push(placement);
        }
      }
    }
    for (const [dot, placement] of bins) this.objectPlacements.push({ ...placement, dot });
  }
  _drawObjects() {
    const world = this.world, terrain = world.terrain;
    if (!terrain?.objects.length) { this.objectPlacements.length = 0; return; }
    const key = `${this.lastGeometryKey}:${world.hazards?.ownerCount ? world.tickIndex : Math.floor(world.tickIndex / 4)}:${world.frontierRevision}:${world.terrainRevision}:${world.hazards?.revision || 0}`;
    if (key === this.lastObjectKey) { this.bufferContext.drawImage(this.objectBuffer, 0, 0); return; }
    this.lastObjectKey = key; this._prepareObjectPlacements();
    const context = this.objectContext, step = this.rasterStep;
    context.clearRect?.(0, 0, this.objectBuffer.width, this.objectBuffer.height); context.imageSmoothingEnabled = false;
    this.objectDots.clear();
    for (const placement of this.objectPlacements) {
      placement.presented = false;
      const { image, phase, px, py, dot, clip } = placement;
      const hazardEntry = world.hazards?.peek(placement.lane, placement.chunk, placement.objectIndex);
      const frame = hazardEntry ? world.hazards.getFrame(hazardEntry, world.tickIndex) : image.frames[placement.animation === 'idle' ? 0 : (Math.floor(world.tickIndex / 4) + phase) % image.frames.length];
      const ownedFrame = !!frame.getMask;
      if (dot != null) {
        let color = clip ? null : this.dotColors.get(frame);
        if (color == null) {
          if (ownedFrame) { const index = frame.getMask().findIndex(Boolean); color = index < 0 ? 0 : frame.getBuffer()[index]; }
          else { const ci = frame.find((value, index) => !(value & 128) && (!clip || clip[index])); color = ci == null ? 0 : image.palette.getColor(ci) | 0xff000000; }
          if (!clip) this.dotColors.set(frame, color);
        }
        if (color) { this.objectDots.set(dot, color); placement.presented = true; }
        continue;
      }
      if (ownedFrame) { const bitmap = this._frameCanvas(frame); context.drawImage(bitmap, px, py, image.width / step, image.height / step); placement.presented = !!bitmap.procgenVisiblePixels; continue; }
      const frameCache = placement.clippedFrames || this.objectFrames;
      let bitmap = frameCache.get(frame);
      if (!bitmap) {
        bitmap = this.resources.canvas(); this.resources.resize(bitmap, image.width, image.height, { cache: true,
          retire: () => { frameCache.delete(frame); } });
        const ctx = bitmap.getContext('2d'); if (!ctx) throw new Error('Object canvas context unavailable');
        const pixelKey = {}, data = this.resources.image(ctx, image.width, image.height, pixelKey), rgba = new Uint32Array(data.data.buffer);
        try {
          let visible = 0;
          for (let i = 0; i < frame.length; i++) if (!(frame[i] & 128) && (!clip || clip[i])) { rgba[i] = image.palette.getColor(frame[i]) | 0xff000000; visible++; }
          bitmap.procgenVisiblePixels = visible;
          ctx.putImageData(data, 0, 0); frameCache.set(frame, bitmap);
        } finally { this.resources.release(pixelKey); }
      }
      this.resources.touch(bitmap);
      context.drawImage(bitmap, px, py, image.width / step, image.height / step);
      placement.presented = !!bitmap.procgenVisiblePixels;
    }
    this._flushDots(this.objectDots, context); this.bufferContext.drawImage(this.objectBuffer, 0, 0);
  }
  _drawPreviousDistances(dpr) {
    const context = this.context, sx = this.canvas.width / this.viewWidth;
    const screenHeight = this.canvas.height - (Number(this.overviewBandHeight) || 0) * dpr;
    const sy = screenHeight / this.viewHeight;
    const first = Math.max(0, Math.floor(this.originY / this.laneHeight));
    const last = Math.min(this.world.laneCount - 1, Math.floor((this.originY + this.viewHeight) / this.laneHeight));
    this.markerDash[0] = this.markerDash[1] = 4 * dpr;
    context.save?.(); context.lineCap = 'butt';
    for (let lane = first; lane <= last; lane++) {
      const previous = this.world.stall.lanes[lane].previousDistance;
      const x = (previous + 36 - this.originX) * sx;
      if (previous <= 0 || x < 0 || x >= this.canvas.width) continue;
      const y0 = Math.max(0, (lane * this.laneHeight - this.originY) * sy);
      const y1 = Math.min(screenHeight, ((lane + 1) * this.laneHeight - this.originY) * sy);
      context.beginPath(); context.moveTo(Math.round(x), y0); context.lineTo(Math.round(x), y1);
      context.strokeStyle = '#000'; context.lineWidth = 2 * dpr; context.setLineDash?.(this.markerSolidDash); context.stroke();
      context.strokeStyle = '#fff'; context.lineWidth = dpr; context.setLineDash?.(this.markerDash);
      context.lineDashOffset = this.reducedMotion?.matches ? 0 : -(this.world.tickIndex % 32) * dpr / 2;
      context.stroke();
    }
    context.restore?.();
  }
  // Explicit requests redraw; the RAF loop may reuse a fully unchanged frame.
  render(force = true) {
    if (!this.presentationActive) return false;
    if (this.lifecycleState === 'disposed' || this.lifecycleState === 'lost' || this.lifecycleState === 'unavailable') return false;
    if (this.world._stepping && this.world._musicCompletedTick !== this.world.tickIndex) return false;
    const now = this.window.performance?.now?.() ?? Date.now();
    if (this.lifecycleState === 'recovering') {
      if (now < this.nextRecoveryMs) return false;
      this.recoveryAttempts++; this.qualityDivisor = 2 ** this.recoveryAttempts;
      if (!this._acquireContexts()) return false;
    }
    try {
      const rendered = this._render(force);
      if (rendered) this._displayState('ready');
      return rendered;
    } catch (error) { this._failDisplay(error); return false; }
  }
  _render(force) {
    const start = this.window.performance?.now?.() ?? Date.now();
    this._effectPresentationMs = start;
    if (this.actorEffects.epoch && (this.actorEffects.epoch.generation !== this.world.generation || this.actorEffects.epoch.worldId !== this.world.worldId)) this.actorEffects.invalidateEpoch();
    for (const actorId of this.actorEffects.mailboxes.keys()) if (!this.actorVisibility.actorById(actorId)) this.actorEffects.removeActor(actorId, { profile: true });
    if (!this.requestedSurface && this.canvas.width > 0 && this.canvas.height > 0 && (this.canvas.width !== this.managedWidth || this.canvas.height !== this.managedHeight)) { this.surfaceWidth = this.canvas.width; this.surfaceHeight = this.canvas.height; }
    if (!this.surfaceWidth || !this.surfaceHeight) return false;
    const mainLimit = Math.min(MAX_RENDER_DIMENSION / this.surfaceWidth, MAX_RENDER_DIMENSION / this.surfaceHeight,
      Math.sqrt(this.resources.budgetBytes / 3 / (this.surfaceWidth * this.surfaceHeight * 4)), 1);
    this.resources.resize(this.canvas, Math.max(1, Math.floor(this.surfaceWidth * mainLimit)), Math.max(1, Math.floor(this.surfaceHeight * mainLimit)), { observeContext: false });
    this.managedWidth = this.canvas.width; this.managedHeight = this.canvas.height;
    this.presentationDpr = Math.min(2, this.window.devicePixelRatio || 1) * mainLimit;
    this.cctv.prepare(start); this.camera.update(false, !force, start);
    const dpr = Math.min(2, this.window.devicePixelRatio || 1) * mainLimit, scale = this.scale * dpr;
    const layout = this.workstationLayout;
    if (layout?.mapped) return this.projectedRows.render(layout, start, force);
    if (this.projectedRows?.active) this.projectedRows.clear();
    this.rasterStep = (layout ? 1 : Math.max(1, 1 / scale)) * this.qualityDivisor;
    const mainHeight = Math.max(1, this.canvas.height - (this.overviewBandHeight || 0) * dpr);
    let width = Math.max(1, Math.ceil(this.canvas.width / scale / this.rasterStep)), height = layout ? Math.ceil(layout.count * this.laneHeight / this.rasterStep) : Math.max(1, Math.ceil(mainHeight / scale / this.rasterStep));
    const replacedBytes = this.resources.bytesFor([this.buffer, this.terrainBuffer, this.objectBuffer, this.sceneryBuffer, this.imageKey, this.sceneryImageKey, this.decorationLayer?.canvas, this.decorationLayer?.mask]);
    const rasterBudget = this.resources.budgetBytes - this.resources.bytes + this.resources.cacheBytes + replacedBytes;
    const bytesPerPixel = 16 + (this.world.scenery ? 8 : 0) + (this.decorationLayer ? 12 : 0);
    while ((width > MAX_RENDER_DIMENSION || height > MAX_RENDER_DIMENSION || width * height * bytesPerPixel > rasterBudget) && this.qualityDivisor < 256) {
      this.qualityDivisor *= 2; this.rasterStep *= 2;
      width = Math.max(1, Math.ceil(this.canvas.width / scale / this.rasterStep));
      height = layout ? Math.ceil(layout.count * this.laneHeight / this.rasterStep) : Math.max(1, Math.ceil(mainHeight / scale / this.rasterStep));
    }
    this.viewWidth = width * this.rasterStep; this.viewHeight = height * this.rasterStep;
    this.originX = Math.floor(this.cameraX / this.rasterStep) * this.rasterStep;
    this.originY = layout ? layout.firstLane * this.laneHeight : Math.floor(this.cameraY / this.rasterStep) * this.rasterStep;
    const world = this.world, sprites = world.sprites, appearance = sprites?.activePreference || sprites?.getPreference?.();
    const geometryKey = `${this.originX}:${this.originY}:${width}:${height}:${this.rasterStep}:${world.generation}:${layout?.mode || ''}:${layout?.rowHeight || 0}`;
    const frameKey = `${geometryKey}:${world.tickIndex}:${world.terrainRevision}:${world.frontierRevision}:${world.hazards?.revision || 0}:${world.scenery?.revision || 0}:${this.canvas.width}:${this.canvas.height}:${dpr}:${this.scale}:${this.cameraY}:${this.follow}:${!!this.reducedMotion?.matches}:${this.cctv.renderKey}:${!!this.overviewActive}:${this.midiSpanOverlay?.revision || 0}:${this.presentation.demandRevision}:${this.presentation.domKey()}:${this.selectionRevision}:${this.actorEffects.frameKey(start, this.effectVisibleActors)}`;
    if (!force && frameKey === this.lastFrameKey && appearance === this.lastAppearance && sprites === this.lastSprites && this.hud === this.lastHud && this.hud?.sprites === this.lastHudSprites && this.decorationLayer === this.lastDecorationLayer) {
      this.frameCacheHits++; this.lastFrameMs = (this.window.performance?.now?.() ?? start) - start;
      return false;
    }
    if (!this.image || this.buffer.width !== width || this.buffer.height !== height) {
      for (const canvas of [this.buffer, this.terrainBuffer, this.objectBuffer]) this.resources.resize(canvas, width, height);
      this.lastObjectKey = ''; this.lastPlacementKey = '';
      this.resources.replaceImage(this.terrainContext, width, height, this.imageKey, ({ image, pixels, key }) => { this.image = image; this.pixels = pixels; this.imageKey = key; }); this.lastTerrainKey = ''; this.lastGeometryKey = '';
    }
    const key = `${geometryKey}:${this.world.terrainRevision}`;
    if (key !== this.lastTerrainKey) {
      this._terrainPixels(width, height, geometryKey !== this.lastGeometryKey);
      this.lastTerrainKey = key; this.lastGeometryKey = geometryKey;
    }
    else this.terrainCacheHits++;
    this.bufferContext.imageSmoothingEnabled = false;
    this.bufferContext.drawImage(this.terrainBuffer, 0, 0);
    this._drawScenery(key, width, height);
    this.decorationLayer?.draw(this, !!this.reducedMotion?.matches);
    this._drawObjects();
    this.effectVisibleActors.clear(); this.effectTelemetryActors.clear(); this.renderedActors = 0; this.actorDots.clear(); this.presentedActorBounds.clear();
    const effectPadding = this.actorEffects.mailboxes.size ? 64 : 0;
    const actorLease = this.actorVisibility.acquireSnapshot();
    try {
      for (const actor of this.actorVisibility.query(this.originY - effectPadding, this.viewHeight + effectPadding * 2, false)) {
        if (actor.failureReason || actor.removed) continue;
        if (actor.y < this.originY - 32 || actor.y > this.originY + this.viewHeight + 32 || actor.x < this.originX - 32 || actor.x >= this.originX + this.viewWidth + 32) {
          const bounds = this.actorVisibility.bounds.get(actor), padding = this.actorEffectPass.paddingFor(actor, bounds);
          if (!bounds || bounds.x - padding >= this.originX + this.viewWidth || bounds.y - padding >= this.originY + this.viewHeight || bounds.x + bounds.width + padding <= this.originX || bounds.y + bounds.height + padding <= this.originY) continue;
        }
        this._presentationActor = this.presentation.entitiesDemanded ? actor : null;
        try { actor.render(this); this.renderedActors++; } finally { this._presentationActor = null; }
      }
    } finally { actorLease?.release(); }
    this._flushDots(this.actorDots);
    this.world.characterParticles?.render(this);
    this.context.imageSmoothingEnabled = false;
    if (layout) {
      this.context.fillStyle = '#101927'; this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      layout.scale = this.scale; layout.rowSourceY = []; this.workstationRows = [];
      const leaders = new Array(layout.count);
      for (let row = 0; row < layout.count; row++) for (const actor of this.actorVisibility.physicalActors(layout.firstLane + row)) {
        if (actor.failureReason || actor.removed || actor.x < this.originX || actor.x >= this.originX + this.viewWidth) continue;
        if (!leaders[row] || leaders[row].x < actor.x || leaders[row].x === actor.x && actor.id < leaders[row].id) leaders[row] = actor;
      }
      for (let row = 0; row < layout.count; row++) {
        const available = layout.rowHeight - layout.stripHeight, crop = Math.min(this.laneHeight, available / this.scale), lane = layout.firstLane + row;
        const focus = this.inspectionRowAnchor?.lane === lane ? this.inspectionRowAnchor.worldY - lane * this.laneHeight : leaders[row] ? leaders[row].y - lane * this.laneHeight : this.laneHeight - 25;
        const sourceY = Math.max(0, Math.min(this.laneHeight - crop, focus - crop * 0.6));
        layout.rowSourceY[row] = sourceY;
        this.workstationRows.push({ lane, sourceY: lane * this.laneHeight + sourceY, sourceHeight: crop, destinationY: row * layout.rowHeight, destinationHeight: crop * this.scale });
        this.context.drawImage(this.buffer, 0, (row * this.laneHeight + sourceY) / this.rasterStep, width, crop / this.rasterStep, 0, row * layout.rowHeight * dpr, this.canvas.width, crop * scale);
      }
      this.onWorkstationFrame?.();
    } else {
      this.context.drawImage(this.buffer, 0, 0, this.canvas.width, mainHeight);
      this._drawPreviousDistances(dpr);
      this.midiSpanOverlay?.draw(this.context, this, dpr);
      this.hud?.render(this.context, this.world, this.camera, dpr);
      this.cctv.draw(this.context, dpr);
    }
    if (this.presentation.demanded) this.presentation.publish(this.presentation.entitiesDemanded ? this._worldInspectionEntities() : [], snapshot => { if (this.presentation.entitiesDemanded) this._drawWorldInspection(snapshot); });
    this.lastFrameKey = frameKey; this.lastAppearance = appearance; this.lastSprites = sprites; this.lastHud = this.hud; this.lastHudSprites = this.hud?.sprites; this.lastDecorationLayer = this.decorationLayer;
    this.lastFrameMs = (this.window.performance?.now?.() ?? start) - start;
    return true;
  }
  dispose() { if (this.lifecycleState === 'disposed') return;
    this._displayState('disposed');
    for (const [event, listener] of this.contextListeners) this.canvas.removeEventListener?.(event, listener);
    this.contextListeners.length = 0; this.pendingContextListeners.length = 0;
    this.actorVisibility.dispose(); this.camera.dispose(); this._releasePresentation(); this.projectedRows.dispose(); this.actorEffects.dispose(); this.actorEffectPass.dispose(); this.releaseMotion?.(); this.motionPolicy.dispose(); this.presentation.dispose(); this.cctv.dispose(); this.decorationLayer?.dispose?.(); this.objectTileCache.dispose(); this.resources.dispose(); this.decorationLayer = null; this.midiSpanOverlay = null; this.frames = new WeakMap(); this.objectFrames = new WeakMap();
    this.dotColors = new WeakMap(); this.actorDots = new Map(); this.objectDots = new Map(); this.image = null; this.pixels = null; this.lastFrameKey = null;
    this.sceneryBuffer = this.sceneryContext = this.sceneryImage = this.sceneryPixels = null;
    this.lastAppearance = this.lastSprites = this.lastHud = this.lastHudSprites = this.lastDecorationLayer = null;
    this.onWorkstationFrame = this.onDisplayState = this.hud = this.world = this.assets = this.workstationLayout = this.workstationRows = null;
    this.context = this.bufferContext = this.terrainContext = this.objectContext = null; }
}
export { ProcgenLaneRenderer };
