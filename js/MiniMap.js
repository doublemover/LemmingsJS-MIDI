import {
  Lemmings
} from './LemmingsNamespace.js';

class MiniMap {
  static palette = null;
  static DEATH_DOT_TTL = 30;
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
    this.selectedDot = null;
    // typed arrays storing [x1,y1,x2,y2,...] and TTL per dot
    this.deadDots = new Uint8Array(0);
    this.deadTTLs = new Uint8Array(0);

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
    for (let mY = 0; mY < this.height; ++mY) {
      const ly1 = Math.floor(mY / this.scaleY);
      const ly2 = Math.min(this.level.height, Math.ceil((mY + 1) / this.scaleY));
      for (let mX = 0; mX < this.width; ++mX) {
        const lx1 = Math.floor(mX / this.scaleX);
        const lx2 = Math.min(this.level.width, Math.ceil((mX + 1) / this.scaleX));
        const layer = gm.getSubLayer(lx1, ly1, lx2 - lx1, ly2 - ly1);
        let count = 0;
        for (const v of layer.mask) {
          if (v) {
            if (++count === 128) break;
          }
        }
        if (count > 71) count = 72;
        this.terrain[mY * this.width + mX] = count;
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

        const layer = gm.getSubLayer(lx1, ly1, lx2 - lx1, ly2 - ly1);
        let count = 0;
        for (const v of layer.mask) {
          if (v) {
            if (++count === 128) break;
          }
        }
        if (count > 71) count = 72;
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

  setSelectedDot(dot) {
    this.selectedDot = dot;
  }

  addDeath(x, y) {
    const sx = Math.max(0, Math.min(this.width - 1, (x * this.scaleX) | 0));
    const sy = Math.max(0, Math.min(this.height - 1, (y * this.scaleY) | 0));

    const coords = new Uint8Array(this.deadDots.length + 2);
    const ttls = new Uint8Array(this.deadTTLs.length + 1);
    coords.set(this.deadDots);
    ttls.set(this.deadTTLs);
    coords[coords.length - 2] = sx;
    coords[coords.length - 1] = sy;
    ttls[ttls.length - 1] = MiniMap.DEATH_DOT_TTL;
    this.deadDots = coords;
    this.deadTTLs = ttls;
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

    const viewRect = lemmings.stage.getGameViewRect();
    const vpX = (viewRect.x * this.scaleX) | 0;
    let vpW = (viewRect.w * this.scaleX) | 0;
    const vpY = (viewRect.y * this.scaleY) | 0;
    const vpH = (viewRect.h * this.scaleY) | 0;
    let vpXW = vpX + vpW;
    // dumb fix to keep right edge of viewport rect visible
    if (vpXW == this.width) {
      vpW -= 1;
    }
    const vpRectColor = 0xFFFFFFFF;
    frame.drawRect(vpX, vpY, 0, vpH, vpRectColor, false, false);
    frame.drawRect(vpX + vpW, vpY, 0, vpH, vpRectColor, false, false);
    if (vpH < this.height) {
      frame.drawRect(vpX, vpY, vpW, 0, vpRectColor, false, false);
      frame.drawRect(vpX, vpY + vpH, vpW, 0, vpRectColor, false, false);
    }

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

    /* Live lemmings */
    for (let i = 0; i < this.liveDots.length; i += 2) {
      const x = this.liveDots[i];
      const y = this.liveDots[i + 1];
      frame.setPixel(x, y, 0x5500FFFF);
    }
    if (this.selectedDot) {
      frame.setPixel(this.selectedDot[0], this.selectedDot[1], 0xFFFFFFFF);
    }

    /* Death flashes */
    for (let i = this.deadTTLs.length - 1; i >= 0; --i) {
      const ttl = this.deadTTLs[i] - 1;
      this.deadTTLs[i] = ttl;
      if (ttl <= 0) {
        if (i < this.deadTTLs.length - 1) {
          this.deadDots.copyWithin(i * 2, (i + 1) * 2);
          this.deadTTLs.copyWithin(i, i + 1);
        }
        this.deadDots = this.deadDots.slice(0, -2);
        this.deadTTLs = this.deadTTLs.slice(0, -1);
        continue;
      }
      if (ttl & 4) {
        const x = this.deadDots[i * 2];
        const y = this.deadDots[i * 2 + 1];
        frame.setPixel(x, y, 0xFF0000FF);
      }
    }

    /* Blit */
    const destX = this.guiDisplay.getWidth() - W;
    const destY = this.guiDisplay.getHeight() - H;
    this.guiDisplay.drawFrame(frame, destX, destY);
  }

  dispose() {
    if (this.guiDisplay && this._displayListeners) {
      for (const [event, handler] of this._displayListeners) {
        this.guiDisplay[event].off(handler);
      }
      this._displayListeners = null;
    }
    this.gameDisplay = null;
    this.level = null;
    this.guiDisplay = null;
    this.terrain = null;
    this.fog = null;
    this.liveDots = null;
    this.selectedDot = null;
    this.deadDots = null;
    this.deadTTLs = null;
    this.frame = null;
  }
}
Lemmings.MiniMap = MiniMap;

export {
  MiniMap
};
