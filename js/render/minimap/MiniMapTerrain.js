import {
  Frame,
  TriggerTypes,
  clamp,
  getApp,
  getAppContext,
  getRuntimeHistory,
  getRuntimePerformanceContext,
  isRuntimeReplayApplying
} from './MiniMapShared.js';
const miniMapTerrainMethods = {
  _buildTerrain() {
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
        this._setTerrainCount(mY * this.width + mX, count);
      }
    }
  },

  _setTerrainCount(idx, count) {
    const normalized = Math.max(0, Math.min(128, count | 0));
    this.terrain[idx] = normalized;
    this.terrainColors[idx] = this.constructor.palette[normalized] || 0xFF000000;
  },

  _markTerrainCellDirty(idx) {
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
  },

  _refreshTerrainCell(idx, groundMaskLayer = null) {
    const mX = idx % this.width;
    const mY = (idx / this.width) | 0;
    const lx1 = Math.floor(mX / this.scaleX);
    const lx2 = Math.min(this.levelWidth, Math.ceil((mX + 1) / this.scaleX));
    const ly1 = Math.floor(mY / this.scaleY);
    const ly2 = Math.min(this.levelHeight, Math.ceil((mY + 1) / this.scaleY));
    const gm = groundMaskLayer || this.level.getGroundMaskLayer();
    let count = gm.countMaskInRect(lx1, ly1, lx2 - lx1, ly2 - ly1, 72);
    if (count > 71) count = 72;
    this._setTerrainCount(idx, count);
  },

  _flushTerrainInvalidation() {
    const dirtyCount = this._terrainDirtyCount;
    this._lastTerrainRevalidated = 0;
    if (!dirtyCount) return false;
    if (dirtyCount >= (this.size >> 1)) {
      this._buildTerrain();
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
      this._refreshTerrainCell(idx, groundMaskLayer);
    }
    this._terrainDirtyRead = read;
    this._terrainDirtyCount = dirtyCount - budget;
    if (!this._terrainDirtyCount) {
      this._terrainDirtyRead = 0;
      this._terrainDirtyWrite = 0;
    }
    this._lastTerrainRevalidated = budget;
    return budget > 0;
  },

  _buildObjectMarkers() {
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
  },

  _paintObjectMarkers(frameData) {
    const indices = this._objectMarkerIndices;
    const colors = this._objectMarkerColors;
    for (let i = 0; i < indices.length; i += 1) {
      frameData[indices[i]] = colors[i];
    }
  },

  onGroundChanged(px, py, removed = true) {
    const mX = (px * this.scaleX) | 0;
    const mY = (py * this.scaleY) | 0;
    if (mX < 0 || mX >= this.width || mY < 0 || mY >= this.height) return;
    const idx = mY * this.width + mX;
    let next = this.terrain[idx];
    if (removed) next -= 1;
    else next += 1;
    this._setTerrainCount(idx, next);
    this._markTerrainCellDirty(idx);
    this._frameNeedsCompose = true;
  },

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
        this._markTerrainCellDirty((mY * this.width) + mX);
      }
    }
    this._frameNeedsCompose = true;
  },

  reveal(viewX, viewW) {
    const sx1 = Math.max(0, Math.floor(viewX * this.scaleX));
    const sx2 = Math.min(this.width, Math.ceil((viewX + viewW) * this.scaleX));
    if (sx2 <= sx1) return;
    for (let y = 0; y < this.height; ++y) {
      const row = y * this.width;
      for (let x = sx1; x < sx2; ++x) this.fog[row + x] = 1;
    }
    this._frameNeedsCompose = true;
  },

  setLiveDots(arr, activeLength) {
    // arr is a Uint8Array of scaled [x1,y1,x2,y2,...]
    this.liveDots = arr;
    const length = activeLength == null ? arr?.length : activeLength;
    this.liveDotsLength = Math.max(0, Math.min(arr?.length ?? 0, Math.trunc(length ?? 0)));
    this._frameNeedsCompose = true;
  },

  invalidateFrame() {
    this._frameNeedsCompose = true;
  },

  setSelectedDot(dot) {
    this.selectedDot = dot;
    this._frameNeedsCompose = true;
  },

  addDeath(x, y) {
    const sx = Math.max(0, Math.min(this.width - 1, (x * this.scaleX) | 0));
    const sy = Math.max(0, Math.min(this.height - 1, (y * this.scaleY) | 0));
    const history = getRuntimeHistory(this.runtime);
    if (history?.recordMinimapDeath) {
      history.recordMinimapDeath({
        x: sx,
        y: sy,
        ttl: this.constructor.DEATH_DOT_TTL,
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
    this.deadTTLs[idx] = this.constructor.DEATH_DOT_TTL;
    this._frameNeedsCompose = true;
  },

  _decayDeathDots() {
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
  },

  getRenderDiagnostics() {
    return {
      ...this._renderStats,
      deadCount: this.deadCount,
      terrainDirtyCount: this._terrainDirtyCount
    };
  }
};
export { miniMapTerrainMethods };
