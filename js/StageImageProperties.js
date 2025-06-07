import { Lemmings } from './LemmingsNamespace.js';

class StageImageProperties {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
    this.display = null;
    this.viewPoint = new Lemmings.ViewPoint(0, 0, 2);
  }
  createImage(width, height) {
    this.cav = document.createElement('canvas');
    this.cav.width = width;
    this.cav.height = height;
    this.ctx = this.cav.getContext('2d', { willReadFrequently: true , desynchronized: true, alpha: true});
    return this.ctx.createImageData(width, height);
  }

  /** Pixel dimensions of the viewport on the Stage canvas. */
  get canvasViewportSize() {
    return { width: this.width, height: this.height };
  }

  set canvasViewportSize({ width, height }) {
    this.width = width;
    this.height = height;
  }
}
Lemmings.StageImageProperties = StageImageProperties;

export { StageImageProperties };
