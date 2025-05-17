import { Lemmings } from './LemmingsNamespace.js';

class MiniMap {
        constructor(gameDisplay, level, guiDisplay) {
            this.gameDisplay   = gameDisplay;
            this.level         = level;
            this.guiDisplay    = guiDisplay;

            this.renderScale = 2;
            this.width = 104;
            this.height = 20;
            this.scaleX = this.width / level.width;
            this.scaleY = this.height / level.height;
            this.renderWidth = this.width * this.renderScale;
            this.renderHeight = this.height * this.renderScale;
            this.renderScaleX = this.renderWidth / level.width;
            this.renderScaleY = this.renderHeight / level.height;

            // dynamic state
            this.fog        = new Uint8Array(this.width * this.height); // 0 = unseen
            this.fog.fill(1);
            this.liveDots   = [];   // {x,y} sampled every 10 ticks
            this.deadDots   = [];   // {x,y,ttl}

            // render target (drawn into the GUI canvas once per frame)
            this.frame = new Lemmings.Frame(this.width, this.height);
            //this.renderFrame = new Lemmings.Frame(this.renderWidth, this.renderHeight);
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

        /** called by LemmingManager every 10 ticks */
        setLiveDots(arr) { this.liveDots = arr; }

        /** called by LemmingManager when a lemming dies */
        addDeath(x, y) {
            this.deadDots.push({ x: x * this.scaleX | 0, y: y * this.scaleY | 0, ttl: 30});
        }

        /** draw one frame of the minimap */
        render(viewX, viewW, scale = 1) {
            if (this.guiDisplay == null) return;

            // determine if we are rendering the larger minimap, or drawing the downscaled version of that to the display
            //const destination = (this.renderScale === 1) ? this.frame : this.renderFrame;

            for (let y = 0; y < this.frame.height; ++y) {
                for (let x = 0; x < this.frame.width; ++x) {
                    this.frame.setPixel(x, y, 0xFF000000);   // ARGB 0xAABBGGRR
                }
            }
            // 1. terrain (already revealed)
            const gm = this.level.getGroundMaskLayer();
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (!this.fog[y * this.width + x]) continue;
                    const gx = (x / this.scaleX) | 0;
                    const gy = (y / this.scaleY) | 0;
                    if (gm.hasGroundAt(gx, gy)) this.frame.setPixel(x, y, 0xFF003300);
                }
            }

            // // 2. level bounds
            // for (let x = 0; x < this.width; ++x) {
            //     this.frame.setPixel(x, 0,             0x00FF00FF);
            //     this.frame.setPixel(x, this.width - 1,  0x00FF00FF);
            // }
            // for (let mapBoundY = 0; mapBoundY < this.height; ++mapBoundY) {
            //     this.frame.setPixel(0,            mapBoundY, 0x00FF00FF);
            //     this.frame.setPixel(this.height - 1, mapBoundY, 0x00FF00FF);
            // }

            // 3. entrances (always green)
            for (const ent of this.level.entrances) {
                 const ex = (ent.x * this.scaleX) | 0;
                 const ey = (ent.y * this.scaleY) | 0;
                 this.frame.setPixel(ex, ey, 0xFF00AA00);
            }

            // 4. exits (blue only after revealed)
            for (const obj of this.level.objects) {
                 if (obj.triggerType == Lemmings.TriggerTypes.EXIT_LEVEL) {
                    const rx = (obj.x * this.scaleX) | 0;
                    const ry = (obj.y * this.scaleY) | 0;
                    // if (this.fog[ry * this.width + rx]) 
                    this.frame.setPixel(rx, ry, 0xFFFF0000);
                    this.frame.setPixel(rx, ry, 0xFFFF0000);
                 }

            }

            // 5. live lemmings (yellow)
            for (const p of this.liveDots) {
                let x = (p.x * this.scaleX | 0);
                let y = (p.y * this.scaleY | 0);
                this.frame.setPixel(x, y, 0xFF00FFFF);
            }

            // 6. deaths flashing (red)
            for (let i = this.deadDots.length - 1; i >= 0; --i) {
                const d = this.deadDots[i];
                if (--d.ttl <= 0) { this.deadDots.splice(i, 1); continue; }
                if (d.ttl & 4) this.frame.setPixel(d.x, d.y, 0xFF0000FF); // flash
            }

            // 7. current viewport (white rectangle)
            const vpX = Math.round(lemmings.stage.getGameViewRect().x * this.scaleX);
            const vpW = Math.round(lemmings.stage.getGameViewRect().w * this.scaleX);
            let vpXW = vpX + vpW;
            if (vpXW >= this.width) {
                vpXW = this.width-1;
            }
            const vpRectColor = 0x55FFFFFF;
            for (let y = 0; y < this.height; y++) {
                this.frame.setPixel(vpX, y, vpRectColor);
                if (y == 0 || y == this.height-1) {
                    for (let xx = vpX; xx < vpXW; xx++) {
                        this.frame.setPixel(xx, y, vpRectColor);
                    }
                }
                this.frame.setPixel(vpXW, y, vpRectColor);
            }

            // if (this.renderScale !== 1) {
            //     const renderBuffer = this.renderFrame.getBuffer();
            //     const buffer = this.frame.getBuffer();
            //     for (let y = 0; y < this.height; ++y) {
            //         for (let x = 0; x < this.width; ++x) {
            //             // nearest-neighbour 
            //             const src = renderBuffer[(y * this.renderScale) * this.renderWidth + (x * this.renderScale)];
            //             buffer[y * this.width + x] = src;
            //         }
            //     }
            //     // this.frame.getMask().fill(1);   // every pixel is now valid
            // }

            // blit to GUI canvas
            const destX = this.guiDisplay.getWidth()  - this.width;
            const destY = this.guiDisplay.getHeight() - this.height;
            
            // if (scale == 1) {
            //     this.render(viewX, viewW, 2);
            // }
            this.guiDisplay.drawFrame(this.frame, destX - 8, destY - 2);
        }
    }
    Lemmings.MiniMap = MiniMap;

export { MiniMap };
