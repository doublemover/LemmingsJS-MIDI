import { LANE_HEIGHT } from './ProcgenLaneWorld.js';

class ProcgenLaneRenderer {
  constructor({ canvas, world, assets, windowRef = window }) {
    this.canvas = canvas;
    this.world = world;
    this.assets = assets;
    this.window = windowRef;
    this.context = canvas.getContext('2d', { alpha: false });
    this.buffer = canvas.ownerDocument.createElement('canvas');
    this.bufferContext = this.buffer.getContext('2d', { alpha: false });
    this.frames = new WeakMap();
    this.scale = 3;
    this.cameraX = 0;
    this.cameraY = 0;
    this.follow = true;
    this.image = null;
    this.lastTerrainKey = '';
    this.lastFrameMs = 0;
    this.renderedActors = 0;
    this._drag = null;
    this._listeners = [];
    this._bind('wheel', event => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.scale = Math.max(1, Math.min(6, this.scale * (event.deltaY > 0 ? 0.9 : 1.1)));
      else this.cameraY += event.deltaY / this.scale;
      this.render();
    }, { passive: false });
    this._bind('pointerdown', event => { this._drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture?.(event.pointerId); });
    this._bind('pointermove', event => {
      if (!this._drag) return;
      this.cameraY -= (event.clientY - this._drag.y) / this.scale;
      this.cameraX = Math.max(0, this.cameraX - (event.clientX - this._drag.x) / this.scale);
      this.follow = false;
      this._drag = { x: event.clientX, y: event.clientY };
      this.render();
    });
    this._bind('pointerup', () => { this._drag = null; });
    this._bind('pointercancel', () => { this._drag = null; });
    this._bind('dblclick', () => { this.follow = true; });
  }
  _bind(name, handler, options) { this.canvas.addEventListener(name, handler, options); this._listeners.push([name, handler, options]); }
  resize() { this.lastTerrainKey = ''; this.render(); }
  _frameCanvas(frame) {
    let bitmap = this.frames.get(frame);
    if (!bitmap) {
      bitmap = this.canvas.ownerDocument.createElement('canvas'); bitmap.width = frame.width; bitmap.height = frame.height;
      const context = bitmap.getContext('2d');
      const pixels = context.createImageData(frame.width, frame.height);
      pixels.data.set(frame.getData());
      const mask = frame.getMask();
      for (let i = 0; i < mask.length; i++) if (!mask[i]) pixels.data[i * 4 + 3] = 0;
      context.putImageData(pixels, 0, 0); this.frames.set(frame, bitmap);
    }
    return bitmap;
  }
  drawFrame(frame, x, y) {
    if (!frame) return;
    this.bufferContext.drawImage(this._frameCanvas(frame), Math.round(x + frame.offsetX - this.cameraX), Math.round(y + frame.offsetY - this.cameraY));
  }
  render() {
    const start = this.window.performance?.now?.() ?? 0;
    const dpr = Math.min(2, this.window.devicePixelRatio || 1), scale = this.scale * dpr;
    const width = Math.max(1, Math.ceil(this.canvas.width / scale)), height = Math.max(1, Math.ceil(this.canvas.height / scale));
    this.cameraY = Math.max(0, Math.min(Math.max(0, this.world.height - height), this.cameraY));
    if (this.follow) {
      let frontier = 36;
      for (const actor of this.world.actors) if (!actor.failureReason) frontier = Math.max(frontier, actor.x);
      this.cameraX += (Math.max(0, frontier - width * 0.4) - this.cameraX) * 0.12;
    }
    this.cameraX = Math.max(0, this.cameraX);
    if (!this.image || this.buffer.width !== width || this.buffer.height !== height) {
      this.buffer.width = width; this.buffer.height = height;
      this.image = this.bufferContext.createImageData(width, height);
    }
    const pixels = new Uint32Array(this.image.data.buffer);
    pixels.fill(0xff0e0807);
    const firstLane = Math.max(0, Math.floor(this.cameraY / LANE_HEIGHT)), lastLane = Math.min(this.world.laneCount - 1, Math.floor((this.cameraY + height) / LANE_HEIGHT));
    const x0 = Math.floor(this.cameraX), y0 = Math.floor(this.cameraY);
    const pieces = this.assets.groundPieces;
    for (let lane = firstLane; lane <= lastLane; lane++) {
      const piece = pieces[this.world.laneSeeds[lane] % Math.max(1, pieces.length)];
      const palette = piece?.image?.palette;
      for (let py = Math.max(0, lane * LANE_HEIGHT + 40 - y0); py < Math.min(height, (lane + 1) * LANE_HEIGHT - y0); py++) {
        const y = py + y0;
        for (let px = 0; px < width; px++) {
          const x = px + x0, color = this.world.groundColorAt(x, y);
          if (!color) continue;
          if (this.world.terrain) { pixels[py * width + px] = this.world.groundPixelAt(x, y); continue; }
          const ci = piece ? piece.frame[(y % piece.height) * piece.width + x % piece.width] : 1;
          pixels[py * width + px] = color === 3 ? 0xff86cbea : palette?.getColor(ci & 0x80 ? 1 : ci) || 0xff5e8191;
        }
      }
    }
    this.bufferContext.putImageData(this.image, 0, 0);
    this.renderedActors = 0;
    for (const actor of this.world.actors) {
      if (actor.y < this.cameraY - 32 || actor.y > this.cameraY + height + 32) continue;
      if (!actor.failureReason && actor.x >= this.cameraX - 32 && actor.x < this.cameraX + width + 32) { actor.render(this); this.renderedActors++; }
    }
    this.bufferContext.font = '8px monospace';
    this.bufferContext.fillStyle = '#d4c6af';
    this.bufferContext.strokeStyle = '#b99b66';
    for (let lane = firstLane; lane <= lastLane; lane++) {
      const progress = this.world.stall.lanes[lane];
      const previous = progress.previousDistance;
      const y = lane * LANE_HEIGHT + 16 - this.cameraY;
      this.bufferContext.fillText(`${lane + 1} · ${Math.max(0, progress.maxX - 36)} px · previous ${previous} px`, 8, y);
      if (previous > 0) {
        const x = previous + 36 - this.cameraX;
        this.bufferContext.beginPath(); this.bufferContext.moveTo(x, lane * LANE_HEIGHT - this.cameraY);
        this.bufferContext.lineTo(x, (lane + 1) * LANE_HEIGHT - this.cameraY); this.bufferContext.stroke();
      }
    }
    this.context.imageSmoothingEnabled = false;
    this.context.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
    this.lastFrameMs = (this.window.performance?.now?.() ?? start) - start;
  }
  dispose() { for (const [name, handler, options] of this._listeners) this.canvas.removeEventListener(name, handler, options); this._listeners.length = 0; }
}
export { ProcgenLaneRenderer };
