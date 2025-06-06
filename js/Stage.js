import { Lemmings } from './LemmingsNamespace.js';

class Stage {
  constructor(canvasForOutput) {
    this.controller = null;
    this.fadeTimer = 0;
    this.fadeAlpha = 0;
    this.overlayColor = 'black';
    this.overlayAlpha = 0;
    this.overlayRect = null;
    this.overlayTimer = 0;

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
    const ictx = c.getContext('2d');
    ictx.putImageData(
      new ImageData(frame.getData(), frame.width, frame.height),
      0,
      0
    );
    this.cursorCanvas = c;
  }

  calcPosition2D(stageImage, e) {
    // Allow calls as calcPosition2D(event) by auto-selecting the stage image
    if (e === undefined && stageImage && stageImage.x !== undefined) {
      e = stageImage;
      stageImage = this.getStageImageAt(e.x, e.y);
    }

    if (!stageImage || !e) return new Lemmings.Position2D(0, 0);

    const localX = e.x - stageImage.x;
    const localY = e.y - stageImage.y;
    const vp = stageImage.viewPoint;
    // Use the same scale for both axes so coordinates map correctly
    const sceneX = vp.getSceneX(localX);
    const sceneY = vp.getSceneY(localY);

    return new Lemmings.Position2D(sceneX, sceneY);
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
        stageImage.display.onMouseMove.trigger(new Lemmings.Position2D(worldX, worldY));
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

    // ZOOM
    if (deltaZoom !== 0) {
      const oldScale = stageImage.viewPoint.scale || 1;

      // Screen‐pixel offset inside game region
      const screenX_rel = argX - stageImage.x;
      const screenY_rel = argY - stageImage.y;

      // World coordinates under cursor before zoom
      const sceneX_pre = stageImage.viewPoint.getSceneX(screenX_rel);
      const sceneY_pre = stageImage.viewPoint.getSceneY(screenY_rel);

      // Compute new scale additively
      const zoomSensitivity = 0.0001; // smaller → slower zoom
      let newScale = oldScale + deltaZoom * zoomSensitivity;

      // Clamp to [0.25, 8]
      const minScale = 0.25;
      const maxScale = 8;
      if (newScale < minScale) newScale = minScale;
      if (newScale > maxScale) newScale = maxScale;

      // Snap so that (worldWidth × scale) and (worldHeight × scale) yield integers
      newScale = this.snapScale(newScale);
      stageImage.viewPoint.scale = newScale;

      //Recenter so (sceneX_pre,sceneY_pre) stays under cursor
      if (!veloUpdate) {
        stageImage.viewPoint.x = sceneX_pre - screenX_rel / newScale;
        stageImage.viewPoint.y = sceneY_pre - screenY_rel / newScale;
      }
      this.clear(stageImage);
      const imgData = stageImage.display.getImageData();
      this.draw(stageImage, imgData);

      this.clear(this.guiImgProps);
      const guiImgData = this.guiImgProps.display.getImageData();
      this.draw(this.guiImgProps, guiImgData);
    }
    // PAN
    // argX,argY are deltaX,deltaY (screen pixels)
    const scale = stageImage.viewPoint.scale;
    const worldDX = argX / scale;
    const worldDY = argY / scale;
    if (!veloUpdate) {
      stageImage.viewPoint.x += worldDX;
      stageImage.viewPoint.y += worldDY;
    }

    // Now clamp or recenter viewPoint:
    // Clamp Y so the camera never leaves the level vertically
    const gameH = stageImage.display.getHeight();
    const gameW = stageImage.display.getWidth();
    const winH = stageImage.height;
    const scale = stageImage.viewPoint.scale;
    // worldHeight = how many “world pixels” tall
    const worldH = gameH;
    // viewH_world = viewport height in world units
    const viewH_world = winH / scale;
    // Clamp Y within [0, worldH - viewH_world]
    stageImage.viewPoint.y = this.limitValue(
      0,
      stageImage.viewPoint.y,
      worldH - viewH_world
    );

    // — X: if scale ≥ 2, simply clamp so nothing goes offscreen
    const gameW = stageImage.display.getWidth();
    const winW = stageImage.width;
    const worldW = gameW;
    const viewW_world = winW / scale;
    // To glue bottom: viewPoint.y = worldH - viewH_world

    if (scale >= 2) {
      // Clamp between [0 .. (worldW - viewW_world)]
      stageImage.viewPoint.x = this.limitValue(
        0,
        stageImage.viewPoint.x,
        worldW - viewW_world
      );
    } else {
      // Center the level when zoomed out
      if (worldW * scale < winW) {
        const wDiff = winW - worldW * scale;
        stageImage.viewPoint.x = -wDiff / (2 * scale);
      } else {
        // Still clamp if the level exceeds the viewport
        stageImage.viewPoint.x = this.limitValue(
          0,
          stageImage.viewPoint.x,
          worldW - viewW_world
        );
      }
    }

    this.clear(stageImage);
    const imgData = stageImage.display.getImageData();
    this.draw(stageImage, imgData);

    this.clear(this.guiImgProps);
    const guiImgData = this.guiImgProps.display.getImageData();
    this.draw(this.guiImgProps, guiImgData);
  }

