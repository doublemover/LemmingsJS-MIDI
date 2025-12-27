import { withPerformance } from '../util/LogHandler.js';

class ObjectManager {
  constructor(gameTimer) {
    this.gameTimer = gameTimer;
    this.objects = [];
  }
  /** render all Objects to the GameDisplay */
  render(gameDisplay) {
    return withPerformance(
      'ObjectManager render',
      {
        track: 'ObjectManager',
        trackGroup: 'Render',
        color: 'secondary',
        tooltipText: 'render'
      },
      () => {
        let objs = this.objects;
        let tick = this.gameTimer.getGameTicks();
        for (let i = 0; i < objs.length; i++) {
          let obj = objs[i];
          gameDisplay.drawFrameFlags(obj.animation.getFrame(tick + 1), obj.x, obj.y, obj.drawProperties);
        }
      }
    ).call(this);
  }
  /** add map objects to manager */
  addRange(mapObjects) {
    for (let i = 0; i < mapObjects.length; i++) {
      this.objects.push(mapObjects[i]);
    }
  }
}

export { ObjectManager };
