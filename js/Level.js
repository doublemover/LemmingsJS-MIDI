import { Lemmings } from './LemmingsNamespace.js';

class Level {
    constructor(width, height) {
        /** the background mask 0=noGround / 1=ground*/
        this.groundMask = null;
        this.steelRanges = [];
        /** objects on the map: entrance/exit/traps */
        this.objects = [];
        this.entrances = [];
        this.triggers = [];
        this.name = "";
        this.width = 0;
        this.height = 0;
        this.releaseRate = 0;
        this.releaseCount = 0;
        this.needCount = 0;
        this.timeLimit = 0;
        this.skills = new Array(Object.keys(Lemmings.SkillTypes).length);
        this.screenPositionX = 0;
        this.isSuperLemming = false;
        this.width = width;
        this.height = height;
    }
    /** set the map objects of this level and update trigger */
    setMapObjects(objects, objectImg) {
        this.entrances = [];
        this.triggers = [];
        this.objects = [];
        /// process all objects
        for (let i = 0; i < objects.length; i++) {
            let ob = objects[i];
            let objectInfo = objectImg[ob.id];
            /// add object
            let newMapObject = new Lemmings.MapObject(ob, objectInfo, new Lemmings.Animation(), objectInfo.trigger_effect_id);
            this.objects.push(newMapObject);
            /// add entrances
            if (ob.id == 1)
                this.entrances.push(ob);
            /// add triggers
            if (objectInfo.trigger_effect_id != 0) {
                let x1 = ob.x + objectInfo.trigger_left;
                let y1 = ob.y + objectInfo.trigger_top;
                let x2 = x1 + objectInfo.trigger_width;
                let y2 = y1 + objectInfo.trigger_height;
                let newTrigger = new Lemmings.Trigger(objectInfo.trigger_effect_id, x1, y1, x2, y2, 0, objectInfo.trap_sound_effect_id, newMapObject);
                this.triggers.push(newTrigger);
            }
        }
    }
    /** check if a y-position is out of the level */
    isOutOfLevel(y) {
        return ((y >= this.height) || (y <= 0));
    }
    /** return the layer that defines if a pixel in the level is solid */
    getGroundMaskLayer() {
        if (this.groundMask == null) {
            this.groundMask = new Lemmings.SolidLayer(this.width, this.height);
        }
        return this.groundMask;
    }
    /** set the GroundMaskLayer */
    setGroundMaskLayer(solidLayer) {
        this.groundMask = solidLayer;
    }
    /** clear with mask  */
    clearGroundWithMask(mask, x, y) {
        x += mask.offsetX;
        y += mask.offsetY;
        for (let d_y = 0; d_y < mask.height; d_y++) {
            for (let d_x = 0; d_x < mask.width; d_x++) {
                if (!mask.at(d_x, d_y) && !this.isSteelAt(x + d_x, y + d_y)) {
                    this.clearGroundAt(x + d_x, y + d_y);
                }
            }
        }
    }
    /** set a point in the map to solid ground  */
    setGroundAt(x, y, paletteIndex) {
        this.groundMask.setGroundAt(x, y);
        let index = (y * this.width + x) * 4;
        this.groundImage[index + 0] = this.colorPalette.getR(paletteIndex);
        this.groundImage[index + 1] = this.colorPalette.getG(paletteIndex);
        this.groundImage[index + 2] = this.colorPalette.getB(paletteIndex);
    }
    /** checks if a point is solid ground  */
    hasGroundAt(x, y) {
        return this.groundMask.hasGroundAt(x, y);
    }
    /** clear a point  */
    clearGroundAt(x, y) {
        if (this.isSteelAt(x, y)) {
            return;
        }
        this.groundMask.clearGroundAt(x, y);
        let index = (y * this.width + x) * 4;
        this.groundImage[index + 0] = 0; // R
        this.groundImage[index + 1] = 0; // G
        this.groundImage[index + 2] = 0; // B
    }
    setGroundImage(img) {
        this.groundImage = new Uint8ClampedArray(img);
    }
    /** set the color palettes for this level */
    setPalettes(colorPalette, groundPalette) {
        this.colorPalette = colorPalette;
        this.groundPalette = groundPalette;
    }
    /** render ground to display */
    render(gameDisplay) {
        gameDisplay.initSize(this.width, this.height);
        gameDisplay.setBackground(this.groundImage, this.groundMask);
    }
    renderDebug(gameDisplay) {
        for (let i = 0; i < this.steelRanges.length; i++) {
            let x = this.steelRanges[i].x;
            let y = this.steelRanges[i].y;
            let w = this.steelRanges[i].width;
            let h = this.steelRanges[i].height;
            gameDisplay.drawRect(x, y, w, h, 0, 255, 255);
        }
    }
    setSteelAreas(ranges) { 
        this.steelRanges = ranges || [];
    }
    isSteelAt(x, y) {
        for (let i = 0; i < this.steelRanges.length; ++i) {
            const r = this.steelRanges[i];
            if (x >= r.x && x < r.x + r.width &&
                y >= r.y && y < r.y + r.height) {
                return true;
            }
        }
        return false;
    }
    isSteelGround(x, y) {
        return this.isSteelAt(x, y) && this.hasGroundAt(x, y);
    }
    hasSteelUnderMask(mask, ox, oy) {
        const { offsetX:mx, offsetY:my, width:w, height:h } = mask;
        for (let dy = 0; dy < h; ++dy) {
            for (let dx = 0; dx < w; ++dx) {
                if (!mask.at(dx, dy) && this.isSteelGround(ox + mx + dx, oy + my + dy)) {
                    return true;           // mask wants to dig, but it's steel
                }
            }
        }
        return false;
    }
}
Lemmings.Level = Level;

export { Level };
