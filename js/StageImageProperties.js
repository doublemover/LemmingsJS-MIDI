import { Lemmings } from './LemmingsNamespace.js';

class StageImageProperties {
        constructor() {
            /** X position to display this Image */
            this.x = 0;
            /** Y position to display this Image */
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
            this.ctx = this.cav.getContext("2d");
            return this.ctx.createImageData(width, height);
        }
    }
    Lemmings.StageImageProperties = StageImageProperties;

export { StageImageProperties };
