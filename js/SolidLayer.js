import { Lemmings } from './LemmingsNamespace.js';

class SolidLayer {
        constructor(width, height, mask = null) {
            this.width = 0;
            this.height = 0;
            this.width = width;
            this.height = height;
            if (mask != null) {
                this.groundMask = mask;
            }
        }
        /** check if a point is solid */
        hasGroundAt(x, y) {
            if ((x < 0) || (x >= this.width))
                return false;
            if ((y < 0) || (y >= this.height))
                return false;
            return (this.groundMask[x + y * this.width] != 0);
        }
        /** clear a point  */
        clearGroundAt(x, y) {
            let index = x + y * this.width;
            this.groundMask[index] = 0;
        }
        /** clear a point  */
        setGroundAt(x, y) {
            let index = x + y * this.width;
            this.groundMask[index] = 1;
        }
    }
    Lemmings.SolidLayer = SolidLayer;

export { SolidLayer };
