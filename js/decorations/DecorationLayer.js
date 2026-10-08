import { decorationPlacements } from './ProcgenDecorationPacks.js';

function* sampledIndices(first, last, stride) {
  for (let index = first; index <= last; index += stride) yield index;
  if (last >= first && (last - first) % stride) yield last;
}

class DecorationLayer {
  constructor(document, pack) {
    this.pack = pack; this.document = document;
    this.canvas = document.createElement('canvas'); this.context = this.canvas.getContext('2d');
    this.mask = document.createElement('canvas'); this.maskContext = this.mask.getContext('2d');
    this.frames = new WeakMap(); this.dotColors = new WeakMap(); this.key = ''; this.maskKey = '';
    this.lastPack = null; this.placementKey = ''; this.placements = []; this.trims = [];
  }
  bitmap(image, frame) {
    let bitmap = this.frames.get(frame);
    if (!bitmap) {
      bitmap = this.document.createElement('canvas'); bitmap.width = image.width; bitmap.height = image.height;
      const context = bitmap.getContext('2d'), data = context.createImageData(image.width, image.height), pixels = new Uint32Array(data.data.buffer);
      for (let i = 0; i < frame.length; i++) if (!(frame[i] & 128)) pixels[i] = image.palette.getColor(frame[i]) | 0xff000000;
      context.putImageData(data, 0, 0); this.frames.set(frame, bitmap);
    }
    return bitmap;
  }
  dotColor(image, frame) {
    if (this.dotColors.has(frame)) return this.dotColors.get(frame);
    const counts = new Uint32Array(128); let total = 0, r = 0, g = 0, b = 0;
    for (const index of frame) if (!(index & 128)) { counts[index]++; total++; }
    for (let i = 0; i < counts.length; i++) if (counts[i]) {
      const color = image.palette.getColor(i);
      r += (color & 255) * counts[i]; g += ((color >>> 8) & 255) * counts[i]; b += ((color >>> 16) & 255) * counts[i];
    }
    const color = total ? `rgb(${Math.round(r / total)},${Math.round(g / total)},${Math.round(b / total)})` : null;
    this.dotColors.set(frame, color); return color;
  }
  preparePlacements(renderer, key) {
    if (key === this.placementKey) return;
    const { world, buffer, rasterStep: step, originX, originY, viewWidth, viewHeight } = renderer;
    this.placements.length = 0; this.trims.length = 0;
    const bins = [new Map(), new Map()];
    // Include sprites anchored outside the view, including tall upward-facing art.
    const firstLane = Math.max(0, Math.floor((originY - this.maxHeight - 96) / 96));
    const lastLane = Math.min(world.laneCount - 1, Math.floor((originY + viewHeight + this.maxHeight) / 96));
    const firstChunk = Math.max(0, Math.floor((originX - this.maxWidth) / 128));
    // Sampling density follows output pixels, rather than world size or lane count.
    const laneStride = Math.max(1, Math.floor(step / 96)), chunkStride = Math.max(1, Math.floor(step / 128));
    for (const lane of sampledIndices(firstLane, lastLane, laneStride)) {
      const end = Math.min(originX + viewWidth + this.maxWidth, world.generatedThrough[lane]);
      for (const chunk of sampledIndices(firstChunk, Math.ceil(end / 128) - 1, chunkStride)) {
        for (const placement of decorationPlacements(this.pack, lane, chunk)) {
          const image = placement.piece.image, scale = placement.scale ?? 1;
          const width = image.width * scale / step, height = image.height * scale / step;
          const px = (placement.x - originX) / step, py = (lane * 96 + placement.y - originY) / step;
          if (width <= 0 || height <= 0 || px >= buffer.width || py >= buffer.height || px + width <= 0 || py + height <= 0) continue;
          const trim = placement.piece.placement === 'trim', target = trim ? this.trims : this.placements;
          const entry = { image, phase: placement.phase, px, py, width, height };
          if (width <= 1 && height <= 1) {
            entry.px = Math.max(0, Math.min(buffer.width - 1, Math.floor(px + width / 2)));
            entry.py = Math.max(0, Math.min(buffer.height - 1, Math.floor(py + height / 2)));
            entry.dot = true; bins[trim ? 1 : 0].set(entry.py * buffer.width + entry.px, entry);
          } else target.push(entry);
        }
      }
    }
    for (const entry of bins[0].values()) this.placements.push(entry);
    for (const entry of bins[1].values()) this.trims.push(entry);
    this.placementKey = key;
  }
  drawPlacements(placements, phase) {
    for (const { image, phase: offset, px, py, width, height, dot } of placements) {
      const frame = image.frames[(phase + offset) % image.frames.length];
      if (dot) {
        const color = this.dotColor(image, frame);
        if (color) { this.context.fillStyle = color; this.context.fillRect(px, py, 1, 1); }
      } else this.context.drawImage(this.bitmap(image, frame), px, py, Math.max(1, width), Math.max(1, height));
    }
  }
  draw(renderer, reducedMotion = false) {
    const { world, buffer, rasterStep: step, originX, originY, viewWidth, viewHeight } = renderer;
    if (this.pack !== this.lastPack) {
      this.lastPack = this.pack; this.frames = new WeakMap(); this.dotColors = new WeakMap(); this.key = ''; this.placementKey = '';
      this.maxWidth = 0; this.maxHeight = 0;
      for (const { image } of this.pack.pieces) {
        this.maxWidth = Math.max(this.maxWidth, image.width); this.maxHeight = Math.max(this.maxHeight, image.height);
      }
    }
    const geometryKey = `${originX}:${originY}:${viewWidth}:${viewHeight}:${step}:${buffer.width}:${buffer.height}:${world.generation}:${world.laneCount}`;
    const maskKey = `${renderer.lastTerrainKey}:${geometryKey}`;
    const phase = reducedMotion ? 0 : Math.floor(world.tickIndex / (this.pack.tickDivisor || 4));
    const placementKey = `${geometryKey}:${world.frontierRevision}`;
    const key = `${maskKey}:${phase}:${!!reducedMotion}:${world.frontierRevision}`;
    if (key !== this.key) {
      if (this.canvas.width !== buffer.width || this.canvas.height !== buffer.height) {
        this.canvas.width = this.mask.width = buffer.width; this.canvas.height = this.mask.height = buffer.height; this.maskKey = '';
      }
      if (maskKey !== this.maskKey) {
        const data = this.maskContext.createImageData(buffer.width, buffer.height), pixels = new Uint32Array(data.data.buffer);
        for (let i = 0; i < pixels.length; i++) if (renderer.pixels[i] !== 0xff0e0807) pixels[i] = 0xff000000;
        this.maskContext.putImageData(data, 0, 0); this.maskKey = maskKey;
      }
      const context = this.context;
      context.clearRect(0, 0, buffer.width, buffer.height); context.imageSmoothingEnabled = false;
      this.preparePlacements(renderer, placementKey); this.drawPlacements(this.placements, phase);
      // Preserve the complete terrain silhouette and player route in front of art.
      context.globalCompositeOperation = 'destination-out'; context.drawImage(this.mask, 0, 0); context.globalCompositeOperation = 'source-over';
      this.drawPlacements(this.trims, phase);
      this.key = key;
    }
    renderer.bufferContext.drawImage(this.canvas, 0, 0);
  }
}
export { DecorationLayer };
