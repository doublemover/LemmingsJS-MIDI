import { Frame } from './Frame.js';
import { TriggerTypes } from '../level/TriggerTypes.js';
import { getAppContext } from '../core/dependencies.js';

const getApp = () => {
  const app = getAppContext();
  if (app) return app;
  if (typeof globalThis !== 'undefined' && globalThis.lemmings) return globalThis.lemmings;
  if (typeof lemmings !== 'undefined') return lemmings;
  return null;
};

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
    this.terrainColors = new Uint32Array(this.size);
    this._terrainDirtyFlags = new Uint8Array(this.size);
    this._terrainDirtyIndices = new Uint16Array(this.size);
    this._terrainDirtyCount = 0;
    this._objectMarkerIndices = new Uint16Array(0);
    this._objectMarkerColors = new Uint32Array(0);

    if (!MiniMap.palette) {
      MiniMap.palette = new Uint32Array(129);
      for (let i = 1; i <= 128; ++i) {
        MiniMap.palette[i] = 0xFF000000 | ((i*2) << 8);
      }
    }
    this.#buildTerrain();
    this.#buildObjectMarkers();

    // dynamic state
    this.fog = new Uint8Array(this.size); // 0 = unseen
    this.fog.fill(1); // disabled
    // typed array storing [x1,y1,x2,y2,...] scaled to minimap
    this.liveDots = new Uint8Array(0);
    this.selectedDot = null;
    // typed arrays storing [x1,y1,x2,y2,...] and TTL per dot
    this.deadDots = new Uint8Array(64);
    this.deadTTLs = new Uint8Array(32);
    this.deadCount = 0;

    // render target (drawn into the GUI canvas once per frame)
    this.frame = new Frame(this.width, this.height);
    this.frame.mask.fill(1);
    //this.renderFrame = new Frame(this.renderWidth, this.renderHeight);

    this._displayListeners = null;
    this._mouseDown = false;
    this.viewportDashOffset = 0;
    this._viewportCounter = 0;
    this.viewportDashDelay = 100;
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
    const destX = gd.worldDataSize.width  - this.width;
    const destY = gd.worldDataSize.height - this.height - 1;

    const mx = event.x - destX;
    const my = event.y - destY;
    if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return;
        
    const pct = mx / this.width;
    const newX = ((this.level.width - gd.worldDataSize.width) * pct) | 0;
    this.level.screenPositionX = newX;
    gd.setScreenPosition?.(newX, 0, { preserveScale: true });
  }

  #handleMouseUp(event){
    if (!this.guiDisplay) return;
    this._mouseDown = false;
    const gd = this.guiDisplay;
    const destX = gd.worldDataSize.width  - this.width;
    const destY = gd.worldDataSize.height - this.height - 1;

    const mx = event.x - destX;
    const my = event.y - destY;
    if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return;
    const pct = mx / this.width;
    const newX = ((this.level.width - gd.worldDataSize.width) * pct) | 0;
    this.level.screenPositionX = newX;
    gd.setScreenPosition?.(newX, 0, { preserveScale: true });
  }

  #handleMouseMove(event){
    if (!this.guiDisplay) return;
    if (!this._mouseDown) return;
    const gd = this.guiDisplay;
    const { width: gdW, height: gdH } = gd.worldDataSize;

    const destX = gd.worldDataSize.width  - this.width;
    const destY = gd.worldDataSize.height - this.height - 1;

    const mx = event.x - destX;
    const my = event.y - destY;
    if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return;

    const pct = mx / this.width;
    const newX = ((this.level.width - gd.worldDataSize.width) * pct) | 0;
    this.level.screenPositionX = newX;
    gd.setScreenPosition?.(newX, 0, { preserveScale: true });
  }

  /* Build complete terrain snapshot (expensive – call at load/reset only). */
  #buildTerrain() {
    const gm = this.level.getGroundMaskLayer();
    for (let mY = 0; mY < this.height; ++mY) {
      const ly1 = Math.floor(mY / this.scaleY);
      const ly2 = Math.min(this.level.height, Math.ceil((mY + 1) / this.scaleY));
      for (let mX = 0; mX < this.width; ++mX) {
        const lx1 = Math.floor(mX / this.scaleX);
        const lx2 = Math.min(this.level.width, Math.ceil((mX + 1) / this.scaleX));
        let count = gm.countMaskInRect(lx1, ly1, lx2 - lx1, ly2 - ly1, 72);
        if (count > 71) count = 72;
        this.#setTerrainCount(mY * this.width + mX, count);
      }
    }
  }

  #setTerrainCount(idx, count) {
    const normalized = Math.max(0, Math.min(128, count | 0));
    this.terrain[idx] = normalized;
    this.terrainColors[idx] = MiniMap.palette[normalized] || 0xFF000000;
  }

  #markTerrainCellDirty(idx) {
    if ((idx >>> 0) >= this.size) return;
    if (this._terrainDirtyFlags[idx]) return;
    this._terrainDirtyFlags[idx] = 1;
    this._terrainDirtyIndices[this._terrainDirtyCount] = idx;
    this._terrainDirtyCount += 1;
  }

  #refreshTerrainCell(idx) {
    const mX = idx % this.width;
    const mY = (idx / this.width) | 0;
    const lx1 = Math.floor(mX / this.scaleX);
    const lx2 = Math.min(this.level.width, Math.ceil((mX + 1) / this.scaleX));
    const ly1 = Math.floor(mY / this.scaleY);
    const ly2 = Math.min(this.level.height, Math.ceil((mY + 1) / this.scaleY));
    const gm = this.level.getGroundMaskLayer();
    let count = gm.countMaskInRect(lx1, ly1, lx2 - lx1, ly2 - ly1, 72);
    if (count > 71) count = 72;
    this.#setTerrainCount(idx, count);
  }

  #flushTerrainInvalidation() {
    const dirtyCount = this._terrainDirtyCount;
    if (!dirtyCount) return;
    if (dirtyCount >= (this.size >> 1)) {
      this.#buildTerrain();
      this._terrainDirtyFlags.fill(0);
      this._terrainDirtyCount = 0;
      return;
    }
    const dirty = this._terrainDirtyIndices;
    const flags = this._terrainDirtyFlags;
    for (let i = 0; i < dirtyCount; i += 1) {
      const idx = dirty[i];
      flags[idx] = 0;
      this.#refreshTerrainCell(idx);
    }
    this._terrainDirtyCount = 0;
  }

  #buildObjectMarkers() {
    const markerMap = new Map();
    const objects = this.level?.objects || [];
    for (let i = 0; i < objects.length; i += 1) {
      const obj = objects[i];
      const rx = (obj.x * this.scaleX) | 0;
      const ry = (obj.y * this.scaleY) | 0;
      if ((obj.ob?.id === 1)) {
        const idx = ((ry + 2) * this.width) + (rx + 2);
        if ((idx >>> 0) < this.size) markerMap.set(idx, 0xFF00AA00);
      }
      if (obj.triggerType === TriggerTypes.EXIT_LEVEL) {
        const idxA = ((ry + 2) * this.width) + (rx + 2);
        const idxB = ((ry + 1) * this.width) + (rx + 2);
        if ((idxA >>> 0) < this.size) markerMap.set(idxA, 0xFFFF00CC);
        if ((idxB >>> 0) < this.size) markerMap.set(idxB, 0xFFFF00CC);
      }
    }
    const count = markerMap.size;
    if (!count) {
      this._objectMarkerIndices = new Uint16Array(0);
      this._objectMarkerColors = new Uint32Array(0);
      return;
    }
    const indices = new Uint16Array(count);
    const colors = new Uint32Array(count);
    let index = 0;
    for (const [markerIdx, markerColor] of markerMap) {
      indices[index] = markerIdx;
      colors[index] = markerColor;
      index += 1;
    }
    this._objectMarkerIndices = indices;
    this._objectMarkerColors = colors;
  }

  #paintObjectMarkers(frameData) {
    const indices = this._objectMarkerIndices;
    const colors = this._objectMarkerColors;
    for (let i = 0; i < indices.length; i += 1) {
      frameData[indices[i]] = colors[i];
    }
  }

  /* Fast per‑pixel update called by digging/mining/placing ground.
         Supply removed=true for clearing ground, false for placing. */
  onGroundChanged(px, py, removed = true) {
    const mX = (px * this.scaleX) | 0;
    const mY = (py * this.scaleY) | 0;
    if (mX < 0 || mX >= this.width || mY < 0 || mY >= this.height) return;
    const idx = mY * this.width + mX;
    let next = this.terrain[idx];
    if (removed) next -= 1;
    else next += 1;
    this.#setTerrainCount(idx, next);
    this.#markTerrainCellDirty(idx);
  }

  /* Region‑based revalidation (e.g. after a large mask dig). */
  invalidateRegion(x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    const xStart = Math.max(0, Math.floor(x));
    const yStart = Math.max(0, Math.floor(y));
    const xEnd = Math.min(this.level.width, Math.ceil(x + w));
    const yEnd = Math.min(this.level.height, Math.ceil(y + h));
    if (xEnd <= xStart || yEnd <= yStart) return;

    const mX0 = Math.max(0, Math.floor(xStart * this.scaleX));
    const mY0 = Math.max(0, Math.floor(yStart * this.scaleY));
    const mX1 = Math.min(this.width - 1, Math.floor((xEnd - 1) * this.scaleX));
    const mY1 = Math.min(this.height - 1, Math.floor((yEnd - 1) * this.scaleY));

    for (let mY = mY0; mY <= mY1; mY += 1) {
      for (let mX = mX0; mX <= mX1; mX += 1) {
        this.#markTerrainCellDirty((mY * this.width) + mX);
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
    const history = getApp()?.game?.history ?? null;
    if (history?.recordMinimapDeath) {
      history.recordMinimapDeath({
        x: sx,
        y: sy,
        ttl: MiniMap.DEATH_DOT_TTL,
        prevCount: this.deadCount
      });
    }

    if (this.deadCount >= this.deadTTLs.length) {
      const next = Math.max(4, this.deadTTLs.length * 2);
      const coords = new Uint8Array(next * 2);
      const ttls = new Uint8Array(next);
      coords.set(this.deadDots.subarray(0, this.deadCount * 2));
      ttls.set(this.deadTTLs.subarray(0, this.deadCount));
      this.deadDots = coords;
      this.deadTTLs = ttls;
    }

    const idx = this.deadCount++;
    this.deadDots[idx * 2] = sx;
    this.deadDots[idx * 2 + 1] = sy;
    this.deadTTLs[idx] = MiniMap.DEATH_DOT_TTL;
  }

  render() {
    this.#flushTerrainInvalidation();
    if (!this.guiDisplay) return;
    const app = getApp();
    const reversing = !!app?.game?.timeTravel?.isReversing;

    if (++this._viewportCounter >= this.viewportDashDelay) {
      this._viewportCounter = 0;
      this.viewportDashOffset += 1;
    }

    const {
      width: W,
      height: H,
      frame,
    } = this;
    const frameData = frame.data;
    const writePixel = (x, y, color) => {
      if ((x >>> 0) >= W || (y >>> 0) >= H) return;
      frameData[(y * W) + x] = color;
    };

    frameData.set(this.terrainColors);
    this.#paintObjectMarkers(frameData);

    const viewRect = app?.stage?.getGameViewRect?.();
    if (!viewRect) return;
    const vpX = (viewRect.x * this.scaleX) | 0;
    let vpW = (viewRect.w * this.scaleX) | 0;
    const vpY = (viewRect.y * this.scaleY) | 0;
    const vpH = (viewRect.h * this.scaleY) | 0;
    let vpXW = vpX + vpW;
    // dumb fix to keep right edge of viewport rect visible
    if (vpXW == this.width) {
      vpW -= 1;
    }
    frame.drawMarchingAntRect(
      vpX,
      vpY,
      vpW,
      vpH,
      2,
      this.viewportDashOffset,
      0xFF00FF00,
      0xFF005500
    );

    /* Live lemmings */
    for (let i = 0; i < this.liveDots.length; i += 2) {
      const x = this.liveDots[i];
      const y = this.liveDots[i + 1];
      writePixel(x, y, 0xFF00FFFF);
    }
    if (this.selectedDot) {
      writePixel(this.selectedDot[0], this.selectedDot[1], 0xFFFFFFFF);
    }

    /* Death flashes */
    if (reversing) {
      const total = this.deadCount;
      for (let i = 0; i < total; ++i) {
        const ttl = this.deadTTLs[i];
        if (ttl <= 0) continue;
        if (ttl & 4) {
          const x = this.deadDots[i * 2];
          const y = this.deadDots[i * 2 + 1];
          writePixel(x, y, 0xFF0000FF);
        }
      }
    } else {
      let write = 0;
      const total = this.deadCount;
      for (let i = 0; i < total; ++i) {
        const ttl = this.deadTTLs[i] - 1;
        if (ttl <= 0) continue;
        this.deadTTLs[write] = ttl;
        const x = this.deadDots[i * 2];
        const y = this.deadDots[i * 2 + 1];
        this.deadDots[write * 2] = x;
        this.deadDots[write * 2 + 1] = y;
        if (ttl & 4) {
          writePixel(x, y, 0xFF0000FF);
        }
        write++;
      }
      this.deadCount = write;
    }

    /* Blit */
    const destX = this.guiDisplay.worldDataSize.width  - W;
    const destY = this.guiDisplay.worldDataSize.height - H;
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
    this.deadCount = 0;
    this.frame = null;
  }
}

export {
  MiniMap
};
