import { Lemmings } from './LemmingsNamespace.js';

function colorStringTo32(str) {
  const m = /rgba?\((\d+),(\d+),(\d+),(\d*(?:\.\d+)?)\)/.exec(str);
  if (!m) return 0xffffffff;
  const r = parseInt(m[1]);
  const g = parseInt(m[2]);
  const b = parseInt(m[3]);
  const a = m[4] === undefined ? 1 : parseFloat(m[4]);
  return ((Math.round(a * 255) & 0xff) << 24) | (b << 16) | (g << 8) | r;
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

    this.cursorCanvas = null;
    this.cursorX = 0;
    this.cursorY = 0;

    this.stageCav = canvasForOutput;
    this.gameImgProps = new Lemmings.StageImageProperties();
    this.guiImgProps  = new Lemmings.StageImageProperties();

    // HUD always starts at scale = 4
    this.guiImgProps.viewPoint = new Lemmings.ViewPoint(0, 0, 4);
    this._rawScale = this.gameImgProps.viewPoint.scale || 1;

    // Initialize DisplayImage instances
    this.getGameDisplay();
    this.getGuiDisplay();

    this.controller = new Lemmings.UserInputManager(canvasForOutput);
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

  calcPosition2D(stageImage, e) {
    const localX = e.x - stageImage.x;
    const localY = e.y - stageImage.y;
    const worldX = stageImage.viewPoint.getSceneX(localX);
    const worldY = stageImage.viewPoint.getSceneY(localY);
    return new Lemmings.Position2D(worldX, worldY);
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
        if (stageImage === this.gameImgProps) {
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
          new Lemmings.Position2D(worldX, worldY)
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
      targetScale += deltaZoom * zoomSensitivity;

      if (!veloUpdate) {
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

  updateStageSize() {
    const stageH = this.stageCav.height;
    const stageW = this.stageCav.width;
    // this margin is for the level <select> elements in the html 
    const margin = 20;

    // HUD always renders at 4× scale
    const hudScale = 4;
    this.guiImgProps.viewPoint.scale = hudScale;

    const rawHUDH = this.guiImgProps.display?.worldDataSize.height || 80;
    const rawHUDW = this.guiImgProps.display?.worldDataSize.width  || 720;

    const hudH = rawHUDH * hudScale;
    const hudW = rawHUDW * hudScale;

    const gameH = stageH - hudH - margin;

    Object.assign(this.gameImgProps, { x: 0, y: 0 });
    this.gameImgProps.canvasViewportSize = { width: stageW, height: gameH };
    Object.assign(this.guiImgProps, {
      x: this.guiImgProps.display ? (stageW - hudW) / 2 : 0,
      y: stageH - hudH - margin
    });
    this.guiImgProps.canvasViewportSize = { width: hudW, height: hudH };

    if (this.gameImgProps.display) {
      const { width: worldW, height: worldH } = this.gameImgProps.display.worldDataSize;

      const scale = this.gameImgProps.viewPoint.scale || 2;
      const viewH_world = gameH / scale;
      const viewW_world = stageW / scale;

      const y = worldH - viewH_world;
      const x = worldW * scale <= stageW ? (worldW - viewW_world) / 2 : 0;

      this.applyViewport(this.gameImgProps, x, y, scale);

      // Redraw at initial position
      this.clear(this.gameImgProps);
      const gameImg = this.gameImgProps.display.getImageData();
      this.draw(this.gameImgProps, gameImg);
    }

    if (this.guiImgProps.display) {
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
    this.gameImgProps.display = new Lemmings.DisplayImage(this);
    return this.gameImgProps.display;
  }

  getGuiDisplay() {
    if (this.guiImgProps.display) return this.guiImgProps.display;
    this.guiImgProps.display = new Lemmings.DisplayImage(this);
    return this.guiImgProps.display;
  }

  setGameViewPointPosition(x, y) {
    this.clear(this.gameImgProps);

    if (lemmings.scale > 0) {
      this._rawScale = lemmings.scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.setX(x);

      const dispH = this.gameImgProps.display.worldDataSize.height;
      const winH  = this.gameImgProps.canvasViewportSize.height;

      const newScale = this.gameImgProps.viewPoint.scale;
      this.gameImgProps.viewPoint.setY(
        dispH - winH / newScale
      );

      this.redraw();
      return;
    }

    let scale = this.gameImgProps.viewPoint.scale;
    if (scale === 2) {
      this._rawScale = scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.setX(x);

      const dispH = this.gameImgProps.display.worldDataSize.height;
      const winH  = this.gameImgProps.canvasViewportSize.height;
      this.gameImgProps.viewPoint.setY(
        dispH - winH / scale
      );

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

    this.redraw();
  }

  redraw() {
    if (this.gameImgProps.display) {
      this.clear(this.gameImgProps);
      const gameImg = this.gameImgProps.display.getImageData();
      this.draw(this.gameImgProps, gameImg);
    }
    if (this.guiImgProps.display) {
      this.clear(this.guiImgProps);
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
        Lemmings.drawMarchingAntRect(
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

    const minY = worldH - viewH;
    const maxY = Math.max(minY, 0);
    stageImage.viewPoint.y = this.limitValue(
      minY,
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

Lemmings.Stage = Stage;
export { Stage };
