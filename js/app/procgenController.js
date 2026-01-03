class ProcgenController {
  constructor({ view, game, level, options = {} }) {
    this.view = view || null;
    this.game = game || null;
    this.level = level || null;
    this._tickHandler = null;
    this._running = false;
    this._cameraX = 0;
    this._groundEndX = 0;

    this.groundHeight = Number.isFinite(options.groundHeight) ? options.groundHeight : 8;
    this.groundColorIndex = Number.isFinite(options.groundColorIndex) ? options.groundColorIndex : 1;
    this.initialGroundWidth = Number.isFinite(options.initialGroundWidth) ? options.initialGroundWidth : 240;
    this.segmentWidth = Number.isFinite(options.segmentWidth) ? options.segmentWidth : 160;
    this.extendThreshold = Number.isFinite(options.extendThreshold) ? options.extendThreshold : 80;
    this.lookAhead = Number.isFinite(options.lookAhead) ? options.lookAhead : 240;
    this.followLerp = Number.isFinite(options.followLerp) ? options.followLerp : 0.12;
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
    this._paintGround(startX, this.initialGroundWidth);
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
      this._paintGround(this._groundEndX, this.segmentWidth);
      this._groundEndX = Math.min(levelWidth, this._groundEndX + this.segmentWidth);
    }
  }

  _paintGround(startX, width) {
    if (!this.level) return;
    const levelWidth = this.level.width;
    const levelHeight = this.level.height;
    const x0 = Math.max(0, startX);
    const x1 = Math.min(levelWidth, startX + width);
    const y0 = Math.max(0, levelHeight - this.groundHeight);
    const y1 = levelHeight;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        this.level.setGroundAt(x, y, this.groundColorIndex);
      }
    }
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
