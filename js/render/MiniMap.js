import { Frame } from './Frame.js';
import { TriggerTypes } from '../level/TriggerTypes.js';
import { getAppContext } from '../core/dependencies.js';
import {
  getRuntimeHistory,
  getRuntimePerformanceContext,
  isRuntimeReplayApplying
} from '../game/GameRuntime.js';

const getApp = (runtime = null) => getRuntimePerformanceContext(runtime) || getAppContext();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class MiniMap {
  static palette = null;
  static DEATH_DOT_TTL = 30;
  constructor(gameDisplay, level, guiDisplay, runtime = null) {
    this.gameDisplay = gameDisplay;
    this.level = level;
    this.guiDisplay = guiDisplay;
    this.runtime = runtime;

    this.width = 127;
    this.height = 24;
    this.size = this.width * this.height;
    const levelWidth = Number.isFinite(level?.width) && level.width > 0 ? level.width : this.width;
    const levelHeight = Number.isFinite(level?.height) && level.height > 0 ? level.height : this.height;
    this.levelWidth = levelWidth;
    this.levelHeight = levelHeight;
    this.scaleX = this.width / levelWidth;
    this.scaleY = this.height / levelHeight;

    this.terrain = new Uint8Array(this.size);
    this.terrainColors = new Uint32Array(this.size);
    this._terrainDirtyFlags = new Uint8Array(this.size);
    this._terrainDirtyIndices = new Uint16Array(this.size);
    this._terrainDirtyCount = 0;
    this._terrainDirtyRead = 0;
    this._terrainDirtyWrite = 0;
    this.terrainRevalidateBudget = Math.max(64, this.size >> 2);
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
    this.liveDotsLength = 0;
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
    this._frameNeedsCompose = true;
    this._lastViewRectX = Number.NaN;
    this._lastViewRectY = Number.NaN;
    this._lastViewRectW = Number.NaN;
    this._lastViewRectH = Number.NaN;
    this._lastViewDashOffset = Number.NaN;
    this._lastLiveDotsRef = this.liveDots;
    this._lastLiveDotsLength = 0;
    this._lastSelectedDotVisible = false;
    this._lastSelectedDotX = Number.NaN;
    this._lastSelectedDotY = Number.NaN;
    this._lastReversing = false;
    this._lastTerrainRevalidated = 0;
    this._renderStats = {
      draws: 0,
      composes: 0,
      reuses: 0,
      lastTerrainCells: 0,
      lastDeadCount: 0
    };
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

  /**
   * Translate minimap pointer coordinates into a clamped world viewport X.
   */
  #updateViewportFromPointer(event) {
    if (!this.guiDisplay || !this.level) return;
    if (!Number.isFinite(event?.x) || !Number.isFinite(event?.y)) return;
    const gd = this.guiDisplay;
    const destX = gd.worldDataSize.width - this.width;
    const destY = gd.worldDataSize.height - this.height;

    const mx = event.x - destX;
    const my = event.y - destY;
    if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return;

    const pct = this.width <= 1 ? 0 : (mx / (this.width - 1));
    const stageViewWidth = getApp(this.runtime)?.stage?.getGameViewRect?.()?.w;
    const viewportWorldWidth = Number.isFinite(stageViewWidth) && stageViewWidth > 0
      ? stageViewWidth
      : gd.worldDataSize.width;
    const maxOffset = Math.max(0, this.levelWidth - viewportWorldWidth);
    const newX = clamp(Math.trunc(pct * maxOffset), 0, maxOffset);
    this.level.screenPositionX = newX;
    gd.setScreenPosition?.(newX, 0, { preserveScale: true });
  }

  #handleMouseDown(event){
    if (!this.guiDisplay) return;
    this._mouseDown = true;
    this.#updateViewportFromPointer(event);
  }

  #handleMouseUp(event){
    if (!this.guiDisplay) return;
    this._mouseDown = false;
    this.#updateViewportFromPointer(event);
  }

  #handleMouseMove(event){
    if (!this.guiDisplay) return;
    if (!this._mouseDown) return;
    this.#updateViewportFromPointer(event);
  }

  /* Build complete terrain snapshot (expensive – call at load/reset only). */
  #buildTerrain() {
    const gm = this.level.getGroundMaskLayer();
    const levelWidth = this.levelWidth;
    const levelHeight = this.levelHeight;
    for (let mY = 0; mY < this.height; ++mY) {
      const ly1 = Math.floor(mY / this.scaleY);
      const ly2 = Math.min(levelHeight, Math.ceil((mY + 1) / this.scaleY));
      for (let mX = 0; mX < this.width; ++mX) {
        const lx1 = Math.floor(mX / this.scaleX);
        const lx2 = Math.min(levelWidth, Math.ceil((mX + 1) / this.scaleX));
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

  /**
   * Track dirty cells in a bounded ring so invalidation stays O(1) and capped.
   */
  #markTerrainCellDirty(idx) {
    if ((idx >>> 0) >= this.size) return;
    if (this._terrainDirtyFlags[idx]) return;
    if (this._terrainDirtyCount >= this.size) {
      const overwriteIdx = this._terrainDirtyIndices[this._terrainDirtyWrite];
      if ((overwriteIdx >>> 0) < this.size) {
        this._terrainDirtyFlags[overwriteIdx] = 0;
      }
      if (this._terrainDirtyRead === this._terrainDirtyWrite) {
        this._terrainDirtyRead = (this._terrainDirtyRead + 1) % this.size;
      }
    }
    this._terrainDirtyFlags[idx] = 1;
    this._terrainDirtyIndices[this._terrainDirtyWrite] = idx;
    this._terrainDirtyWrite += 1;
    if (this._terrainDirtyWrite === this.size) {
      this._terrainDirtyWrite = 0;
    }
    this._terrainDirtyCount = Math.min(this.size, this._terrainDirtyCount + 1);
  }

  #refreshTerrainCell(idx, groundMaskLayer = null) {
    const mX = idx % this.width;
    const mY = (idx / this.width) | 0;
    const lx1 = Math.floor(mX / this.scaleX);
    const lx2 = Math.min(this.levelWidth, Math.ceil((mX + 1) / this.scaleX));
    const ly1 = Math.floor(mY / this.scaleY);
    const ly2 = Math.min(this.levelHeight, Math.ceil((mY + 1) / this.scaleY));
    const gm = groundMaskLayer || this.level.getGroundMaskLayer();
    let count = gm.countMaskInRect(lx1, ly1, lx2 - lx1, ly2 - ly1, 72);
    if (count > 71) count = 72;
    this.#setTerrainCount(idx, count);
  }

  #flushTerrainInvalidation() {
    const dirtyCount = this._terrainDirtyCount;
    this._lastTerrainRevalidated = 0;
    if (!dirtyCount) return false;
    if (dirtyCount >= (this.size >> 1)) {
      this.#buildTerrain();
      this._terrainDirtyFlags.fill(0);
      this._terrainDirtyCount = 0;
      this._terrainDirtyRead = 0;
      this._terrainDirtyWrite = 0;
      this._lastTerrainRevalidated = this.size;
      return true;
    }
    let budget = this.terrainRevalidateBudget | 0;
    if (budget <= 0 || budget > dirtyCount) budget = dirtyCount;
    const dirty = this._terrainDirtyIndices;
    const flags = this._terrainDirtyFlags;
    const groundMaskLayer = this.level.getGroundMaskLayer();
    let read = this._terrainDirtyRead;
    for (let i = 0; i < budget; i += 1) {
      const idx = dirty[read];
      read += 1;
      if (read === this.size) read = 0;
      flags[idx] = 0;
      this.#refreshTerrainCell(idx, groundMaskLayer);
    }
    this._terrainDirtyRead = read;
    this._terrainDirtyCount = dirtyCount - budget;
    if (!this._terrainDirtyCount) {
      this._terrainDirtyRead = 0;
      this._terrainDirtyWrite = 0;
    }
    this._lastTerrainRevalidated = budget;
    return budget > 0;
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
    this._frameNeedsCompose = true;
  }

  /* Region‑based revalidation (e.g. after a large mask dig). */
  invalidateRegion(x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    const xStart = Math.max(0, Math.floor(x));
    const yStart = Math.max(0, Math.floor(y));
    const xEnd = Math.min(this.levelWidth, Math.ceil(x + w));
    const yEnd = Math.min(this.levelHeight, Math.ceil(y + h));
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
    this._frameNeedsCompose = true;
  }

  /** reveal terrain that is currently on screen */
  reveal(viewX, viewW) {
    const sx1 = Math.max(0, Math.floor(viewX * this.scaleX));
    const sx2 = Math.min(this.width, Math.ceil((viewX + viewW) * this.scaleX));
    if (sx2 <= sx1) return;
    for (let y = 0; y < this.height; ++y) {
      const row = y * this.width;
      for (let x = sx1; x < sx2; ++x) this.fog[row + x] = 1;
    }
    this._frameNeedsCompose = true;
  }

  setLiveDots(arr, activeLength) {
    // arr is a Uint8Array of scaled [x1,y1,x2,y2,...]
    this.liveDots = arr;
    const length = activeLength == null ? arr?.length : activeLength;
    this.liveDotsLength = Math.max(0, Math.min(arr?.length ?? 0, Math.trunc(length ?? 0)));
    this._frameNeedsCompose = true;
  }

  invalidateFrame() {
    this._frameNeedsCompose = true;
  }

  setSelectedDot(dot) {
    this.selectedDot = dot;
    this._frameNeedsCompose = true;
  }

  addDeath(x, y) {
    const sx = Math.max(0, Math.min(this.width - 1, (x * this.scaleX) | 0));
    const sy = Math.max(0, Math.min(this.height - 1, (y * this.scaleY) | 0));
    const history = getRuntimeHistory(this.runtime);
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
    this._frameNeedsCompose = true;
  }

  #decayDeathDots() {
    if (this.deadCount < 1) return false;
    let write = 0;
    const total = this.deadCount;
    let changed = false;
    for (let i = 0; i < total; ++i) {
      const ttl = this.deadTTLs[i] - 1;
      if (ttl <= 0) {
        changed = true;
        continue;
      }
      if (ttl !== this.deadTTLs[i] || write !== i) {
        changed = true;
      }
      this.deadTTLs[write] = ttl;
      const x = this.deadDots[i * 2];
      const y = this.deadDots[i * 2 + 1];
      this.deadDots[write * 2] = x;
      this.deadDots[write * 2 + 1] = y;
      write += 1;
    }
    this.deadCount = write;
    return changed;
  }

  getRenderDiagnostics() {
    return {
      ...this._renderStats,
      deadCount: this.deadCount,
      terrainDirtyCount: this._terrainDirtyCount
    };
  }

  render() {
    const terrainChanged = this.#flushTerrainInvalidation();
    if (terrainChanged) {
      this._frameNeedsCompose = true;
    }
    if (!this.guiDisplay) return false;
    const app = getApp(this.runtime);
    const reversing = isRuntimeReplayApplying(this.runtime);
    this._renderStats.draws += 1;

    let dashChanged = false;
    if (++this._viewportCounter >= this.viewportDashDelay) {
      this._viewportCounter = 0;
      this.viewportDashOffset += 1;
      dashChanged = true;
    }

    const {
      width: W,
      height: H,
      frame,
    } = this;
    const frameData = frame.data;

    const viewRect = app?.stage?.getGameViewRect?.();
    if (!viewRect) return false;
    const vpX = (viewRect.x * this.scaleX) | 0;
    let vpW = (viewRect.w * this.scaleX) | 0;
    const vpY = (viewRect.y * this.scaleY) | 0;
    const vpH = (viewRect.h * this.scaleY) | 0;
    const viewChanged =
      this._lastViewRectX !== vpX ||
      this._lastViewRectY !== vpY ||
      this._lastViewRectW !== vpW ||
      this._lastViewRectH !== vpH ||
      this._lastViewDashOffset !== this.viewportDashOffset;
    if (viewChanged || dashChanged) {
      this._frameNeedsCompose = true;
      this._lastViewRectX = vpX;
      this._lastViewRectY = vpY;
      this._lastViewRectW = vpW;
      this._lastViewRectH = vpH;
      this._lastViewDashOffset = this.viewportDashOffset;
    }

    if (this.liveDots !== this._lastLiveDotsRef || this.liveDotsLength !== this._lastLiveDotsLength) {
      this._frameNeedsCompose = true;
      this._lastLiveDotsRef = this.liveDots;
      this._lastLiveDotsLength = this.liveDotsLength;
    }
    const selectedVisible = !!this.selectedDot;
    const selectedX = selectedVisible ? this.selectedDot[0] : Number.NaN;
    const selectedY = selectedVisible ? this.selectedDot[1] : Number.NaN;
    const selectedChanged =
      this._lastSelectedDotVisible !== selectedVisible ||
      (selectedVisible && (
        this._lastSelectedDotX !== selectedX ||
        this._lastSelectedDotY !== selectedY
      ));
    if (selectedChanged) {
      this._frameNeedsCompose = true;
      this._lastSelectedDotVisible = selectedVisible;
      this._lastSelectedDotX = selectedX;
      this._lastSelectedDotY = selectedY;
    }
    if (reversing !== this._lastReversing) {
      this._frameNeedsCompose = true;
      this._lastReversing = reversing;
    }
    if (!reversing && this.#decayDeathDots()) {
      this._frameNeedsCompose = true;
    }

    if (this._frameNeedsCompose) {
      frameData.set(this.terrainColors);
      this.#paintObjectMarkers(frameData);

      let vpXW = vpX + vpW;
      // dumb fix to keep right edge of viewport rect visible
      if (vpXW === this.width) {
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
      for (let i = 0; i < this.liveDotsLength; i += 2) {
        const x = this.liveDots[i];
        const y = this.liveDots[i + 1];
        if ((x >>> 0) < W && (y >>> 0) < H) {
          frameData[(y * W) + x] = 0xFF00FFFF;
        }
      }
      if (this.selectedDot) {
        const x = this.selectedDot[0];
        const y = this.selectedDot[1];
        if ((x >>> 0) < W && (y >>> 0) < H) {
          frameData[(y * W) + x] = 0xFFFFFFFF;
        }
      }

      /* Death flashes */
      const total = this.deadCount;
      for (let i = 0; i < total; ++i) {
        const ttl = this.deadTTLs[i];
        if (ttl <= 0) continue;
        if (ttl & 4) {
          const x = this.deadDots[i * 2];
          const y = this.deadDots[i * 2 + 1];
          if ((x >>> 0) < W && (y >>> 0) < H) {
            frameData[(y * W) + x] = 0xFF0000FF;
          }
        }
      }
      this._renderStats.composes += 1;
      this._frameNeedsCompose = false;
    } else {
      this._renderStats.reuses += 1;
      this._renderStats.lastTerrainCells = this._lastTerrainRevalidated;
      this._renderStats.lastDeadCount = this.deadCount;
      return false;
    }

    this._renderStats.lastTerrainCells = this._lastTerrainRevalidated;
    this._renderStats.lastDeadCount = this.deadCount;

    /* Blit */
    const destX = this.guiDisplay.worldDataSize.width  - W;
    const destY = this.guiDisplay.worldDataSize.height - H;
    this.guiDisplay.drawFrame(frame, destX, destY);
    return true;
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
    this.liveDotsLength = 0;
    this.selectedDot = null;
    this.deadDots = null;
    this.deadTTLs = null;
    this.deadCount = 0;
    this.frame = null;
    this.runtime = null;
  }
}

export {
  MiniMap
};
