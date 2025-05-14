import { Lemmings } from './LemmingsNamespace.js';

class GroundRenderer {
        constructor() {}
        createVgaspecMap(lr, vr) {
            this.img = vr.img;
        }
        /** create the ground image from the level definition and the Terrain images */
        createGroundMap(lr, terrarImg) {
            this.img = new Lemmings.Frame(lr.levelWidth, lr.levelHeight);
            let terrarObjects = lr.terrains;
            for (let i = 0; i < terrarObjects.length; i++) {
                let tOb = terrarObjects[i];
                this.copyImageTo(terrarImg[tOb.id], tOb);
            }
        }
        /** copy a terrain image to the ground */
        copyImageTo(srcImg, destConfig, frameIndex = 0) {
            if (!srcImg)
                return;
            var pixBuf = srcImg.frames[frameIndex];
            var w = srcImg.width;
            var h = srcImg.height;
            var pal = srcImg.palette;
            var destX = destConfig.x;
            var destY = destConfig.y;
            var upsideDown = destConfig.drawProperties.isUpsideDown;
            var noOverwrite = destConfig.drawProperties.noOverwrite;
            var isErase = destConfig.drawProperties.isErase;
            var onlyOverwrite = destConfig.drawProperties.onlyOverwrite;
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    let sourceY = upsideDown ? (h - y - 1) : y;
                    /// read source color index
                    let colorIndex = pixBuf[sourceY * w + x];
                    /// ignore transparent pixels
                    if ((colorIndex & 0x80) != 0)
                        continue;
                    if (isErase) {
                        this.img.clearPixel(x + destX, y + destY);
                    } else {
                        this.img.setPixel(x + destX, y + destY, pal.getColor(colorIndex), noOverwrite, onlyOverwrite);
                    }
                }
            }
        }
    }
    Lemmings.GroundRenderer = GroundRenderer;

export { GroundRenderer };
