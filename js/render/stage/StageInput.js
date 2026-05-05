import {
  COLOR_FN_RE,
  COLOR_RE,
  DAMAGE_FULL_REDRAW_AREA_RATIO,
  DAMAGE_FULL_REDRAW_REGION_THRESHOLD,
  DIRTY_RECT_FULL_BLIT_AREA_RATIO,
  DIRTY_RECT_FULL_BLIT_THRESHOLD,
  DIRTY_UNION_BLIT_RATIO,
  DisplayImage,
  PERF_SAMPLE_WINDOW,
  Position2D,
  StageImageProperties,
  UserInputManager,
  ViewPoint,
  clamp,
  colorStringTo32,
  detectRuntimeCapabilities,
  drawMarchingAntRect,
  getDependency,
  percentile,
  perfNow,
  resolveRenderExperimentState,
  summarizeSamples,
  toAlpha,
  toChannel,
  toFiniteNumber
} from './StageShared.js';
const stageInputMethods = {
  setCursorSprite(frame) {
    if (!frame) {
      this.cursorCanvas = null;
      // Force redraw even if cursor position is unchanged.
      this._cursorStateVersion += 1;
      return;
    }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      this.cursorCanvas = null;
      this._cursorStateVersion += 1;
      return;
    }
    const c = document.createElement('canvas');
    c.width = frame.width;
    c.height = frame.height;
    const ictx = c.getContext('2d', { alpha: true, willReadFrequently: true});
    if (!ictx) {
      this.cursorCanvas = null;
      this._cursorStateVersion += 1;
      return;
    }
    ictx.putImageData(
      new ImageData(frame.getData(), frame.width, frame.height),
      0,
      0
    );
    this.cursorCanvas = c;
    // Sprite updates must invalidate the cursor plane for the next redraw.
    this._cursorStateVersion += 1;
  },

  setGuiEnabled(enabled) {
    this.guiEnabled = !!enabled;
    if (!this.guiEnabled) {
      this.guiImgProps.display = null;
      this.guiOverlayImgProps.display = null;
      this._guiOverlayVisible = false;
      this._lastGuiOverlayDrawSignature = '';
    }
    this.updateStageSize();
  },

  calcPosition2D(stageImage, e) {
    const localX = e.x - stageImage.x;
    const localY = e.y - stageImage.y;
    const worldX = stageImage.viewPoint.getSceneX(localX);
    const worldY = stageImage.viewPoint.getSceneY(localY);
    return new Position2D(worldX, worldY);
  },

  handleOnDoubleClick() {
    this.controller.onDoubleClick.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onDoubleClick.trigger(pos);
    });
  },

  handleOnMouseDown() {
    this.controller.onMouseDown.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseDown.trigger(pos);
    });
  },

  handleOnMouseUp() {
    this.controller.onMouseUp.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseUp.trigger(pos);
    });
  },

  handleOnMouseRightDown() {
    this.controller.onMouseRightDown.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseRightDown.trigger(pos);
    });
  },

  handleOnMouseRightUp() {
    this.controller.onMouseRightUp.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseRightUp.trigger(pos);
    });
  },

  handleOnMouseMove() {
    this.controller.onMouseMove.on((e) => {
      this.cursorX = e.x;
      this.cursorY = e.y;
  
      if (e.button) {
        const stageImage = this.getStageImageAt(e.mouseDownX, e.mouseDownY);
        if (!stageImage || !stageImage.display) return;
        if (this.panEnabled && stageImage === this.gameImgProps) {
          this.updateViewPoint(stageImage, e.deltaX, e.deltaY, 0);
        }
        const pos = this.calcPosition2D(stageImage, e);
        stageImage.display.onMouseMove.trigger(pos);
      } else {
        const stageImage = this.getStageImageAt(e.x, e.y);
        if (!stageImage || !stageImage.display) return;
        const localX = e.x - stageImage.x;
        const localY = e.y - stageImage.y;
        const worldX = stageImage.viewPoint.getSceneX(localX);
        const worldY = stageImage.viewPoint.getSceneY(localY);
        stageImage.display.onMouseMove.trigger(
          new Position2D(worldX, worldY)
        );
  
      }
    });
  },

  handleOnZoom() {
    this.controller.onZoom.on((e) => {
      const stageImage = this.gameImgProps;
      if (!stageImage || !stageImage.display) return;
  
      // Always zoom around the cursor position e.x,e.y
      this.updateViewPoint(stageImage, e.x, e.y, e.deltaZoom, e.velocity);
    });
  },

  updateViewPoint(stageImage, argX, argY, deltaZoom, veloUpdate = false) {
    if (!stageImage || !stageImage.display) return;
  
    let targetScale = stageImage.viewPoint.scale || 1;
    let targetX = stageImage.viewPoint.x;
    let targetY = stageImage.viewPoint.y;
  
    if (deltaZoom !== 0) {
      const screenX_rel = argX - stageImage.x;
      const screenY_rel = argY - stageImage.y;
  
      const sceneX_pre = stageImage.viewPoint.getSceneX(screenX_rel);
      const sceneY_pre = stageImage.viewPoint.getSceneY(screenY_rel);
  
      const zoomSensitivity = 0.001125;
      const desiredScale = targetScale + deltaZoom * zoomSensitivity;
      const snappedScale = this.snapScale(desiredScale);
      targetScale = snappedScale;
  
      if (!veloUpdate && snappedScale !== stageImage.viewPoint.scale) {
        targetX = sceneX_pre - screenX_rel / targetScale;
        targetY = sceneY_pre - screenY_rel / targetScale;
      }
    } else {
      targetX += argX / targetScale;
      targetY += argY / targetScale;
    }
    const imgData = stageImage.display.getImageData();
    const shouldRedrawGui = !!(
      this.guiEnabled &&
        stageImage === this.guiImgProps &&
        this.guiImgProps.display?.getImageData
    );
    const guiImgData = shouldRedrawGui ? this.guiImgProps.display.getImageData() : null;
    this.applyViewport(stageImage, targetX, targetY, targetScale);
    this.clear(stageImage);
    if (shouldRedrawGui) {
      this.clear(this.guiImgProps);
    }
    this.draw(stageImage, imgData);
    if (shouldRedrawGui) {
      this.draw(this.guiImgProps, guiImgData);
    }
  },

  snapScale(rawScale) {
    const { width: dispW, height: dispH } = this.gameImgProps.display.worldDataSize;
    if (dispW === 0 || dispH === 0) return rawScale;
  
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(dispW, dispH);
    const step = 1 / g;
  
    const minScale = 0.25;
    const maxScale = 8;
    let clamped = rawScale;
    if (clamped < minScale) clamped = minScale;
    if (clamped > maxScale) clamped = maxScale;
  
    return Math.round(clamped / step) * step;
  },

  applyViewport(stageImage, targetX, targetY, targetScale) {
    if (!stageImage || !stageImage.display) return;
  
    this._rawScale = targetScale;
    stageImage.viewPoint.scale = this.snapScale(targetScale);
    stageImage.viewPoint.setX(targetX);
    stageImage.viewPoint.setY(targetY);
  
    this.clampViewPoint(stageImage);
  },

  scheduleUpdateStageSize() {
    if (this._resizeRaf) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      this.updateStageSize();
      return;
    }
    this._resizeRaf = window.requestAnimationFrame(() => {
      this._resizeRaf = 0;
      this.updateStageSize(true);
    });
  },

  updateStageSize(fromResize = false) {
    const stageH = this.stageCav.height;
    const stageW = this.stageCav.width;
    if (fromResize && stageW === this._lastStageWidth && stageH === this._lastStageHeight) {
      const gameDirty = this.gameImgProps.display?.hasPendingDirty?.() === true;
      const guiDirty = this.guiEnabled && this.guiImgProps.display?.hasPendingDirty?.() === true;
      if (!gameDirty && !guiDirty) return;
    }
    this._lastStageWidth = stageW;
    this._lastStageHeight = stageH;
    const guiActive = this.guiEnabled && !!this.guiImgProps.display;
    // this margin is for the level <select> elements in the html
    const margin = guiActive ? this.hudMargin : 0;
  
    // HUD scale adapts to available space
    const rawHUDH = guiActive ? (this.guiImgProps.display?.worldDataSize.height || 80) : 0;
    const rawHUDW = guiActive ? (this.guiImgProps.display?.worldDataSize.width || 720) : 0;
  
    const maxScaleW = guiActive && rawHUDW ? stageW / rawHUDW : 1;
    const maxScaleH = guiActive && rawHUDH ? (stageH - margin) / rawHUDH : 1;
    let hudScale = guiActive ? Math.min(4, maxScaleW, maxScaleH) : 1;
    if (!isFinite(hudScale) || hudScale <= 0) hudScale = 1;
    this.guiImgProps.viewPoint.scale = hudScale;
  
    const hudH = guiActive ? rawHUDH * hudScale : 0;
    const hudW = guiActive ? rawHUDW * hudScale : 0;
  
    const gameH = Math.max(0, stageH - hudH - margin);
  
    Object.assign(this.gameImgProps, { x: 0, y: 0 });
    this.gameImgProps.canvasViewportSize = { width: stageW, height: gameH };
    Object.assign(this.guiImgProps, {
      x: guiActive ? (stageW - hudW) / 2 : 0,
      y: guiActive ? (stageH - hudH - margin) : 0
    });
    this.guiImgProps.canvasViewportSize = { width: hudW, height: hudH };
    this._syncOverlayLayout();
  
    if (this.gameImgProps.display) {
      const { width: worldW, height: worldH } = this.gameImgProps.display.worldDataSize;
  
      const scale = this.gameImgProps.viewPoint.scale || 2;
      const viewH_world = gameH / scale;
      const viewW_world = stageW / scale;
  
      let x = this.gameImgProps.viewPoint.x;
      let y = this.gameImgProps.viewPoint.y;
      if (!isFinite(x)) x = 0;
      if (!isFinite(y)) y = 0;
  
      if (worldW * scale <= stageW) {
        x = (worldW - viewW_world) / 2;
      }
  
      this.applyViewport(this.gameImgProps, x, y, scale);
  
      // Redraw at initial position
      this.clear(this.gameImgProps);
      const gameImg = this.gameImgProps.display.getImageData();
      this.draw(this.gameImgProps, gameImg);
    }
  
    if (guiActive && this.guiImgProps.display) {
      const guiImg = this.guiImgProps.display.getImageData();
      this.draw(this.guiImgProps, guiImg);
    }
  
    this._syncOverlayDisplaySize(this.gameImgProps, this.gameOverlayImgProps);
    this._syncOverlayDisplaySize(this.guiImgProps, this.guiOverlayImgProps);
  },

  getStageImageAt(x, y) {
    const { width: gameW, height: gameH } =
        this.gameImgProps.canvasViewportSize;
    if (
      x >= this.gameImgProps.x &&
        x <  this.gameImgProps.x + gameW &&
        y >= this.gameImgProps.y &&
        y <  this.gameImgProps.y + gameH
    ) {
      return this.gameImgProps;
    }
    const { width: guiW, height: guiH } =
        this.guiImgProps.canvasViewportSize;
    if (
      x >= this.guiImgProps.x &&
        x <  this.guiImgProps.x + guiW &&
        y >= this.guiImgProps.y &&
        y <  this.guiImgProps.y + guiH
    ) {
      return this.guiImgProps;
    }
    return null;
  },

  getGameDisplay() {
    if (this.gameImgProps.display) return this.gameImgProps.display;
    this.gameImgProps.display = new DisplayImage(this);
    return this.gameImgProps.display;
  },

  getGuiDisplay() {
    if (this.guiImgProps.display) return this.guiImgProps.display;
    this.guiImgProps.display = new DisplayImage(this);
    return this.guiImgProps.display;
  },

  getGameOverlayDisplay() {
    if (this.gameOverlayImgProps.display) return this.gameOverlayImgProps.display;
    this.gameOverlayImgProps.display = new DisplayImage(this);
    this._syncOverlayDisplaySize(this.gameImgProps, this.gameOverlayImgProps);
    this.gameOverlayImgProps.display.clear(0x00000000);
    return this.gameOverlayImgProps.display;
  },

  getGuiOverlayDisplay() {
    if (this.guiOverlayImgProps.display) return this.guiOverlayImgProps.display;
    this.guiOverlayImgProps.display = new DisplayImage(this);
    this._syncOverlayDisplaySize(this.guiImgProps, this.guiOverlayImgProps);
    this.guiOverlayImgProps.display.clear(0x00000000);
    return this.guiOverlayImgProps.display;
  },

  setGameOverlayVisible(visible) {
    const nextVisible = !!visible;
    if (this._gameOverlayVisible === nextVisible) return;
    this._gameOverlayVisible = nextVisible;
    this._overlayVisibilityVersion += 1;
  },

  setGuiOverlayVisible(visible) {
    const nextVisible = !!visible;
    if (this._guiOverlayVisible === nextVisible) return;
    this._guiOverlayVisible = nextVisible;
    this._overlayVisibilityVersion += 1;
  },

  setGameViewPointPosition(x, y, options = {}) {
    const targetX = isFinite(x) ? x : 0;
    const targetY = isFinite(y) ? y : 0;
    const preserveScale = options.preserveScale === true;
    if (preserveScale) {
      const rawScale = Number.isFinite(this._rawScale)
        ? this._rawScale
        : (this.gameImgProps.viewPoint.scale || 1);
      this._rawScale = rawScale;
      this.applyViewport(this.gameImgProps, targetX, targetY, rawScale);
      this.redraw(true);
      return;
    }
  
    const requestedScale = this._getRequestedScale();
    if (requestedScale > 0) {
      this._rawScale = requestedScale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.setX(targetX);
      this.gameImgProps.viewPoint.setY(targetY);
      this.clampViewPoint(this.gameImgProps);
  
      this.redraw(true);
      return;
    }
  
    let scale = this.gameImgProps.viewPoint.scale;
    if (scale === 2) {
      this._rawScale = scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.setX(targetX);
      this.gameImgProps.viewPoint.setY(targetY);
      this.clampViewPoint(this.gameImgProps);
  
      this.redraw(true);
      return;
    }
  
    const sceneX = this.gameImgProps.viewPoint.getSceneX(targetX - this.gameImgProps.x);
    const sceneY = this.gameImgProps.viewPoint.getSceneY(targetY - this.gameImgProps.y);
    this._rawScale = 2;
    this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
    this.gameImgProps.viewPoint.setX(
      sceneX - (targetX - this.gameImgProps.x) / this.gameImgProps.viewPoint.scale
    );
    this.gameImgProps.viewPoint.setY(
      sceneY - (targetY - this.gameImgProps.y) / this.gameImgProps.viewPoint.scale
    );
    this.clampViewPoint(this.gameImgProps);
  
    this.redraw(true);
  }
};
export { stageInputMethods };