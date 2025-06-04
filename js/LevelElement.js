import { Lemmings } from './LemmingsNamespace.js';

class LevelElement {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.id = 0;
    this.frameIndex = 0;
  }
}
Lemmings.LevelElement = LevelElement;

export { LevelElement };
