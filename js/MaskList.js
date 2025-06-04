import { Lemmings } from './LemmingsNamespace.js';

class MaskList {
  constructor(fr, width, height, count, offsetX, offsetY) {
    this.frames = [];
    if (fr != null) {
      this.loadFromFile(fr, width, height, count, offsetX, offsetY);
    }
  }
  get length() {
    return this.frames.length;
  }
  GetMask(index) {
    return this.frames[index];
  }
  loadFromFile(fr, width, height, count, offsetX, offsetY) {
    this.frames.length = 0;
    for (let i = 0; i < count; i++) {
      const mask = new Lemmings.Mask(fr, width, height, offsetX, offsetY);
      this.frames.push(mask);
    }
  }
}
Lemmings.MaskList = MaskList;

export { MaskList };
