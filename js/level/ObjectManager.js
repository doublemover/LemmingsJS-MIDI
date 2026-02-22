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
      let objs = this.objects;
      let tick = this.gameTimer.getGameTicks();
      for (let i = 0; i < objs.length; i++) {
        let obj = objs[i];
        gameDisplay.drawFrameFlags(obj.animation.getFrame(tick + 1), obj.x, obj.y, obj.drawProperties);
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
