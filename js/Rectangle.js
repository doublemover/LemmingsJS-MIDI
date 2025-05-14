import { Lemmings } from './LemmingsNamespace.js';

class Rectangle {
        constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
            /** X position in the container */
            this.x1 = 0;
            /** Y position in the container */
            this.y1 = 0;
            /** X position in the container */
            this.x2 = 0;
            /** Y position in the container */
            this.y2 = 0;
            this.x1 = x1;
            this.y1 = y1;
            this.x2 = x2;
            this.y2 = y2;
        }
    }
    Lemmings.Rectangle = Rectangle;

export { Rectangle };
