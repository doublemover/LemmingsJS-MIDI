import { Lemmings } from './LemmingsNamespace.js';

class Range {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
    this.direction = 0; // 1 is right, 0 is left
  }
}
Lemmings.Range = Range;

export { Range };
