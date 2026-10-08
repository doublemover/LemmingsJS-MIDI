import { ProcgenCctv } from './ProcgenCctv.js';
import { DecorationLayer } from '../../decorations/DecorationLayer.js';
import { LANE_HEIGHT } from './ProcgenLaneWorld.js';
import { createProcgenCameraController } from './ProcgenCameraController.js';

class ProcgenLaneRenderer {
  constructor({ canvas, world, assets, windowRef = window }) {
    this.canvas = canvas; this.world = world; this.assets = assets; this.window = windowRef;
    this.context = canvas.getContext('2d', { alpha: false });
    this.buffer = canvas.ownerDocument.createElement('canvas'); this.bufferContext = this.buffer.getContext('2d', { alpha: false });
    this.terrainBuffer = canvas.ownerDocument.createElement('canvas'); this.terrainContext = this.terrainBuffer.getContext('2d', { alpha: false });
    this.objectBuffer = canvas.ownerDocument.createElement('canvas'); this.objectContext = this.objectBuffer.getContext('2d'); this.lastObjectKey = ''; this.lastPlacementKey = ''; this.objectPlacements = [];
    this.frames = new WeakMap(); this.objectFrames = new WeakMap();
    this.dotColors = new WeakMap(); this.actorDots = new Map(); this.objectDots = new Map();
    this.scale = 3; this.cameraX = 0; this.cameraY = 0; this.follow = true;
    this.image = null; this.lastTerrainKey = ''; this.lastGeometryKey = ''; this.tileRevisions = new Map(); this.lastFrameMs = 0; this.renderedActors = 0;
    this.rasterStep = 1; this.viewWidth = 0; this.viewHeight = 0;
    this.terrainRebuilds = 0; this.terrainCacheHits = 0;
    this.frameCacheHits = 0; this.lastFrameKey = null; this.lastAppearance = null; this.lastSprites = null; this.lastHud = null; this.lastHudSprites = null; this.lastDecorationLayer = null;
    this.camera = createProcgenCameraController(this);
    this.decorationLayer = assets.decorationPack ? new DecorationLayer(canvas.ownerDocument, assets.decorationPack) : null;
    this.reducedMotion = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.markerDash = [4, 4]; this.markerSolidDash = [];
    this.cctv = new ProcgenCctv(this);
  }
  resize() { this.lastTerrainKey = ''; this.lastGeometryKey = ''; this.render(); }
  _frameCanvas(frame) {
    let bitmap = this.frames.get(frame);
    if (!bitmap) {
      bitmap = this.canvas.ownerDocument.createElement('canvas'); bitmap.width = frame.width; bitmap.height = frame.height;
      const context = bitmap.getContext('2d'), pixels = context.createImageData(frame.width, frame.height);
      pixels.data.set(frame.getData());
      const mask = frame.getMask();
      for (let i = 0; i < mask.length; i++) if (!mask[i]) pixels.data[i * 4 + 3] = 0;
      context.putImageData(pixels, 0, 0); this.frames.set(frame, bitmap);
    }
    return bitmap;
  }
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
        if (color) this.actorDots.set(py * this.buffer.width + px, color);
      }
      return;
    }
    this.bufferContext.drawImage(this._frameCanvas(frame), Math.round((x + frame.offsetX - this.originX) / step),
      Math.round((y + frame.offsetY - this.originY) / step), frame.width / step, frame.height / step);
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
    const firstLane = Math.max(0, Math.floor(y0 / LANE_HEIGHT)), lastLane = Math.min(world.laneCount - 1, Math.floor((y0 + this.viewHeight) / LANE_HEIGHT));
    if (terrain) {
      const chunkWidth = terrain.chunkWidth;
      for (let lane = firstLane; lane <= lastLane; lane++) {
        const py0 = Math.max(0, Math.ceil((lane * LANE_HEIGHT - y0) / step)), py1 = Math.min(height, Math.ceil(((lane + 1) * LANE_HEIGHT - y0) / step));
        if (py0 >= py1) continue;
        const through = Math.min(x0 + this.viewWidth, world.generatedThrough[lane]);
        for (let cx = Math.floor(x0 / chunkWidth); cx * chunkWidth < through; cx++) {
          const px0 = Math.max(0, Math.ceil((cx * chunkWidth - x0) / step)), px1 = Math.min(width, Math.ceil((Math.min((cx + 1) * chunkWidth, through) - x0) / step));
          if (px0 >= px1) continue;
          const tileKey = lane * 0x800000 + cx, revision = world.terrainTileRevisions?.get(tileKey) || 0;
          const tileRevision = revision + ':' + Math.min(chunkWidth, through - cx * chunkWidth);
          if (!reset && this.tileRevisions.get(tileKey) === tileRevision) continue;
          this.tileRevisions.set(tileKey, tileRevision); dirty.push([px0, py0, px1 - px0, py1 - py0]);
          const seed = world.laneSeeds[lane], descriptor = step >= 8 ? terrain.describe(seed, cx) : null;
          const tile = descriptor ? null : terrain.getChunk(seed, cx, true).pixels;
          for (let py = py0; py < py1; py++) {
            const y = Math.floor(y0 + py * step), localY = y - lane * LANE_HEIGHT, row = localY * chunkWidth;
            const output = py * width;
            for (let px = px0; px < px1; px++) {
              const x = Math.floor(x0 + px * step), color = descriptor ? terrain.rasterSample(seed, cx, x - cx * chunkWidth, localY, descriptor) : tile[row + x - cx * chunkWidth];
              const edits = world.editChunks.get(world._editKey(x, y));
              const edit = edits?.[localY * 32 + x % 32] || 0;
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
        const y = Math.floor(y0 + py * step), lane = Math.floor(y / LANE_HEIGHT);
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
    const first = Math.max(0, Math.floor(this.originY / LANE_HEIGHT)), last = Math.min(world.laneCount - 1, Math.floor((this.originY + this.viewHeight) / LANE_HEIGHT));
    const laneStride = Math.max(1, Math.floor(step / LANE_HEIGHT)), chunkStride = Math.max(1, Math.floor(step / width));
    for (let lane = first; lane <= last; lane += laneStride) {
      const end = Math.min(this.originX + this.viewWidth, world.generatedThrough[lane]);
      for (let cx = Math.floor(this.originX / width); cx * width < end; cx += chunkStride) {
        // Decorative placement must never compose or evict collision chunks.
        const seed = world.laneSeeds[lane], descriptor = terrain.describe(seed, cx);
        const matchesTerrain = (x, y) => {
          const edits = world.editChunks.get(world._editKey(x, lane * LANE_HEIGHT + y));
          return !edits?.[y * 32 + x % 32] && terrain.solidSample(seed, cx, x - cx * width, y, descriptor);
        };
        for (const object of descriptor.objects) {
          if (object.x + object.piece.image.width + (object.role === 'liquid' ? 1 : 0) > world.generatedThrough[lane]) continue;
          if (object.supportY != null) {
            let supported = true;
            for (let dx = 0; dx < object.piece.image.width; dx++) if (!matchesTerrain(object.x + dx, object.supportY)) { supported = false; break; }
            if (!supported) continue;
          }
          const image = object.piece.image, px = (object.x - this.originX) / step, py = (lane * LANE_HEIGHT + object.y - this.originY) / step;
          const placement = { image, px, py, phase: object.phase, animation: object.animation, clip: null, clippedFrames: null };
          if (object.clipToTerrain) {
            placement.clip = new Uint8Array(image.width * image.height); placement.clippedFrames = new WeakMap();
            let visible = false;
            for (let dy = 0; dy < image.height; dy++) for (let dx = 0; dx < image.width; dx++) if (matchesTerrain(object.x + dx, object.y + dy)) {
              placement.clip[dy * image.width + dx] = 1; visible = true;
            }
            if (!visible) continue;
          }
          if (image.width < step && image.height < step) {
            const x = Math.floor(px), y = Math.floor(py);
            if (x >= 0 && y >= 0 && x < this.buffer.width && y < this.buffer.height) bins.set(y * this.buffer.width + x, placement);
          } else this.objectPlacements.push(placement);
        }
      }
    }
    for (const [dot, placement] of bins) this.objectPlacements.push({ ...placement, dot });
  }
  _drawObjects() {
    const world = this.world, terrain = world.terrain;
    if (!terrain?.objects.length) return;
    const key = `${this.lastGeometryKey}:${Math.floor(world.tickIndex / 4)}:${world.frontierRevision}:${world.terrainRevision}`;
    if (key === this.lastObjectKey) { this.bufferContext.drawImage(this.objectBuffer, 0, 0); return; }
    this.lastObjectKey = key; this._prepareObjectPlacements();
    const context = this.objectContext, step = this.rasterStep;
    context.clearRect?.(0, 0, this.objectBuffer.width, this.objectBuffer.height); context.imageSmoothingEnabled = false;
    this.objectDots.clear();
    for (const placement of this.objectPlacements) {
      const { image, phase, px, py, dot, clip } = placement, frame = image.frames[placement.animation === 'idle' ? 0 : (Math.floor(world.tickIndex / 4) + phase) % image.frames.length];
      if (dot != null) {
        let color = clip ? null : this.dotColors.get(frame);
        if (color == null) {
          const ci = frame.find((value, index) => !(value & 128) && (!clip || clip[index])); color = ci == null ? 0 : image.palette.getColor(ci) | 0xff000000;
          if (!clip) this.dotColors.set(frame, color);
        }
        if (color) this.objectDots.set(dot, color);
        continue;
      }
      const frameCache = placement.clippedFrames || this.objectFrames;
      let bitmap = frameCache.get(frame);
      if (!bitmap) {
        bitmap = this.canvas.ownerDocument.createElement('canvas'); bitmap.width = image.width; bitmap.height = image.height;
        const ctx = bitmap.getContext('2d'), data = ctx.createImageData(image.width, image.height), rgba = new Uint32Array(data.data.buffer);
        for (let i = 0; i < frame.length; i++) if (!(frame[i] & 128) && (!clip || clip[i])) rgba[i] = image.palette.getColor(frame[i]) | 0xff000000;
        ctx.putImageData(data, 0, 0); frameCache.set(frame, bitmap);
      }
      context.drawImage(bitmap, px, py, image.width / step, image.height / step);
    }
    this._flushDots(this.objectDots, context); this.bufferContext.drawImage(this.objectBuffer, 0, 0);
  }
  _drawPreviousDistances(dpr) {
    const context = this.context, sx = this.canvas.width / this.viewWidth;
    const screenHeight = this.canvas.height - (Number(this.overviewBandHeight) || 0) * dpr;
    const sy = screenHeight / this.viewHeight;
    const first = Math.max(0, Math.floor(this.originY / LANE_HEIGHT));
    const last = Math.min(this.world.laneCount - 1, Math.floor((this.originY + this.viewHeight) / LANE_HEIGHT));
    this.markerDash[0] = this.markerDash[1] = 4 * dpr;
    context.save?.(); context.lineCap = 'butt';
    for (let lane = first; lane <= last; lane++) {
      const previous = this.world.stall.lanes[lane].previousDistance;
      const x = (previous + 36 - this.originX) * sx;
      if (previous <= 0 || x < 0 || x >= this.canvas.width) continue;
      const y0 = Math.max(0, (lane * LANE_HEIGHT - this.originY) * sy);
      const y1 = Math.min(screenHeight, ((lane + 1) * LANE_HEIGHT - this.originY) * sy);
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
    const start = this.window.performance?.now?.() ?? 0;
    this.cctv.prepare(); this.camera.update(false, !force);
    const dpr = Math.min(2, this.window.devicePixelRatio || 1), scale = this.scale * dpr;
    this.rasterStep = Math.max(1, 1 / scale);
    const mainHeight = Math.max(1, this.canvas.height - (this.overviewBandHeight || 0) * dpr);
    const width = Math.max(1, Math.ceil(this.canvas.width / Math.max(1, scale))), height = Math.max(1, Math.ceil(mainHeight / Math.max(1, scale)));
    this.viewWidth = width * this.rasterStep; this.viewHeight = height * this.rasterStep;
    this.originX = Math.floor(this.cameraX / this.rasterStep) * this.rasterStep;
    this.originY = Math.floor(this.cameraY / this.rasterStep) * this.rasterStep;
    const world = this.world, sprites = world.sprites, appearance = sprites?.activePreference || sprites?.getPreference?.();
    const geometryKey = `${this.originX}:${this.originY}:${width}:${height}:${this.rasterStep}:${world.generation}`;
    const frameKey = `${geometryKey}:${world.tickIndex}:${world.terrainRevision}:${world.frontierRevision}:${this.canvas.width}:${this.canvas.height}:${dpr}:${this.scale}:${this.cameraY}:${this.follow}:${!!this.reducedMotion?.matches}:${this.cctv.renderKey}:${!!this.overviewActive}`;
    if (!force && frameKey === this.lastFrameKey && appearance === this.lastAppearance && sprites === this.lastSprites && this.hud === this.lastHud && this.hud?.sprites === this.lastHudSprites && this.decorationLayer === this.lastDecorationLayer) {
      this.frameCacheHits++; this.lastFrameMs = (this.window.performance?.now?.() ?? start) - start;
      return false;
    }
    if (!this.image || this.buffer.width !== width || this.buffer.height !== height) {
      this.buffer.width = this.terrainBuffer.width = this.objectBuffer.width = width;
      this.buffer.height = this.terrainBuffer.height = this.objectBuffer.height = height; this.lastObjectKey = ''; this.lastPlacementKey = '';
      this.image = this.terrainContext.createImageData(width, height); this.pixels = new Uint32Array(this.image.data.buffer); this.lastTerrainKey = ''; this.lastGeometryKey = '';
    }
    const key = `${geometryKey}:${this.world.terrainRevision}`;
    if (key !== this.lastTerrainKey) {
      this._terrainPixels(width, height, geometryKey !== this.lastGeometryKey);
      this.lastTerrainKey = key; this.lastGeometryKey = geometryKey;
    }
    else this.terrainCacheHits++;
    this.bufferContext.imageSmoothingEnabled = false;
    this.bufferContext.drawImage(this.terrainBuffer, 0, 0);
    this.decorationLayer?.draw(this, !!this.reducedMotion?.matches);
    this._drawObjects();
    this.renderedActors = 0; this.actorDots.clear();
    for (const actor of this.world.actors) {
      if (actor.failureReason) continue;
      if (actor.y < this.originY - 32 || actor.y > this.originY + this.viewHeight + 32 || actor.x < this.originX - 32 || actor.x >= this.originX + this.viewWidth + 32) {
        const bounds = actor.action?.spriteProvider?.getActorDrawBounds?.(actor);
        if (!bounds || bounds.x >= this.originX + this.viewWidth || bounds.y >= this.originY + this.viewHeight || bounds.x + bounds.width <= this.originX || bounds.y + bounds.height <= this.originY) continue;
      }
      actor.render(this); this.renderedActors++;
    }
    this._flushDots(this.actorDots);
    this.world.characterParticles?.render(this);
    this.context.imageSmoothingEnabled = false;
    this.context.drawImage(this.buffer, 0, 0, this.canvas.width, mainHeight);
    this._drawPreviousDistances(dpr);
    this.hud?.render(this.context, this.world, this.camera, dpr);
    this.cctv.draw(this.context, dpr);
    this.lastFrameKey = frameKey; this.lastAppearance = appearance; this.lastSprites = sprites; this.lastHud = this.hud; this.lastHudSprites = this.hud?.sprites; this.lastDecorationLayer = this.decorationLayer;
    this.lastFrameMs = (this.window.performance?.now?.() ?? start) - start;
    return true;
  }
  dispose() { this.camera.dispose(); this.cctv.dispose(); this.decorationLayer = null; this.frames = new WeakMap(); this.objectFrames = new WeakMap();
    this.dotColors = new WeakMap(); this.actorDots = new Map(); this.objectDots = new Map(); this.image = null; this.pixels = null; this.lastFrameKey = null;
    this.lastAppearance = this.lastSprites = this.lastHud = this.lastHudSprites = this.lastDecorationLayer = null; }
}
export { ProcgenLaneRenderer };
