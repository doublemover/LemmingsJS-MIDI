
const PROCGEN_HUD_GLYPHS = /^[ A-Z0-9%-]*$/;

class ProcgenBitmapHud {
  constructor({ canvas, sprites }) { this.canvas = canvas; this.sprites = sprites; this.frames = new WeakMap(); }
  bitmap(frame) {
    let bitmap = this.frames.get(frame);
    if (!bitmap) {
      bitmap = this.canvas.ownerDocument.createElement('canvas'); bitmap.width = frame.width; bitmap.height = frame.height;
      const context = bitmap.getContext('2d'), pixels = context.createImageData(frame.width, frame.height);
      pixels.data.set(frame.getData()); context.putImageData(pixels, 0, 0); this.frames.set(frame, bitmap);
    }
    return bitmap;
  }
  drawString(context, text, x, y, scale = 1) {
    if (!PROCGEN_HUD_GLYPHS.test(text)) throw new Error('Unsupported classic HUD glyph');
    for (const letter of text) {
      const frame = this.sprites.getLetterSprite(letter);
      if (frame) context.drawImage(this.bitmap(frame), x, y, frame.width * scale, frame.height * scale);
      x += 8 * scale;
    }
  }
  render(context, world, camera, dpr = 1) {
    if (!this.sprites) return;
    context.imageSmoothingEnabled = false;
    const state = camera.getState();
    const first = Math.max(0, Math.floor(state.cameraY / (world.laneHeight || 96)));
    const last = Math.min(world.laneCount - 1, Math.floor((state.cameraY + camera.viewport().height) / (world.laneHeight || 96)));
    if (state.scale < 0.5) return;
    for (let lane = first; lane <= last; lane++) {
      const progress = world.stall.lanes[lane];
      const y = Math.round((lane * (world.laneHeight || 96) - state.cameraY) * state.scale * dpr);
      if (y < 16 * dpr || y > this.canvas.height - 16 * dpr) continue;
      const label = `LANE ${lane + 1}  DIST ${Math.max(0, Math.round(progress.maxX - 36))}  BEST ${Math.round(progress.previousDistance || 0)}`;
      this.drawString(context, label, 0, y, dpr);
    }
  }
}
export { ProcgenBitmapHud, PROCGEN_HUD_GLYPHS };
