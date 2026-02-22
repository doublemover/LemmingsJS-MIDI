import { DisplayImage, drawMarchingAntRect } from './DisplayImage.js';
import { Position2D } from '../util/Position2D.js';
import { StageImageProperties } from './StageImageProperties.js';
import { UserInputManager } from '../input/UserInputManager.js';
import { ViewPoint } from './ViewPoint.js';
import { getDependency } from '../core/dependencies.js';

const COLOR_FN_RE = /^rgba?\(/i;
const COLOR_RE = /^rgba?\(\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*(?:,\s*([-+]?\d*\.?\d+)\s*)?\)$/i;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toChannel(value) {
  if (!Number.isFinite(value)) return 255;
  return clamp(Math.round(value), 0, 255);
}

function toAlpha(value) {
  if (!Number.isFinite(value)) return 1;
  return clamp(value, 0, 1);
}

function colorStringTo32(str) {
  if (typeof str !== 'string') return 0xffffffff;
  if (!COLOR_FN_RE.test(str)) return 0xffffffff;
  const m = COLOR_RE.exec(str.trim());
  if (!m) return 0xffffffff;
  const r = toChannel(Number(m[1]));
  const g = toChannel(Number(m[2]));
  const b = toChannel(Number(m[3]));
  const a = toAlpha(m[4] === undefined ? 1 : Number(m[4]));
  return ((Math.round(a * 255) & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

class Stage {
  constructor(canvasForOutput) {
    this.controller = null;
    this.fadeTimer = 0;
    this.fadeAlpha = 0;
    this.overlayColor = 'black';
    this.overlayAlpha = 0;
    this.overlayRect = null;
    this.overlayTimer = 0;
    this.overlayDashLen = 0;
    this.overlayDashColor = 0;
    this.overlayDashOffset = 0;
    this.panEnabled = true;
    this._resizeRaf = 0;

    this.cursorCanvas = null;
    this.cursorX = 0;
    this.cursorY = 0;
    this.guiEnabled = true;
    this.hudMargin = 20;

    this.stageCav = canvasForOutput;
    this.gameImgProps = new StageImageProperties();
    this.guiImgProps  = new StageImageProperties();

    // HUD always starts at scale = 4
    this.guiImgProps.viewPoint = new ViewPoint(0, 0, 4);
    this._rawScale = this.gameImgProps.viewPoint.scale || 1;

    // Initialize DisplayImage instances
    this.getGameDisplay();
    this.getGuiDisplay();

    this.controller = new UserInputManager(canvasForOutput);
    this.handleOnMouseUp();
    this.handleOnMouseDown();
    this.handleOnMouseRightUp();
    this.handleOnMouseRightDown();
    this.handleOnMouseMove();
    this.handleOnDoubleClick();
    this.handleOnZoom();

    this.updateStageSize();
    this.clear();
  }

  setCursorSprite(frame) {
    if (!frame) {
      this.cursorCanvas = null;
      return;
    }
    const c = document.createElement('canvas');
    c.width = frame.width;
    c.height = frame.height;
    const ictx = c.getContext('2d', { alpha: true, willReadFrequently: true});
    ictx.putImageData(
      new ImageData(frame.getData(), frame.width, frame.height),
      0,
      0
    );
    this.cursorCanvas = c;
  }

  setGuiEnabled(enabled) {
    this.guiEnabled = !!enabled;
    if (!this.guiEnabled) {
      this.guiImgProps.display = null;
    }
    this.updateStageSize();
  }

  calcPosition2D(stageImage, e) {
    const localX = e.x - stageImage.x;
    const localY = e.y - stageImage.y;
    const worldX = stageImage.viewPoint.getSceneX(localX);
    const worldY = stageImage.viewPoint.getSceneY(localY);
    return new Position2D(worldX, worldY);
  }

  handleOnDoubleClick() {
    this.controller.onDoubleClick.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onDoubleClick.trigger(pos);
    });
  }

  handleOnMouseDown() {
    this.controller.onMouseDown.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseDown.trigger(pos);
    });
  }

  handleOnMouseUp() {
    this.controller.onMouseUp.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseUp.trigger(pos);
    });
  }

  handleOnMouseRightDown() {
    this.controller.onMouseRightDown.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseRightDown.trigger(pos);
    });
  }

  handleOnMouseRightUp() {
    this.controller.onMouseRightUp.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseRightUp.trigger(pos);
    });
  }

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
  }

  handleOnZoom() {
    this.controller.onZoom.on((e) => {
      const stageImage = this.gameImgProps;
      if (!stageImage || !stageImage.display) return;

      // Always zoom around the cursor position e.x,e.y
      this.updateViewPoint(stageImage, e.x, e.y, e.deltaZoom, e.velocity);
    });
  }

  /**
   * updateViewPoint(stageImage, argX, argY, deltaZoom)
   *
   * Pan/zoom logic:
   * • If deltaZoom !== 0: treat argX,argY as cursor pixel coordinates.
   *   1) Compute relX = screenX − stageImage.x
   *   2) Compute relY = screenY − stageImage.y
   *   3) sceneX_pre = viewPoint.getSceneX(relX)
   *      sceneY_pre = viewPoint.getSceneY(relY)
   *   4) newScale = oldScale + deltaZoom × zoomSensitivity
   *   5) Clamp then snap newScale
   *   6) viewPoint.scale = newScale
   *   7) viewPoint.x = sceneX_pre − (relX / newScale)
   *      viewPoint.y = sceneY_pre − (relY / newScale)
   * • Else: treat argX,argY as drag distances (deltaX,deltaY) in screen pixels
   *   1) worldDX = deltaX / scale
   *      worldDY = deltaY / scale
   *   2) viewPoint.x −= worldDX
   *      viewPoint.y −= worldDY
   */
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
    const guiImgData = this.guiImgProps.display.getImageData();
    this.applyViewport(stageImage, targetX, targetY, targetScale);
    this.clear(stageImage);
    this.clear(this.guiImgProps);
    this.draw(stageImage, imgData);
    this.draw(this.guiImgProps, guiImgData);
  }

  /**
   * Snap a raw scale so that (displayWidth × scale) and (displayHeight × scale)
   * are both integers (no sub‐pixel artifact). Based on DisplayImage’s dimensions.
   */
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
  }

  applyViewport(stageImage, targetX, targetY, targetScale) {
    if (!stageImage || !stageImage.display) return;

    this._rawScale = targetScale;
    stageImage.viewPoint.scale = this.snapScale(targetScale);
    stageImage.viewPoint.setX(targetX);
    stageImage.viewPoint.setY(targetY);

    this.clampViewPoint(stageImage);
  }

  scheduleUpdateStageSize() {
    if (this._resizeRaf) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      this.updateStageSize();
      return;
    }
    this._resizeRaf = window.requestAnimationFrame(() => {
      this._resizeRaf = 0;
      this.updateStageSize();
    });
  }

  updateStageSize() {
    const stageH = this.stageCav.height;
    const stageW = this.stageCav.width;
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
  }
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
  }

  getGameDisplay() {
    if (this.gameImgProps.display) return this.gameImgProps.display;
    this.gameImgProps.display = new DisplayImage(this);
    return this.gameImgProps.display;
  }

  getGuiDisplay() {
    if (this.guiImgProps.display) return this.guiImgProps.display;
    this.guiImgProps.display = new DisplayImage(this);
    return this.guiImgProps.display;
  }

  setGameViewPointPosition(x, y, options = {}) {
    this.clear(this.gameImgProps);
    const targetY = isFinite(y) ? y : 0;
    const preserveScale = options.preserveScale === true;
    if (preserveScale) {
      const rawScale = Number.isFinite(this._rawScale)
        ? this._rawScale
        : (this.gameImgProps.viewPoint.scale || 1);
      this._rawScale = rawScale;
      this.applyViewport(this.gameImgProps, x, targetY, rawScale);
      this.redraw();
      return;
    }

    const app = globalThis?.lemmings;
    if (app?.scale > 0) {
      this._rawScale = app.scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.setX(x);
      this.gameImgProps.viewPoint.setY(targetY);
      this.clampViewPoint(this.gameImgProps);

      this.redraw();
      return;
    }

    let scale = this.gameImgProps.viewPoint.scale;
    if (scale === 2) {
      this._rawScale = scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.setX(x);
      this.gameImgProps.viewPoint.setY(targetY);
      this.clampViewPoint(this.gameImgProps);

      this.redraw();
      return;
    }

    const sceneX = this.gameImgProps.viewPoint.getSceneX(x - this.gameImgProps.x);
    const sceneY = this.gameImgProps.viewPoint.getSceneY(y - this.gameImgProps.y);
    this._rawScale = 2;
    this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
    this.gameImgProps.viewPoint.setX(
      sceneX - (x - this.gameImgProps.x) / this.gameImgProps.viewPoint.scale
    );
    this.gameImgProps.viewPoint.setY(
      sceneY - (y - this.gameImgProps.y) / this.gameImgProps.viewPoint.scale
    );
    this.clampViewPoint(this.gameImgProps);

    this.redraw();
  }

  redraw() {
    this.clear();
    if (this.gameImgProps.display) {
      const gameImg = this.gameImgProps.display.getImageData();
      this.draw(this.gameImgProps, gameImg);
    }
    if (this.guiImgProps.display) {
      const guiImg = this.guiImgProps.display.getImageData();
      this.draw(this.guiImgProps, guiImg);
    }
    this.drawCursor();
  }

  createImage(displayOwner, width, height) {
    return displayOwner === this.gameImgProps.display
      ? this.gameImgProps.createImage(width, height)
      : this.guiImgProps.createImage(width, height);
  }

  clear(stageImage) {
    const ctx = this.stageCav.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000900';
    if (!stageImage) {
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      ctx.fillRect(stageImage.x, stageImage.y, stageImage.width, stageImage.height);
    }
  }

  resetFade() {
    this.fadeAlpha = 0;
    this.overlayAlpha = 0;
    this.overlayRect = null;
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    if (this.overlayTimer) clearInterval(this.overlayTimer);
    this.fadeTimer = this.overlayTimer = 0;
  }

  startFadeOut() {
    this.resetFade();
    this.fadeTimer = setInterval(() => {
      this.fadeAlpha = Math.min(this.fadeAlpha + 0.02, 1);
      if (this.fadeAlpha >= 1) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = 0;
      }
    }, 40);
  }

  startOverlayFade(color, rect = null, dashLen = 0) {
    if (this.overlayTimer) clearInterval(this.overlayTimer);
    this.overlayColor = color;
    this.overlayRect = rect;
    this.overlayDashLen = dashLen;
    this.overlayDashColor = colorStringTo32(color);
    this.overlayDashOffset = 0;
    this.overlayAlpha = 1;
    this.overlayTimer = setInterval(() => {
      this.overlayAlpha = Math.max(this.overlayAlpha - 0.02, 0);
      this.overlayDashOffset = (this.overlayDashOffset + 1) % ((this.overlayDashLen || 1) * 2);
      if (this.overlayAlpha <= 0) {
        clearInterval(this.overlayTimer);
        this.overlayTimer = 0;
        this.overlayRect = null;
        this.overlayDashLen = 0;
      }
    }, 40);
  }

  resetOverlayFade() {
    this.overlayAlpha = 0;
    this.overlayRect = null;
    this.overlayDashLen = 0;
    if (this.overlayTimer) clearInterval(this.overlayTimer);
    this.overlayTimer = 0;
  }

  dispose() {
    this.resetFade();
    if (this._resizeRaf) {
      window.cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = 0;
    }
    if (this.gameImgProps.display?.dispose) this.gameImgProps.display.dispose();
    if (this.guiImgProps.display?.dispose)  this.guiImgProps.display.dispose();
    if (this.controller?.dispose)            this.controller.dispose();
    this.controller = null;
    this.gameImgProps = null;
    this.guiImgProps  = null;
    this.stageCav     = null;
  }

  draw(display, img) {
    if (!display.ctx) return;

    display.ctx.putImageData(img, 0, 0);

    const ctx = this.stageCav.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;

    let sx = display.viewPoint.x;
    let sy = display.viewPoint.y;
    let sw = img.width - sx;
    let sh = img.height - sy;
    if (sx < 0) {
      sw += sx;
      sx = 0;
    }
    if (sy < 0) {
      sh += sy;
      sy = 0;
    }
    sw = Math.min(sw, img.width - sx);
    sh = Math.min(sh, img.height - sy);

    const dx = display.x + Math.max(-display.viewPoint.x, 0) * display.viewPoint.scale;
    const dy = display.y + Math.max(-display.viewPoint.y, 0) * display.viewPoint.scale;
    let dw = sw * display.viewPoint.scale;
    let dh = sh * display.viewPoint.scale;

    if (dw > display.width) {
      sw = display.width / display.viewPoint.scale;
      dw = display.width;
    }
    if (dh > display.height) {
      sh = display.height / display.viewPoint.scale;
      dh = display.height;
    }

    ctx.drawImage(
      display.cav,
      sx,
      sy,
      sw,
      sh,
      dx,
      dy,
      Math.trunc(dw),
      Math.trunc(dh)
    );

    if (this.fadeAlpha !== 0) {
      ctx.globalAlpha = this.fadeAlpha;
      ctx.fillStyle = 'black';
      ctx.fillRect(display.x, display.y, Math.trunc(dw), Math.trunc(dh));
      ctx.globalAlpha = 1;
    }

    if (this.overlayAlpha > 0) {
      ctx.globalAlpha = this.overlayAlpha;
      ctx.fillStyle = this.overlayColor;
      const r = this.overlayRect || {
        x: display.x,
        y: display.y,
        width: Math.trunc(dw),
        height: Math.trunc(dh),
      };
      ctx.fillRect(r.x, r.y, r.width, r.height);
      ctx.globalAlpha = 1;
      if (this.overlayDashLen > 0) {
        const octx = this.stageCav.getContext('2d', { alpha: true, willReadFrequently: true});
        const img = octx.getImageData(r.x, r.y, r.width + 1, r.height + 1);
        const disp = { buffer32: new Uint32Array(img.data.buffer), imgData: img };
        const drawAnts = getDependency('drawMarchingAntRect', drawMarchingAntRect);
        drawAnts(
          disp,
          0,
          0,
          r.width,
          r.height,
          this.overlayDashLen,
          this.overlayDashOffset,
          this.overlayDashColor,
          0x00000000
        );
        octx.putImageData(img, r.x, r.y);
      }
    }
  }

  drawCursor() {
    if (!this.cursorCanvas) return;
    const ctx = this.stageCav.getContext('2d', { alpha: true, willReadFrequently: true});
    const cx = Math.trunc(this.cursorX - this.cursorCanvas.width / 2);
    const cy = Math.trunc(this.cursorY - this.cursorCanvas.height / 2);
    ctx.drawImage(this.cursorCanvas, cx, cy);
  }

  clampViewPoint(stageImage) {
    if (!stageImage || !stageImage.display) return;
    const { width: worldW, height: worldH } = stageImage.display.worldDataSize;
    const scale = stageImage.viewPoint.scale;
    const { width: vpW, height: vpH } = stageImage.canvasViewportSize;
    const viewW = vpW / scale;
    const viewH = vpH / scale;

    const maxY = Math.max(worldH - viewH, 0);
    stageImage.viewPoint.y = this.limitValue(
      0,
      stageImage.viewPoint.y,
      maxY
    );

    if (worldW <= viewW) {
      stageImage.viewPoint.x = (worldW - viewW) / 2;
    } else {
      stageImage.viewPoint.x = this.limitValue(
        0,
        stageImage.viewPoint.x,
        worldW - viewW
      );
    }
  }

  getGameViewRect() {
    return {
      x: this.gameImgProps.viewPoint.x,
      y: this.gameImgProps.viewPoint.y,
      w: this.gameImgProps.canvasViewportSize.width  / this.gameImgProps.viewPoint.scale,
      h: this.gameImgProps.canvasViewportSize.height / this.gameImgProps.viewPoint.scale

    };
  }

  limitValue(minLimit, value, maxLimit) {
    return Math.min(Math.max(minLimit, value), maxLimit);
  }
}

export { Stage };
