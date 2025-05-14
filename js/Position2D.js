import { Lemmings } from './LemmingsNamespace.js';

class Position2D {
        constructor(x = 0, y = 0) {
            /** X position in the container */
            this.x = 0;
            /** Y position in the container */
            this.y = 0;
            this.x = x;
            this.y = y;
        }
    }
    Lemmings.Position2D = Position2D;

export { Position2D };
