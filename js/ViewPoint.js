import { Lemmings } from './LemmingsNamespace.js';

class ViewPoint {
        constructor(x, y, scale) {
            this.x = x;
            this.y = y;
            this.scale = scale;
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
