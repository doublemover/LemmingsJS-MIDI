import { decorationPlacements } from './ProcgenDecorationPacks.js';

class DecorationLayer {
  constructor(document, pack) {
    this.pack = pack; this.document = document;
    this.canvas = document.createElement('canvas'); this.context = this.canvas.getContext('2d');
    this.mask = document.createElement('canvas'); this.maskContext = this.mask.getContext('2d');
    this.frames = new WeakMap(); this.key = ''; this.maskKey = '';
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
  draw(renderer, reducedMotion = false) {
    const { world, buffer, rasterStep: step, originX, originY, viewWidth, viewHeight } = renderer;
    // Tiny zooms cannot resolve the artwork; avoid multiplying scenery by lanes.
    if (step >= 4) return;
    const maskKey = `${renderer.lastTerrainKey}:${buffer.width}:${buffer.height}`;
    const phase = reducedMotion ? 0 : Math.floor(world.tickIndex / (this.pack.tickDivisor || 4));
    const key = `${maskKey}:${phase}:${world.frontierRevision}`;
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
      let count = 0; const trims = [];
      const firstLane = Math.max(0, Math.floor(originY / 96)), lastLane = Math.min(world.laneCount - 1, Math.floor((originY + viewHeight) / 96));
      for (let lane = firstLane; lane <= lastLane && count < 1024; lane++) {
        const end = Math.min(originX + viewWidth, world.generatedThrough[lane]);
        for (let chunk = Math.max(0, Math.floor(originX / 128)); chunk * 128 < end && count < 1024; chunk++) {
          for (const placement of decorationPlacements(this.pack, lane, chunk)) {
            const image = placement.piece.image, frame = image.frames[(phase + placement.phase) % image.frames.length];
            if (placement.piece.placement === 'trim') { trims.push({ image, frame, x: placement.x, y: lane * 96 + placement.y }); count++; continue; }
            context.drawImage(this.bitmap(image, frame), (placement.x - originX) / step, (lane * 96 + placement.y - originY) / step, image.width / step, image.height / step); count++;
          }
        }
      }
      // Preserve the complete terrain silhouette and player route in front of art.
      context.globalCompositeOperation = 'destination-out'; context.drawImage(this.mask, 0, 0); context.globalCompositeOperation = 'source-over';
      // Fascia stays below the highest possible walking surface (y=78).
      for (const { image, frame, x, y } of trims) context.drawImage(this.bitmap(image, frame), (x - originX) / step, (y - originY) / step, image.width / step, image.height / step);
      this.key = key;
    }
    renderer.bufferContext.drawImage(this.canvas, 0, 0);
  }
}
export { DecorationLayer };