  /**
   * Snap a raw scale so that (displayWidth × scale) and (displayHeight × scale)
   * are both integers (no sub‐pixel artifact). Based on DisplayImage’s dimensions.
   */
  snapScale(rawScale) {
    const dispW = this.gameImgProps.display.getWidth();
    const dispH = this.gameImgProps.display.getHeight();
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

  updateStageSize() {
    const stageH = this.stageCav.height;
    const stageW = this.stageCav.width;
    const scaleHUD = this.guiImgProps.viewPoint.scale; // always = 2 by default
    const rawHUDH = this.guiImgProps.display?.getHeight() || 80;
    const rawHUDW = this.guiImgProps.display?.getWidth() || 720;

    const panelH = Math.trunc(rawHUDH * scaleHUD);
    const panelW = Math.trunc(rawHUDW * scaleHUD);
    const gameH = stageH - panelH; // everything above the HUD

    // 1) The game area fills x=0..stageW, y=0..gameH
    this.gameImgProps.x = 0;
    this.gameImgProps.y = 0;
    this.gameImgProps.width = stageW;
    this.gameImgProps.height = gameH;

    // 2) The HUD sits at bottom, height=panelH, width=panelW, centered horizontally
    this.guiImgProps.y = gameH; // so the top of HUD = bottom of game area
    this.guiImgProps.height = panelH;
    this.guiImgProps.width = panelW;
    if (this.guiImgProps.display) {
      this.guiImgProps.x = (stageW - panelW) / 2;
    }

    if (this.gameImgProps.display) {
      const worldH = this.gameImgProps.display.getHeight();
      const worldW = this.gameImgProps.display.getWidth();


      const startingScale = this.gameImgProps.viewPoint.scale || 2;
      this._rawScale = startingScale;
      this.gameImgProps.viewPoint.scale = this.snapScale(startingScale);

      // Compute world vs. viewport in world units
      const worldH = displayHeight;
      const worldW = displayWidth;
      const viewH_world = this.gameImgProps.height / scale;
      const viewW_world = stageW / scale;


      if (worldH === 0 || worldW === 0) {
        // If the display is not yet sized, default to the origin
        this.gameImgProps.viewPoint.x = 0;
        this.gameImgProps.viewPoint.y = 0;
      } else {
      this.gameImgProps.viewPoint.y = worldH - viewH_world;

      if (worldW * this.gameImgProps.viewPoint.scale <= stagePixW) {
        this.gameImgProps.viewPoint.x = (worldW - viewW_world) / 2;
      } else {
        this.gameImgProps.viewPoint.x = 0;
        this.gameImgProps.viewPoint.y = 0;
      } else {
        // Force scale to whatever it was (or default = 2 if unset)
        const scale = this.gameImgProps.viewPoint.scale || 2;
        this._rawScale = scale;
        this.gameImgProps.viewPoint.scale = this.snapScale(scale);

        // Compute world vs. viewport in world units
        const worldH = displayHeight;
        const worldW = displayWidth;
        const viewH_world = gameH / scale;
        const viewW_world = stageW / scale;

        // Glue Y: bottom of level flush against HUD top
        this.gameImgProps.viewPoint.y = worldH - viewH_world;

        // For X: if level is already narrower than viewport at this scale,
        // center it; otherwise, clamp to left edge.
        if (worldW * scale <= stageW) {
          // center
          this.gameImgProps.viewPoint.x = (worldW - viewW_world) / 2;
        } else {
          // left‐align
          this.gameImgProps.viewPoint.x = 0;
        }
      }

      this.clear(this.gameImgProps);
      const gameImg = this.gameImgProps.display.getImageData();
      this.draw(this.gameImgProps, gameImg);
    }

    if (this.guiImgProps.display) {
      this.clear(this.guiImgProps);
      const guiImg = this.guiImgProps.display.getImageData();
      this.draw(this.guiImgProps, guiImg);
    }
  }

  getStageImageAt(x, y) {
    if (
      x >= this.gameImgProps.x &&
      x <  this.gameImgProps.x + this.gameImgProps.width &&
      y >= this.gameImgProps.y &&
      y <  this.gameImgProps.y + this.gameImgProps.height
    ) {
      return this.gameImgProps;
    }
    if (
      x >= this.guiImgProps.x &&
      x <  this.guiImgProps.x + this.guiImgProps.width &&
      y >= this.guiImgProps.y &&
      y <  this.guiImgProps.y + this.guiImgProps.height
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
      this.gameImgProps.viewPoint.x = x;

      const dispH = this.gameImgProps.display.getHeight();
      const winH  = this.gameImgProps.height;
      const newScale = this.gameImgProps.viewPoint.scale;
      this.gameImgProps.viewPoint.y = Math.max(0, dispH - winH / newScale);

      this.redraw();
      return;
    }

    let scale = this.gameImgProps.viewPoint.scale;
    if (scale === 2) {
      this._rawScale = scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.x = x;

      const dispH = this.gameImgProps.display.getHeight();
      const winH  = this.gameImgProps.height;
      this.gameImgProps.viewPoint.y = Math.min(0, dispH - winH / scale);

      this.redraw();
      return;
    }

    const sceneX = this.gameImgProps.viewPoint.getSceneX(x - this.gameImgProps.x);
    const sceneY = this.gameImgProps.viewPoint.getSceneY(y - this.gameImgProps.y);
    this._rawScale = 2;
    this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
    this.gameImgProps.viewPoint.x = sceneX - (x - this.gameImgProps.x) / this.gameImgProps.viewPoint.scale;
    this.gameImgProps.viewPoint.y = sceneY - (y - this.gameImgProps.y) / this.gameImgProps.viewPoint.scale;

    this.redraw();
  }

  redraw() {
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
    const ctx = this.stageCav.getContext('2d', { alpha: false });
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

  startOverlayFade(color, rect = null) {
    if (this.overlayTimer) clearInterval(this.overlayTimer);
    this.overlayColor = color;
    this.overlayRect = rect;
    this.overlayAlpha = 1;
    this.overlayTimer = setInterval(() => {
      this.overlayAlpha = Math.max(this.overlayAlpha - 0.02, 0);
      if (this.overlayAlpha <= 0) {
        clearInterval(this.overlayTimer);
        this.overlayTimer = 0;
        setTimeout(() => {
          if (!this.overlayTimer) this.overlayRect = null;
        }, 0);
      }
    }, 40);
  }

  resetOverlayFade() {
    this.overlayAlpha = 0;
    this.overlayRect = null;
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

    const ctx = this.stageCav.getContext('2d', { alpha: false });
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
    }
  }

  drawCursor() {
    if (!this.cursorCanvas) return;
    const ctx = this.stageCav.getContext('2d', { alpha: true });
    const cx = Math.trunc(this.cursorX - this.cursorCanvas.width / 2);
    const cy = Math.trunc(this.cursorY - this.cursorCanvas.height / 2);
    ctx.drawImage(this.cursorCanvas, cx, cy);
  }

  getGameViewRect() {
    return {
      x: this.gameImgProps.viewPoint.x,
      y: this.gameImgProps.viewPoint.y,
      w: this.gameImgProps.width  / this.gameImgProps.viewPoint.scale,
      h: this.gameImgProps.height / this.gameImgProps.viewPoint.scale
    };
  }

  limitValue(minLimit, value, maxLimit) {
    return Math.min(Math.max(minLimit, value), maxLimit);
  }
}

Lemmings.Stage = Stage;
export { Stage };
