import {
    Lemmings
} from './LemmingsNamespace.js';

class MiniMap {
    static palette = null;
    constructor(gameDisplay, level, guiDisplay) {
        this.gameDisplay = gameDisplay;
        this.level = level;
        this.guiDisplay = guiDisplay;

        this.width = 127;
        this.height = 24;
        this.size = this.width * this.height;
        this.scaleX = this.width / level.width;
        this.scaleY = this.height / level.height;

        this.terrain = new Uint8Array(this.size);
        this.#buildTerrain();

        // dynamic state
        this.fog = new Uint8Array(this.size); // 0 = unseen
        this.fog.fill(1); // disabled
        // typed array storing [x1,y1,x2,y2,...] scaled to minimap
        this.liveDots = new Uint8Array(0);
        this.deadDots = new Uint8Array(0); // [x1,y1,x2,y2,...]
        this.deadTTLs = new Uint8Array(0); // parallel ttl values

        // render target (drawn into the GUI canvas once per frame)
        this.frame = new Lemmings.Frame(this.width, this.height);
        //this.renderFrame = new Lemmings.Frame(this.renderWidth, this.renderHeight);
        
        if (!MiniMap.palette) {
            MiniMap.palette = new Uint32Array(129);
            for (let i = 1; i <= 128; ++i) {
                MiniMap.palette[i] = 0xFF000000 | ((i*2) << 8);
            }
        }
        
        this._displayListeners = null;
        this._mouseDown = false;
        if (this.guiDisplay) this.#hookPointer();
    }

