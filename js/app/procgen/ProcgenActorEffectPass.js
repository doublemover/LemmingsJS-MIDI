import { readProcgenCanvasRect } from './ProcgenPresentationSnapshot.js';

// Draws only an action sprite. Cached shared pixels and status/countdown art are untouched.
class ProcgenActorEffectPass {
  constructor(renderer) { this.renderer = renderer; this.outlines = new WeakMap(); this.maskPixels = 0; this.skippedMasks = 0; this.drawPasses = 0; this.failures = 0; }
  paddingFor(actor, bounds) {
    if (!this.renderer.actorEffects.mailboxes.has(actor.id)) return 0;
    const rect = readProcgenCanvasRect(this.renderer.canvas, this.renderer.window), css = rect?.width / this.renderer.viewWidth;
    return (css > 0 ? 3 / css : 4) + Math.max(bounds?.width || 16, bounds?.height || 16) * 0.08 + 2;
  }
  _outline(frame, outer) {
    let variants = this.outlines.get(frame); if (!variants) { variants = new Map(); this.outlines.set(frame, variants); }
    const key = outer ? 'outer' : 'inner', cached = variants.get(key); if (cached) { this.renderer.resources.touch(cached); return cached; }
    if (frame.width * frame.height > 16384) { this.skippedMasks++; return null; }
    const resources = this.renderer.resources, pixelKey = {}, width = frame.width + (outer ? 2 : 0), height = frame.height + (outer ? 2 : 0);
    let canvas = null;
    try {
      canvas = resources.canvas(); resources.resize(canvas, width, height, { cache: true, retire: () => variants.delete(key) });
      const context = canvas.getContext('2d'); if (!context) throw new Error('Effect outline context unavailable');
      const image = resources.image(context, width, height, pixelKey), mask = frame.getMask(), data = frame.getData(), offset = outer ? 1 : 0;
      const opaque = (x, y) => x >= 0 && y >= 0 && x < frame.width && y < frame.height && mask[y * frame.width + x] && data[(y * frame.width + x) * 4 + 3];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = x - offset, sy = y - offset, center = opaque(sx, sy), neighbors = [opaque(sx - 1, sy), opaque(sx + 1, sy), opaque(sx, sy - 1), opaque(sx, sy + 1)];
        if (outer ? !center && neighbors.some(Boolean) : center && neighbors.some(value => !value)) {
          const index = (y * width + x) * 4; image.data[index] = outer ? 142 : 232; image.data[index + 1] = outer ? 193 : 218; image.data[index + 2] = outer ? 219 : 177; image.data[index + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0); variants.set(key, canvas); this.maskPixels += width * height; return canvas;
    } catch { if (canvas) resources.release(canvas); this.skippedMasks++; return null; }
    finally { resources.release(pixelKey); }
  }
  draw(frame, bitmap, actor, x, y, now) {
    const renderer = this.renderer, rect = readProcgenCanvasRect(renderer.canvas, renderer.window);
    if (!rect) return false;
    const step = renderer.rasterStep, cssX = rect.width / renderer.viewWidth;
    const logicalHeight = renderer.canvas.height / (renderer.presentationDpr || 1), cssY = renderer.workstationLayout ? renderer.scale * rect.height / logicalHeight : (rect.height - (renderer.overviewBandHeight || 0) * rect.height / logicalHeight) / renderer.viewHeight;
    if (!(cssX > 0 && cssY > 0)) return false;
    const dense = frame.width * cssX < 8, visual = renderer.actorEffects.evaluate(actor.id, now, { reducedMotion: !!renderer.reducedMotion?.matches, dense, patchId: actor.patchId || null });
    if (!visual.sources.length || !visual.x && !visual.y && visual.scale === 1 && !visual.inner && !visual.outer && !visual.trails.length) return false;
    const cap = Math.min(3, frame.width * cssX * 0.2), dx = Math.max(-cap, Math.min(cap, visual.x)) / cssX, dy = Math.max(-cap, Math.min(cap, visual.y)) / cssY;
    const baseX = renderer.originX + Math.round((x + (frame.offsetX || 0) - renderer.originX) / step) * step;
    const baseY = renderer.originY + Math.round((y + (frame.offsetY || 0) - renderer.originY) / step) * step;
    const left = actor.x + (baseX - actor.x) * visual.scale + dx, top = actor.y + (baseY - actor.y) * visual.scale + dy;
    const width = frame.width * visual.scale, height = frame.height * visual.scale, context = renderer.bufferContext;
    const draw = (image, wx, wy, w, h, alpha = 1) => { const previous = context.globalAlpha; context.globalAlpha = previous * alpha; try { context.drawImage(image, (wx - renderer.originX) / step, (wy - renderer.originY) / step, w / step, h / step); this.drawPasses++; } finally { context.globalAlpha = previous; } };
    for (const trail of visual.trails) draw(bitmap, trail.x + baseX - actor.x, trail.y + baseY - actor.y, frame.width, frame.height, trail.alpha);
    if (visual.outer) { const outline = this._outline(frame, true); if (outline) draw(outline, left - visual.scale, top - visual.scale, width + 2 * visual.scale, height + 2 * visual.scale, Math.min(0.28, visual.outer * 0.28)); }
    draw(bitmap, left, top, width, height);
    if (visual.inner && !dense) { const outline = this._outline(frame, false); if (outline) draw(outline, left, top, width, height, Math.min(0.3, visual.inner * 0.3)); }
    if (Math.abs(dx * cssX) + Math.abs(dy * cssY) > 0.35 || Math.abs(visual.scale - 1) > 0.025) {
      const previous = context.globalAlpha; context.globalAlpha = 0.8; context.fillStyle = '#dce6e7';
      context.fillRect((actor.x - renderer.originX) / step - 1 / cssX / step, (actor.y - renderer.originY) / step, 2 / cssX / step, 1 / cssY / step); context.globalAlpha = previous;
      if (Math.hypot(dx * cssX, dy * cssY) > 1) {
        context.beginPath(); context.moveTo((actor.x - renderer.originX) / step, (actor.y - renderer.originY) / step); context.lineTo((actor.x + dx - renderer.originX) / step, (actor.y + dy - renderer.originY) / step); context.strokeStyle = '#9eaeb4'; context.lineWidth = 0.5 / cssX / step; context.stroke();
      }
    }
    return true;
  }
  reset() { this.outlines = new WeakMap(); }
  dispose() { this.reset(); this.renderer = null; }
}
export { ProcgenActorEffectPass };
