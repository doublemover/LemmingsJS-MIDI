const canMeasurePerformance = () => (typeof performance !== 'undefined' &&
  typeof performance.now === 'function' &&
  typeof performance.measure === 'function');

const RENDER_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'ObjectManager',
    trackGroup: 'Render',
    color: 'secondary',
    tooltipText: 'render'
  })
});

class ObjectManager {
  constructor(gameTimer) {
    this.gameTimer = gameTimer;
    this.objects = [];
  }
  /** render all Objects to the GameDisplay */
  render(gameDisplay) {
    const app = globalThis?.lemmings;
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      const objs = this.objects;
      const tick = this.gameTimer.getGameTicks();
      const view = gameDisplay?.stage?.getGameViewRect?.();
      let minX = -Infinity;
      let minY = -Infinity;
      let maxX = Infinity;
      let maxY = Infinity;
      if (view) {
        const pad = 32;
        minX = view.x - pad;
        minY = view.y - pad;
        maxX = view.x + view.w + pad;
        maxY = view.y + view.h + pad;
      }
      for (let i = 0; i < objs.length; i++) {
        const obj = objs[i];
        const animation = obj?.animation;
        if (!animation?.getFrame) continue;
        let fw = Number.isFinite(obj._frameWidth) ? obj._frameWidth : NaN;
        let fh = Number.isFinite(obj._frameHeight) ? obj._frameHeight : NaN;
        if (view && Number.isFinite(fw) && Number.isFinite(fh)) {
          if ((obj.x + fw) < minX || obj.x > maxX || (obj.y + fh) < minY || obj.y > maxY) {
            continue;
          }
        }
        const frame = animation.getFrame(tick + 1);
        if (!frame) continue;
        if (!Number.isFinite(fw) || !Number.isFinite(fh)) {
          fw = frame.width ?? 0;
          fh = frame.height ?? 0;
          obj._frameWidth = fw;
          obj._frameHeight = fh;
        }
        if (view) {
          if ((obj.x + fw) < minX || obj.x > maxX || (obj.y + fh) < minY || obj.y > maxY) {
            continue;
          }
        }
        gameDisplay.drawFrameFlags(frame, obj.x, obj.y, obj.drawProperties);
      }
    } finally {
      if (perfEnabled) {
        try {
          performance.measure('ObjectManager render', {
            start: perfStart,
            detail: RENDER_MEASURE_DETAIL
          });
        } catch {
          /* ignored */
        }
      }
    }
  }
  /** add map objects to manager */
  addRange(mapObjects) {
    for (let i = 0; i < mapObjects.length; i++) {
      this.objects.push(mapObjects[i]);
    }
  }
}

export { ObjectManager };
