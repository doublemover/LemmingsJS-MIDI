import { Lemming } from '../lemmings/Lemming.js';

class ProcgenController {
  constructor({ view, game, level, options = {} }) {
    this.view = view || null;
    this.game = game || null;
    this.level = level || null;
    this._tickHandler = null;
    this._running = false;
    this._cameraX = 0;
    this._groundEndX = 0;
    this._groundTopY = 0;
    this._segmentColorIndex = 0;

    this.groundHeight = Number.isFinite(options.groundHeight) ? options.groundHeight : 8;
    this.groundColorIndex = Number.isFinite(options.groundColorIndex) ? options.groundColorIndex : 1;
    this.initialGroundWidth = Number.isFinite(options.initialGroundWidth) ? options.initialGroundWidth : 160;
    this.segmentMinWidth = Number.isFinite(options.segmentMinWidth) ? options.segmentMinWidth : 24;
    this.segmentMaxWidth = Number.isFinite(options.segmentMaxWidth) ? options.segmentMaxWidth : 64;
    this.extendThreshold = Number.isFinite(options.extendThreshold) ? options.extendThreshold : 16;
    this.lookAhead = Number.isFinite(options.lookAhead) ? options.lookAhead : 64;
    this.followLerp = Number.isFinite(options.followLerp) ? options.followLerp : 0.12;
    this.maxStepUp = Number.isFinite(options.maxStepUp) ? options.maxStepUp : 3;
    this.maxDrop = Number.isFinite(options.maxDrop) ? options.maxDrop : (Lemming.LEM_MAX_FALLING - 1);
  }

  start() {
    if (this._running) return;
    if (!this.game || !this.level) return;
    this._running = true;
    this._initGround();
    const stage = this.view?.stage || null;
    if (stage?.gameImgProps?.viewPoint) {
      this._cameraX = stage.gameImgProps.viewPoint.x || 0;
    }
    this._bindTimer();
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    this._unbindTimer();
  }

  _bindTimer() {
    const timer = this.game?.getGameTimer?.();
    if (!timer?.onGameTick?.on) return;
    this._tickHandler = () => this._onTick();
    timer.onGameTick.on(this._tickHandler);
  }

  _unbindTimer() {
    const timer = this.game?.getGameTimer?.();
    if (!timer?.onGameTick?.off || !this._tickHandler) return;
    timer.onGameTick.off(this._tickHandler);
    this._tickHandler = null;
  }

  _initGround() {
    const entrance = this.level?.entrances?.[0] || null;
    const entranceX = Number.isFinite(entrance?.x) ? entrance.x : 0;
    const startX = Math.max(0, entranceX - Math.floor(this.initialGroundWidth / 4));
    this._groundTopY = Math.max(0, (this.level?.height ?? 0) - this.groundHeight);
    this._segmentColorIndex = this.groundColorIndex;
    this._paintGround(startX, this.initialGroundWidth, this._groundTopY, this._segmentColorIndex);
    this._groundEndX = Math.max(this._groundEndX, startX + this.initialGroundWidth);
  }

  _onTick() {
    if (!this._running) return;
    const rightmost = this._getRightmostX();
    if (!Number.isFinite(rightmost)) return;
    this._ensureGround(rightmost);
    this._updateCamera(rightmost);
  }

  _getRightmostX() {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.activeLemmings || manager?.lemmings || [];
    let max = null;
    for (const lem of lems) {
      if (!lem || lem.removed || lem.disabled) continue;
      if (max == null || lem.x > max) max = lem.x;
    }
    if (max == null) {
      const entrance = this.level?.entrances?.[0] || null;
      return Number.isFinite(entrance?.x) ? entrance.x : null;
    }
    return max;
  }

  _ensureGround(rightmostX) {
    const levelWidth = this.level?.width ?? 0;
    if (!Number.isFinite(levelWidth) || levelWidth <= 0) return;
    while (rightmostX + this.lookAhead >= this._groundEndX - this.extendThreshold) {
      if (this._groundEndX >= levelWidth) break;
      const segmentWidth = this._pickSegmentWidth();
      const nextTop = this._pickNextTopY();
      const colorIndex = this._getNextColorIndex();
      this._paintGround(this._groundEndX, segmentWidth, nextTop, colorIndex);
      this._groundTopY = nextTop;
      this._groundEndX = Math.min(levelWidth, this._groundEndX + segmentWidth);
    }
  }

  _paintGround(startX, width, topY, colorIndex) {
    if (!this.level) return;
    const levelWidth = this.level.width;
    const levelHeight = this.level.height;
    const x0 = Math.max(0, startX);
    const x1 = Math.min(levelWidth, startX + width);
    const top = Number.isFinite(topY) ? topY : levelHeight - this.groundHeight;
    const y0 = Math.max(0, Math.min(levelHeight - this.groundHeight, top));
    const y1 = Math.min(levelHeight, y0 + this.groundHeight);
    const paletteIndex = Number.isFinite(colorIndex) ? colorIndex : this.groundColorIndex;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        this.level.setGroundAt(x, y, paletteIndex);
      }
    }
  }

  _pickSegmentWidth() {
    const min = Math.max(4, Math.floor(this.segmentMinWidth));
    const max = Math.max(min, Math.floor(this.segmentMaxWidth));
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  _pickNextTopY() {
    const levelHeight = this.level?.height ?? 0;
    const maxTop = Math.max(0, levelHeight - this.groundHeight);
    const up = Math.max(0, Math.floor(this.maxStepUp));
    const down = Math.max(0, Math.floor(this.maxDrop));
    const delta = Math.floor(Math.random() * (up + down + 1)) - up;
    const next = this._groundTopY + delta;
    return Math.max(0, Math.min(maxTop, next));
  }

  _getNextColorIndex() {
    const maxIndex = 15;
    const base = Number.isFinite(this.groundColorIndex) && this.groundColorIndex > 0
      ? this.groundColorIndex
      : 1;
    if (!Number.isFinite(this._segmentColorIndex) || this._segmentColorIndex <= 0) {
      this._segmentColorIndex = base;
    }
    let next = (this._segmentColorIndex % maxIndex) + 1;
    if (next === 0) next = 1;
    this._segmentColorIndex = next;
    return next;
  }

  _updateCamera(rightmostX) {
    const stage = this.view?.stage;
    const stageImage = stage?.gameImgProps;
    if (!stage || !stageImage) return;
    const scale = stageImage.viewPoint.scale || 1;
    const viewW = stageImage.canvasViewportSize.width / scale;
    if (!Number.isFinite(viewW) || viewW <= 0) return;
    const targetX = rightmostX - viewW / 2;
    this._cameraX += (targetX - this._cameraX) * this.followLerp;
    stage.applyViewport(stageImage, this._cameraX, 0, stageImage.viewPoint.scale);
  }
}

export { ProcgenController };