    #hookPointer() {
        this._displayListeners = [
            ['onMouseDown', e => { this.#handleMouseDown(e); }],
            ['onMouseUp', e => { this.#handleMouseUp(e); }],
            ['onMouseMove', e => { this.#handleMouseMove(e); }],
        ];
        for (const [event, handler] of this._displayListeners) {
            this.guiDisplay[event].on(handler);
        }
    }

    #handleMouseDown(event){
        if (!this.guiDisplay) return;
        this._mouseDown = true;
        const gd = this.guiDisplay;
        const destX = gd.getWidth()  - this.width;
        const destY = gd.getHeight() - this.height - 1;

        const mx = event.x - destX;
        const my = event.y - destY;
        if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return;
        
        const pct = mx / this.width;
        const newX = ((this.level.width - gd.getWidth()) * pct) | 0;
        this.level.screenPositionX = newX;
        gd.setScreenPosition?.(newX, 0);
    }

    #handleMouseUp(event){
        if (!this.guiDisplay) return;
        this._mouseDown = false;
        const gd = this.guiDisplay;
        const destX = gd.getWidth()  - this.width;
        const destY = gd.getHeight() - this.height - 1;

        const mx = event.x - destX;
        const my = event.y - destY;
        if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return;
        const pct = mx / this.width;
        const newX = ((this.level.width - gd.getWidth()) * pct) | 0;
        this.level.screenPositionX = newX;
        gd.setScreenPosition?.(newX, 0);
    }

    #handleMouseMove(event){
        if (!this.guiDisplay) return;
        if (!this._mouseDown) return;
        const gd = this.guiDisplay;

        const destX = gd.getWidth()  - this.width;
        const destY = gd.getHeight() - this.height - 1;

        const mx = event.x - destX;
        const my = event.y - destY;
        if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return;

        const pct = mx / this.width;
        const newX = ((this.level.width - gd.getWidth()) * pct) | 0;
        this.level.screenPositionX = newX;
        gd.setScreenPosition?.(newX, 0);
    }

    /* Build complete terrain snapshot (expensive – call at load/reset only). */
    #buildTerrain() {
        this.terrain.fill(0);
        const gm = this.level.getGroundMaskLayer();
        for (let y = 0; y < this.level.height; ++y) {
            const mY = (y * this.scaleY) | 0;
            const base = mY * this.width;
            for (let x = 0; x < this.level.width; ++x) {
                if (gm.hasGroundAt(x, y)) {
                    const mX = (x * this.scaleX) | 0;
                    const idx = base + mX;
                    if (this.terrain[idx] < 128) ++this.terrain[idx];
                    if (this.terrain[idx] > 71) this.terrain[idx] = 72;
                }
            }
        }
    }

    /* Fast per‑pixel update called by digging/mining/placing ground.
         Supply removed=true for clearing ground, false for placing. */
    onGroundChanged(px, py, removed = true) {
        const mX = (px * this.scaleX) | 0;
        const mY = (py * this.scaleY) | 0;
        const idx = mY * this.width + mX;
        if (removed) {
            if (this.terrain[idx] > 0) --this.terrain[idx];
        } else {
            if (this.terrain[idx] < 128) ++this.terrain[idx];
        }
    }

    /* Region‑based revalidation (e.g. after a large mask dig). */
    invalidateRegion(x, y, w, h) {
        const gm = this.level.getGroundMaskLayer();
        const x1 = Math.max(0, x | 0);
        const y1 = Math.max(0, y | 0);
        const xEnd = Math.min(this.level.width, x1 + w);
        const yEnd = Math.min(this.level.height, y1 + h);

        // For minimal work, track which minimap rows/cols need recompute
        const touched = new Int8Array(this.width * this.height);

        for (let py = y1; py < yEnd; ++py) {
            const mY = (py * this.scaleY) | 0;
            const rowBase = mY * this.width;
            for (let px = x1; px < xEnd; ++px) {
                const mX = (px * this.scaleX) | 0;
                touched[rowBase + mX] = 1;
            }
        }

        // For every touched cell recalc its counter from scratch.
        for (let mY = 0; mY < this.height; ++mY) {
            const rowBase = mY * this.width;
            for (let mX = 0; mX < this.width; ++mX) {
                const idx = rowBase + mX;
                if (!touched[idx]) continue;

                // Back‑map to level bounds for this cell.
                const lx1 = Math.floor(mX / this.scaleX);
                const lx2 = Math.min(this.level.width, Math.ceil((mX + 1) / this.scaleX));
                const ly1 = Math.floor(mY / this.scaleY);
                const ly2 = Math.min(this.level.height, Math.ceil((mY + 1) / this.scaleY));

                let count = 0;
                for (let ly = ly1; ly < ly2; ++ly) {
                    for (let lx = lx1; lx < lx2; ++lx)
                        if (gm.hasGroundAt(lx, ly)) {
                            if (++count === 128) {
                                ly = ly2;
                                break;
                            }
                        }
                }
                this.terrain[idx] = count;
            }
        }
    }

    /** reveal terrain that is currently on screen */
    reveal(viewX, viewW) {
        const sx1 = Math.floor(viewX * this.scaleX);
        const sx2 = Math.min(this.width, Math.ceil((viewX + viewW) * this.scaleX));
        for (let y = 0; y < this.height; ++y) {
            const row = y * this.width;
            for (let x = sx1; x < sx2; ++x) this.fog[row + x] = 1;
        }
    }

    setLiveDots(arr) {
        // arr is a Uint8Array of scaled [x1,y1,x2,y2,...]
        this.liveDots = arr;
    }

    addDeath(x, y) {
        let dx = (x * this.scaleX) | 0;
        let dy = (y * this.scaleY) | 0;
        // clamp to minimap bounds so off-screen deaths still show
        if (dx < 0) dx = 0; else if (dx >= this.width) dx = this.width - 1;
        if (dy < 0) dy = 0; else if (dy >= this.height) dy = this.height - 1;
        const newDots = new Uint8Array(this.deadDots.length + 2);
        newDots.set(this.deadDots);
        newDots.set([dx, dy], this.deadDots.length);
        const newTTLs = new Uint8Array(this.deadTTLs.length + 1);
        newTTLs.set(this.deadTTLs);
        // dot flashes four times (16 frames total)
        newTTLs[this.deadTTLs.length] = 16;
        this.deadDots = newDots;
        this.deadTTLs = newTTLs;
    }

    render() {
        if (!this.guiDisplay) return;

        const {
            width: W,
            height: H,
            frame,
            terrain,
            fog,
        } = this;

        /* Terrain + fog background */
        for (let idx = 0; idx < terrain.length; ++idx) {
            let color = 0xFF000000;
            if (MiniMap.palette[terrain[idx]]) {
                color = MiniMap.palette[terrain[idx]];
            }
            frame.data[idx] = color;
            frame.mask[idx] = 1;
        }

        const vpX = (lemmings.stage.getGameViewRect().x * this.scaleX) | 0;
        let vpW = (lemmings.stage.getGameViewRect().w * this.scaleX) | 0;
        let vpXW = vpX + vpW;
        // dumb fix to keep right edge of viewport rect visible
        if (vpXW == this.width) {
            vpW -= 1;
        }
        const vpRectColor = 0xFFFFFFFF;
        frame.drawRect(vpX, 0, 0, this.height - 1, vpRectColor, false, false);
        frame.drawRect(vpX + vpW, 0, 0, this.height - 1, vpRectColor, false, false);

        /* Entrances / Exits */
        for (const obj of this.level.objects) {
            const rx = (obj.x * this.scaleX) | 0;
            const ry = (obj.y * this.scaleY) | 0;
            if (obj.ob?.id === 1) frame.setPixel(rx + 2, ry + 2, 0xFF00AA00);
            if (obj.triggerType === Lemmings.TriggerTypes.EXIT_LEVEL) {
                frame.setPixel(rx + 2, ry + 2, 0xFFFF00CC);
                frame.setPixel(rx + 2, ry + 1, 0xFFFF00CC);
            }
        }

        /* Death flashes */
        if (this.deadDots.length) {
            const oldDots = this.deadDots;
            const oldTTLs = this.deadTTLs;
            let count = 0;
            // determine remaining dots after ttl decrement
            for (let i = 0, j = 0; i < oldDots.length; i += 2, ++j) {
                if (oldTTLs[j] - 1 > 0) ++count;
            }
            const newDots = new Uint8Array(count * 2);
            const newTTLs = new Uint8Array(count);
            let idx = 0, tIdx = 0;
            for (let i = 0, j = 0; i < oldDots.length; i += 2, ++j) {
                let ttl = oldTTLs[j];
                if (ttl <= 0) continue;
                // first two frames stay lit then blink every two frames
                if (ttl >= 15 || (Math.ceil(ttl / 2) % 2 === 0)) {
                    frame.setPixel(oldDots[i], oldDots[i + 1], 0xFFFF0000);
                }
                ttl -= 1;
                if (ttl > 0) {
                    newDots[idx++] = oldDots[i];
                    newDots[idx++] = oldDots[i + 1];
                    newTTLs[tIdx++] = ttl;
                }
            }
            this.deadDots = newDots;
            this.deadTTLs = newTTLs;
        }

        /* Live lemmings */
        for (let i = 0; i < this.liveDots.length; i += 2) {
            const x = this.liveDots[i];
            const y = this.liveDots[i + 1];
            frame.setPixel(x, y, 0x5500FFFF);
        }

        /* Blit */
        const destX = this.guiDisplay.getWidth() - W;
        const destY = this.guiDisplay.getHeight() - H;
        this.guiDisplay.drawFrame(frame, destX, destY);
    }

}
Lemmings.MiniMap = MiniMap;

export {
    MiniMap
};