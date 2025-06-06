import { Lemmings } from './LemmingsNamespace.js';

class ViewPoint {
  constructor(x, y, scale) {
    this.x = x;
    this.y = y;
    this.scale = scale;
  }

  /**
   * Set the X coordinate, optionally clamping within [min,max].
   * @param {number} value - New X position
   * @param {[number, number]} [bounds] - [min,max] allowed values
   */
  setX(value, bounds) {
    if (bounds) {
      const [min, max] = bounds;
      this.x = Math.min(Math.max(value, min), max);
    } else {
      this.x = value;
    }
  }

  /**
   * Set the Y coordinate, optionally clamping within [min,max].
   * @param {number} value - New Y position
   * @param {[number, number]} [bounds] - [min,max] allowed values
   */
  setY(value, bounds) {
    if (bounds) {
      const [min, max] = bounds;
      this.y = Math.min(Math.max(value, min), max);
    } else {
      this.y = value;
    }
  }
  /** transform a a X coordinate from display space to game-world space */
  getSceneX(x) {
    return Math.trunc(x / this.scale) + Math.trunc(this.x);
  }
  /** transform a a Y coordinate from display space to game-world space */
  getSceneY(y) {
    return Math.trunc(y / this.scale) + Math.trunc(this.y);
  }
}
Lemmings.ViewPoint = ViewPoint;

export { ViewPoint };
