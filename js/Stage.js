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
    this.guiImgProps = new Lemmings.StageImageProperties();
    // HUD always starts at scale = 2
    this.guiImgProps.viewPoint = new Lemmings.ViewPoint(0, 0, 2);
    this._rawScale = this.gameImgProps.viewPoint.scale; // for smooth zooming

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
    const x = stageImage.viewPoint.getSceneX(e.x - stageImage.x);
    const y = stageImage.viewPoint.getSceneY(e.y - stageImage.y);
    return new Lemmings.Position2D(x, y);
  }

  handleOnDoubleClick() {
    this.controller.onDoubleClick.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      stageImage.display.onDoubleClick.trigger(this.calcPosition2D(stageImage, e));
    });
  }
  handleOnMouseDown() {
    this.controller.onMouseDown.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      stageImage.display.onMouseDown.trigger(this.calcPosition2D(stageImage, e));
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
      stageImage.display.onMouseRightDown.trigger(this.calcPosition2D(stageImage, e));
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
        const x = e.x - stageImage.x;
        const y = e.y - stageImage.y;
        stageImage.display.onMouseMove.trigger(
          new Lemmings.Position2D(
            stageImage.viewPoint.getSceneX(x),
            stageImage.viewPoint.getSceneY(y)
          )
        );
      }
    });
  }
  handleOnZoom() {
    this.controller.onZoom.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      // Only zoom when we are on the game area (width = 1600)
      if (stageImage.display.getWidth() !== 1600) return;
      const pos = this.calcPosition2D(stageImage, e);
      this.updateViewPoint(stageImage, e.x, e.y, -e.deltaZoom, pos.x, pos.y);
    });
  }

  /**
   * Update the viewPoint (pan/zoom) for a given stageImage.  
   * - deltaX/deltaY = pixel drag (for panning)  
   * - deltaZoom = wheel change (positive/negative)  
   * - zx/zy = “world coordinates under the mouse” (only when zooming)  
   */
  updateViewPoint(stageImage, deltaX, deltaY, deltaZoom, zx = 0, zy = 0) {
    if (!stageImage || !stageImage.display) return;

    // 1) Zoom around a world‐point if deltaZoom != 0
    if (deltaZoom !== 0 && zx !== 0 && zy !== 0) {
      // Compute pixel offset relative to the image’s top‐left
      const screenX = deltaX - stageImage.x;
      const screenY = deltaY - stageImage.y;

      const sceneX = stageImage.viewPoint.getSceneX(screenX);
      const sceneY = stageImage.viewPoint.getSceneY(screenY);

      // Adjust raw scale, then snap
      const oldScale = stageImage.viewPoint.scale;
      this._rawScale = this.limitValue(
        0.25,
        this._rawScale * (1 + deltaZoom / 1500),
        8
      );
      const newScale = this.snapScale(this._rawScale);
      stageImage.viewPoint.scale = newScale;

      // Recenter so that (sceneX, sceneY) stays under the cursor
      stageImage.viewPoint.x = Math.fround(sceneX - screenX / newScale);
      stageImage.viewPoint.y = Math.fround(sceneY - screenY / newScale);
    }
    // 2) Otherwise, if no world‐coords (zx,zy), we are “panning”:
    else if (zx === 0 && zy === 0) {
      stageImage.viewPoint.x += Math.fround(deltaX / stageImage.viewPoint.scale);
      stageImage.viewPoint.y += Math.fround(deltaY / stageImage.viewPoint.scale);
    }

    // Redraw immediately
    if (stageImage.display) {
      this.clear(stageImage);
      const imgData = stageImage.display.getImageData();
      this.draw(stageImage, imgData);
    }

    // Clamp the viewPoint so the viewport never shows space outside the level
    const gameH = stageImage.display.getHeight();
    const winH = stageImage.height;
    const scale = stageImage.viewPoint.scale;
    const worldH = gameH; // world height in world units
    const viewH_world = winH / scale; // viewport height in world units
    stageImage.viewPoint.y = this.limitValue(
      worldH - viewH_world,
      stageImage.viewPoint.y,
      0
    );

    // — X: if scale ≥ 2, simply clamp so nothing goes offscreen
    const gameW = stageImage.display.getWidth();
    const winW = stageImage.width;
    const worldW = gameW;
    const viewW_world = winW / scale;

    if (scale >= 2) {
      // clamp between [0 .. (worldW - viewW_world)]
      stageImage.viewPoint.x = this.limitValue(
        0,
        stageImage.viewPoint.x,
        worldW - viewW_world
      );
    }
    // — If scale < 2, then “worldW * scale < winW” eventually. We want to interpolate
    //   from left-align (at scale=2) to fully centered (at scale=0.25).
    else {
      // minimalScale is 0.25 in our snapScale
      const minimalScale = 0.25;
      // If the level is not wide enough to fill the viewport:
      if (worldW * scale < winW) {
        // t goes from 0 at scale=2 to 1 at scale=minimalScale
        const t = Math.max(0, Math.min(1, (2 - scale) / (2 - minimalScale)));
        // desiredX_center = (worldW - viewW_world) / 2
        const desiredX_center = (worldW - viewW_world) / 2;
        // Interpolate: when t=0 -> x=0 (left-aligned); when t=1 -> x=centered
        stageImage.viewPoint.x = desiredX_center * t;
      } else {
        // if worldW*scale ≥ winW but scale<2, we still clamp:
        stageImage.viewPoint.x = this.limitValue(
          0,
          stageImage.viewPoint.x,
          worldW - viewW_world
        );
      }
    }

    // Finally, redraw one last time with the new clamped coordinates:
    if (stageImage.display) {
      this.clear(stageImage);
      const gameImg = stageImage.display.getImageData();
      this.draw(stageImage, gameImg);
    }
  }

  limitValue(minLimit, value, maxLimit) {
    const hi = Math.max(minLimit, maxLimit);
    return Math.min(Math.max(minLimit, value), hi);
  }

  /**
   * Snap a raw scale value so that the scaled output aligns to whole pixels.
   * Snapping uses the display size to calculate the minimal scale step.
   */
  snapScale(scale) {
    const w = this.gameImgProps.width | 0;
    const h = this.gameImgProps.height | 0;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const step = 1 / gcd(w, h);
    const clamped = this.limitValue(0.25, scale, 8);
    return Math.round(clamped / step) * step;
  }

  /**
   * Whenever the canvas resizes (or on construction), 
   * place the “game” area on top, the HUD centered below.
   * The game height is everything above the HUD,
   * and the HUD is always centered horizontally.
   *
   * We also “initialize” the game’s viewPoint so that it
   * starts glued to the bottom (flush against the HUD),
   * rather than sitting at the top‐left.
   */
  updateStageSize() {
    const stageH = this.stageCav.height;
    const stageW = this.stageCav.width;
    const scaleHUD = this.guiImgProps.viewPoint.scale; // always = 2 by default
    const rawHUDH = this.guiImgProps.display?.getHeight() || 80;
    const rawHUDW = this.guiImgProps.display?.getWidth() || 720;

    const panelH = rawHUDH * scaleHUD;
    const panelW = rawHUDW * scaleHUD;
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

    // 3) Now that both have dimensions, initialize the game’s viewPoint
    if (this.gameImgProps.display) {
      const displayHeight = this.gameImgProps.display.getHeight();
      const displayWidth = this.gameImgProps.display.getWidth();

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

      // Redraw at initial position
      this.clear(this.gameImgProps);
      const gameImg = this.gameImgProps.display.getImageData();
      this.draw(this.gameImgProps, gameImg);
    }

    // Redraw HUD as well
    if (this.guiImgProps.display) {
      const guiImg = this.guiImgProps.display.getImageData();
      this.draw(this.guiImgProps, guiImg);
    }
  }

  getStageImageAt(x, y) {
    if (this.isPositionInStageImage(this.gameImgProps, x, y))
      return this.gameImgProps;
    if (this.isPositionInStageImage(this.guiImgProps, x, y))
      return this.guiImgProps;
    return null;
  }

  isPositionInStageImage(stageImage, x, y) {
    return (
      stageImage.x <= x &&
      stageImage.x + stageImage.width >= x &&
      stageImage.y <= y &&
      stageImage.y + stageImage.height >= y
    );
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

    // If external code sets lemmings.scale > 0, treat similarly to zoom
    if (lemmings.scale > 0) {
      this._rawScale = lemmings.scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.x = x;
      const displayHeight = this.gameImgProps.display.getHeight();
      const gameHeight = this.gameImgProps.height;
      const newScale = this.gameImgProps.viewPoint.scale;
      this.gameImgProps.viewPoint.y = Math.max(
        0,
        displayHeight - gameHeight / newScale
      );
      this.redraw();
      return;
    }

    let scale = this.gameImgProps.viewPoint.scale;
    if (scale === 2) {
      this._rawScale = scale;
      this.gameImgProps.viewPoint.x = x;
      const displayHeight = this.gameImgProps.display.getHeight();
      const gameHeight = this.gameImgProps.height;
      this.gameImgProps.viewPoint.y = Math.max(
        0,
        displayHeight - gameHeight / scale
      );
      this.redraw();
      return;
    }

    // Otherwise, "zoom in" to scale=2 around (x,y)
    let sceneX = this.gameImgProps.viewPoint.getSceneX(x);
    let sceneY = this.gameImgProps.viewPoint.getSceneY(y);
    this._rawScale = 2;
    this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
    this.gameImgProps.viewPoint.x = sceneX - x / scale;
    this.gameImgProps.viewPoint.y = sceneY - y / scale;
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

  createImage(display, width, height) {
    return display === this.gameImgProps.display
      ? this.gameImgProps.createImage(width, height)
      : this.guiImgProps.createImage(width, height);
  }

  clear(stageImage) {
    const ctx = this.stageCav.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000000';
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
  resetOverlayFade() {
    this.overlayAlpha = 0;
    this.overlayRect = null;
    if (this.overlayTimer) clearInterval(this.overlayTimer);
    this.overlayTimer = 0;
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
        this.overlayRect = null;
      }
    }, 40);
  }

  dispose() {
    this.resetFade();
    if (this.gameImgProps.display?.dispose) this.gameImgProps.display.dispose();
    if (this.guiImgProps.display?.dispose) this.guiImgProps.display.dispose();
    if (this.controller?.dispose) this.controller.dispose();
    this.controller = null;
    this.gameImgProps = null;
    this.guiImgProps = null;
    this.stageCav = null;
  }

  draw(display, img) {
    if (!display.ctx) return;
    display.ctx.putImageData(img, 0, 0);

    const ctx = this.stageCav.getContext('2d', { alpha: false });
    //@ts-ignore
    ctx.mozImageSmoothingEnabled = false;
    //@ts-ignore
    ctx.webkitImageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;

    // Source rectangle
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

    // Destination rectangle
    let dx = display.x + Math.max(-display.viewPoint.x, 0) * display.viewPoint.scale;
    let dy = display.y + Math.max(-display.viewPoint.y, 0) * display.viewPoint.scale;
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

    // Fade overlay
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
    const x = Math.trunc(this.cursorX - this.cursorCanvas.width / 2);
    const y = Math.trunc(this.cursorY - this.cursorCanvas.height / 2);
    ctx.drawImage(this.cursorCanvas, x, y);
  }

  getGameViewRect() {
    return {
      x: this.gameImgProps.viewPoint.x,
      y: this.gameImgProps.viewPoint.y,
      w: this.gameImgProps.width / this.gameImgProps.viewPoint.scale,
      h: this.gameImgProps.height / this.gameImgProps.viewPoint.scale,
    };
  }
}
Lemmings.Stage = Stage;

export { Stage };
