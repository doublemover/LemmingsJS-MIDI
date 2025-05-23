import {
    Lemmings
} from './LemmingsNamespace.js';

class MiniMap {
    constructor(gameDisplay, level, guiDisplay) {
        this.gameDisplay = gameDisplay;
        this.level = level;
        this.guiDisplay = guiDisplay;

        this.width = 128;
        this.height = 24;
        this.size = this.width * this.height;
        this.scaleX = this.width / level.width;
        this.scaleY = this.height / level.height;

        this.terrain = new Uint8Array(this.size);
        this._buildTerrain();

        // dynamic state
        this.fog = new Uint8Array(this.size); // 0 = unseen
        this.fog.fill(1); // disabled
        this.liveDots = []; // {x,y} sampled every x ticks
        this.deadDots = []; // {x,y,ttl}

        // render target (drawn into the GUI canvas once per frame)
        this.frame = new Lemmings.Frame(this.width, this.height);
        //this.renderFrame = new Lemmings.Frame(this.renderWidth, this.renderHeight);

        this.palette = new Uint32Array(129);
        for (let i = 1; i <= 128; ++i) {
            this.palette[i] = 0xFF000000 | ((i*2) << 8);
        }

        if (this.guiDisplay) this._hookPointer();
    }

    _hookPointer() {
        const gd = this.guiDisplay;
        gd.onMouseDown.on(evt => {
            /* coordinates relative to minimap */
            const destX = gd.getWidth()  - this.width;
            const destY = gd.getHeight() - this.height - 1;

            const mx = evt.x - destX;
            const my = evt.y - destY;
            if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return;

            const pct = mx / this.width;
            const newX = ((this.level.width - gd.getWidth()) * pct) | 0;
            this.level.screenPositionX = newX;
            gd.setScreenPosition?.(newX, 0);
        });
    }

    /* Build complete terrain snapshot (expensive – call at load/reset only). */
    _buildTerrain() {
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
        const xEnd = Math.min(this.level.width, x + w);
        const yEnd = Math.min(this.level.height, y + h);

        // For minimal work, track which minimap rows/cols need recompute
        const touched = new Int8Array(this.width * this.height);

        for (let py = y; py < yEnd; ++py) {
            const mY = (py * this.scaleY) | 0;
            const rowBase = mY * this.width;
            for (let px = x; px < xEnd; ++px) {
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
        this.liveDots = arr;
    }

    addDeath(x, y) {
        this.deadDots.push({
            x: x * this.scaleX | 0,
            y: y * this.scaleY | 0,
            ttl: 30
        });
    }

    render() {
        if (!this.guiDisplay) return;

        const {
            width: W,
            height: H,
            frame,
            terrain,
            fog,
            palette
        } = this;

        /* Terrain + fog background */
        for (let idx = 0; idx < terrain.length; ++idx) {
            let color = 0xFF000000;
            if (palette[terrain[idx]]) {
                color = palette[terrain[idx]];
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

        /* Entrances / exits */
        for (const obj of this.level.objects) {
            const rx = (obj.x * this.scaleX) | 0;
            const ry = (obj.y * this.scaleY) | 0;
            if (obj.ob?.id === 1) frame.setPixel(rx + 2, ry + 2, 0xFF00AA00);
            if (obj.triggerType === Lemmings.TriggerTypes.EXIT_LEVEL) {
                frame.setPixel(rx + 2, ry + 2, 0xFFFF00CC);
                frame.setPixel(rx + 2, ry + 1, 0xFFFF00CC);
            }
        }

        /* Live lemmings */
        for (const p of this.liveDots) {
            frame.setPixel((p.x * this.scaleX) | 0, (p.y * this.scaleY) | 0, 0x5500FFFF);
        }

        /* Death flashes */
        for (let i = this.deadDots.length - 1; i >= 0; --i) {
            const d = this.deadDots[i];
            if (--d.ttl <= 0) {
                this.deadDots.splice(i, 1);
                continue;
            }
            if (d.ttl & 4) frame.setPixel(d.x, d.y, 0xFF0000FF);
        }

        /* Blit */
        const destX = this.guiDisplay.getWidth() - W;
        const destY = this.guiDisplay.getHeight() - H - 1;
        this.guiDisplay.drawFrame(frame, destX, destY);
    }

}
Lemmings.MiniMap = MiniMap;

export {
    MiniMap
};