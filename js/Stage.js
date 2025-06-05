import { Lemmings } from './LemmingsNamespace.js';

class Stage {
  constructor(canvasForOutput) {
    this.controller = null;
    this.fadeTimer = 0;
    this.fadeAlpha = 0;
    this.overlayColor = 'black';
    this.overlayAlpha = 0;
    this.overlayTimer = 0;
    this.overlayRect = null;
    this.cursorCanvas = null;
    this.cursorX = 0;
    this.cursorY = 0;
    this.stageCav = canvasForOutput;
    this.gameImgProps = new Lemmings.StageImageProperties();
    this.guiImgProps = new Lemmings.StageImageProperties();
    this.guiImgProps.viewPoint = new Lemmings.ViewPoint(0, 0, 2);
    // track raw (unsnapped) scale value for smooth zooming
    this._rawScale = this.gameImgProps.viewPoint.scale;
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
    ictx.putImageData(new ImageData(frame.getData(), frame.width, frame.height), 0, 0);
    this.cursorCanvas = c;
  }
  calcPosition2D(stageImage, e) {
    let x = (stageImage.viewPoint.getSceneX(e.x - stageImage.x));
    let y = (stageImage.viewPoint.getSceneY(e.y - stageImage.y));
    return new Lemmings.Position2D(x, y);
  }
  handleOnDoubleClick() {
    this.controller.onDoubleClick.on((e) => {
      let stageImage = this.getStageImageAt(e.x, e.y);
      if ((stageImage == null) || (stageImage.display == null))
        return;
      stageImage.display.onDoubleClick.trigger(this.calcPosition2D(stageImage, e));
    });
  }
  handleOnMouseDown() {
    this.controller.onMouseDown.on((e) => {
      let stageImage = this.getStageImageAt(e.x, e.y);
      if ((stageImage == null) || (stageImage.display == null))
        return;
      stageImage.display.onMouseDown.trigger(this.calcPosition2D(stageImage, e));
    });
  }
  handleOnMouseUp() {
    this.controller.onMouseUp.on((e) => {
      let stageImage = this.getStageImageAt(e.x, e.y);
      if ((stageImage == null) || (stageImage.display == null))
        return;
      let pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseUp.trigger(pos);
    });
  }
  handleOnMouseRightDown() {
    this.controller.onMouseRightDown.on((e) => {
      let stageImage = this.getStageImageAt(e.x, e.y);
      if ((stageImage == null) || (stageImage.display == null))
        return;
      stageImage.display.onMouseRightDown.trigger(this.calcPosition2D(stageImage, e));
    });
  }
  handleOnMouseRightUp() {
    this.controller.onMouseRightUp.on((e) => {
      let stageImage = this.getStageImageAt(e.x, e.y);
      if ((stageImage == null) || (stageImage.display == null))
        return;
      let pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseRightUp.trigger(pos);
    });
  }
  handleOnMouseMove() {
    this.controller.onMouseMove.on((e) => {
      this.cursorX = e.x;
      this.cursorY = e.y;
      if (e.button) {
        let stageImage = this.getStageImageAt(e.mouseDownX, e.mouseDownY);
        if (stageImage == null || stageImage.display == null)
          return;
        if (stageImage == this.gameImgProps) {
          this.updateViewPoint(stageImage, e.deltaX, e.deltaY, 0);
        }
        let pos = this.calcPosition2D(stageImage, e);
        stageImage.display.onMouseMove.trigger(pos);
      } else {
        let stageImage = this.getStageImageAt(e.x, e.y);
        if (stageImage == null)
          return;
        if (stageImage.display == null)
          return;
        let x = e.x - stageImage.x;
        let y = e.y - stageImage.y;
        stageImage.display.onMouseMove.trigger(new Lemmings.Position2D(stageImage.viewPoint.getSceneX(x), stageImage.viewPoint.getSceneY(y)));
      }
    });
  }
  handleOnZoom() {
    this.controller.onZoom.on((e) => {
      let stageImage = this.getStageImageAt(e.x, e.y);
      if (stageImage == null || stageImage.display == null) return;
      if (stageImage.display.getWidth() != 1600) return;
      let pos = this.calcPosition2D(stageImage, e);
      this.updateViewPoint(stageImage, e.x, e.y, -e.deltaZoom, pos.x, pos.y);
    });
  }
  updateViewPoint(stageImage, deltaX, deltaY, deltaZoom, zx = 0, zy = 0) {
    if ((stageImage == null) || (stageImage.display == null))
      return;

    // Mousewheel zoom: zx and zy are world coords under mouse
    if (deltaZoom !== 0 && zx !== 0 && zy !== 0) {
      // Calculate the screen (pixel) position relative to the image
      let screenX = deltaX - stageImage.x;
      let screenY = deltaY - stageImage.y;

      // World coords under cursor before zoom
      let sceneX = stageImage.viewPoint.getSceneX(screenX);
      let sceneY = stageImage.viewPoint.getSceneY(screenY);

      // Zoom around that point
      const oldScale = stageImage.viewPoint.scale;
      // accumulate zoom on the raw scale value then snap for crisp pixels
      this._rawScale = this.limitValue(.25, this._rawScale * (1 + deltaZoom / 1500), 8);
      const newScale = this.snapScale(this._rawScale);
      stageImage.viewPoint.scale = newScale;

      // Re-center so the same world point stays under the cursor
      stageImage.viewPoint.x = sceneX - screenX / stageImage.viewPoint.scale;
      stageImage.viewPoint.y = sceneY - screenY / stageImage.viewPoint.scale;
    } else if (zx == 0 && zy == 0) {
      // Dragging: keep as before
      stageImage.viewPoint.x += Math.fround(deltaX / stageImage.viewPoint.scale);
      stageImage.viewPoint.y += Math.fround(deltaY / stageImage.viewPoint.scale);
    }

    if (stageImage.display != null) {
      this.clear(stageImage);
      const gameImg = stageImage.display.getImageData();
      this.draw(stageImage, gameImg);
    }

    const scale = stageImage.viewPoint.scale;
    const maxX = stageImage.display.getWidth() - stageImage.width / scale;
    const maxY = stageImage.display.getHeight() - stageImage.height / scale;

    if (scale < 1) {
      const wDiff = stageImage.width - stageImage.display.getWidth() * scale;
      if (wDiff > 0) stageImage.viewPoint.x = -wDiff / (2 * scale);
      stageImage.viewPoint.y = stageImage.height - stageImage.display.getHeight() / scale;
    } else {
      stageImage.viewPoint.x = Math.min(Math.max(0, stageImage.viewPoint.x), maxX);
      stageImage.viewPoint.y = Math.min(Math.max(0, stageImage.viewPoint.y), maxY);
    }

    // stageImage.viewPoint.x = this.limitValue(0, stageImage.viewPoint.x, stageImage.display.getWidth() - stageImage.width / stageImage.viewPoint.scale);
    // stageImage.viewPoint.y = this.limitValue(0, stageImage.display.getHeight() - stageImage.height / stageImage.viewPoint.scale, stageImage.viewPoint.y);

    if (stageImage.display != null) {
      this.clear(stageImage);
      let gameImg = stageImage.display.getImageData();
      this.draw(stageImage, gameImg);
    }
  }
  limitValue(minLimit, value, maxLimit) {
    let useMax = Math.max(minLimit, maxLimit);
    return Math.min(Math.max(minLimit, value), useMax);
  }

  /**
   * Snap a raw scale value so that the scaled output aligns to whole pixels.
   * Snapping uses the display size to calculate the minimal scale step.
   */
  snapScale(scale) {
    const w = this.gameImgProps.width | 0;
    const h = this.gameImgProps.height | 0;
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const step = 1 / gcd(w, h);
    const clamped = this.limitValue(0.25, scale, 8);
    return Math.round(clamped / step) * step;
  }


  updateStageSize() {
    const stageHeight = this.stageCav.height;
    const stageWidth = this.stageCav.width;
    const panelRawHeight = this.guiImgProps.display?.getHeight() || 80;
    const gamePanelOffset = (stageHeight - panelRawHeight - 20);
    this.gameImgProps.y = -20;
    this.gameImgProps.x = 0;
    this.gameImgProps.height = stageHeight - panelRawHeight;
    this.gameImgProps.width = stageWidth;
    this.guiImgProps.y = gamePanelOffset;
    this.guiImgProps.height = panelRawHeight;
    this.guiImgProps.width = this.guiImgProps.display?.getWidth() || 720;
    if (this.guiImgProps.display) {
      const guiW = this.guiImgProps.display.getWidth();
      this.guiImgProps.x = (stageWidth/4);
    }
    if (this.gameImgProps.display) {
      this.redraw();
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
    return ((stageImage.x <= x) && ((stageImage.x + stageImage.width) >= x) &&
                (stageImage.y <= y) && ((stageImage.y + stageImage.height) >= y));
  }

  getGameDisplay() {
    if (this.gameImgProps.display != null)
      return this.gameImgProps.display;
    this.gameImgProps.display = new Lemmings.DisplayImage(this);
    return this.gameImgProps.display;
  }

  getGuiDisplay() {
    if (this.guiImgProps.display != null) {
      return this.guiImgProps.display;
    }

    this.guiImgProps.display = new Lemmings.DisplayImage(this);
    return this.guiImgProps.display;
  }
  /** set the position of the view point for the game display */
  setGameViewPointPosition(x, y) {
    this.clear(this.gameImgProps);

    if (lemmings.scale > 0) {
      this._rawScale = lemmings.scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.x = x;
      const displayHeight = this.gameImgProps.display.getHeight();
      const gameHeight = this.gameImgProps.height;
      const scale = this.gameImgProps.viewPoint.scale;
      this.gameImgProps.viewPoint.y = Math.max(0, displayHeight - gameHeight / scale);
      this.redraw();
      return;
    }

    let scale = this.gameImgProps.viewPoint.scale;
    if (scale == 2) {
      this._rawScale = this.gameImgProps.viewPoint.scale;
      this.gameImgProps.viewPoint.x = x;
      const displayHeight = this.gameImgProps.display.getHeight();
      const gameHeight = this.gameImgProps.height;
      const newScale = this.gameImgProps.viewPoint.scale;
      this.gameImgProps.viewPoint.y = Math.max(0, displayHeight - gameHeight / newScale);
      this.redraw();
      return;
    } else {

      let sceneX = this.gameImgProps.viewPoint.getSceneX(x);
      let sceneY = this.gameImgProps.viewPoint.getSceneY(y);
      this._rawScale = 2;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.x = sceneX - x / scale;
      this.gameImgProps.viewPoint.y = sceneY - y / scale;
      this.redraw();
    }
  }
  /** redraw everything */
  redraw() {
    if (this.gameImgProps.display != null) {
      let gameImg = this.gameImgProps.display.getImageData();
      this.draw(this.gameImgProps, gameImg);
    }
    if (this.guiImgProps.display != null) {
      let guiImg = this.guiImgProps.display.getImageData();
      this.draw(this.guiImgProps, guiImg);
    }
    this.drawCursor();
  }
  createImage(display, width, height) {
    if (display == this.gameImgProps.display) {
      return this.gameImgProps.createImage(width, height);
    } else {
      return this.guiImgProps.createImage(width, height);
    }
  }
  /** clear the stage/display/output */
  clear(stageImage) {
    const ctx = this.stageCav.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000000';
    if (stageImage == null) {
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      ctx.fillRect(stageImage.x, stageImage.y, stageImage.width, stageImage.height);
    }
  }
  resetFade() {
    this.fadeAlpha = 0;
    this.overlayAlpha = 0;
    this.overlayRect = null;
    if (this.fadeTimer != 0) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = 0;
    }
    if (this.overlayTimer != 0) {
      clearInterval(this.overlayTimer);
      this.overlayTimer = 0;
    }
  }

  startOverlayFade(color, rect = null) {
    if (this.overlayTimer) {
      clearInterval(this.overlayTimer);
      this.overlayTimer = 0;
    }
    if (color) this.overlayColor = color;
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

  resetOverlayFade() {
    this.overlayAlpha = 0;
    if (this.overlayTimer != 0) {
      clearInterval(this.overlayTimer);
      this.overlayTimer = 0;
    }
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

  dispose() {
    this.resetFade();
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = 0;
    }
    if (this.overlayTimer) {
      clearInterval(this.overlayTimer);
      this.overlayTimer = 0;
    }
    if (this.gameImgProps.display?.dispose) this.gameImgProps.display.dispose();
    if (this.guiImgProps.display?.dispose) this.guiImgProps.display.dispose();
    if (this.controller && this.controller.dispose) {
      this.controller.dispose();
    }
    this.controller = null;
    this.gameImgProps = null;
    this.guiImgProps = null;
    this.stageCav = null;
  }
  /** draw everything to the stage/display */
  draw(display, img) {
    if (display.ctx == null)
      return;
    /// write image to context
    display.ctx.putImageData(img, 0, 0);
    let ctx = this.stageCav.getContext('2d', { alpha: false });
    //@ts-ignore
    ctx.mozImageSmoothingEnabled = false;
    //@ts-ignore
    ctx.webkitImageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;
    let outH = display.height;
    let outW = display.width;
    ctx.globalAlpha = 1;
    //- Display Layers
    let dW = img.width - display.viewPoint.x; //- display width
    if ((dW * display.viewPoint.scale) > outW) {
      dW = outW / display.viewPoint.scale;
    }
    let dH = img.height - display.viewPoint.y; //- display height
    if ((dH * display.viewPoint.scale) > outH) {
      dH = outH / display.viewPoint.scale;
    }
    //- drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh)
    ctx.drawImage(display.cav, display.viewPoint.x, display.viewPoint.y, dW, dH, display.x, display.y, Math.trunc(dW * display.viewPoint.scale), Math.trunc(dH * display.viewPoint.scale));
    //- apply fading
    if (this.fadeAlpha != 0) {
      ctx.globalAlpha = this.fadeAlpha;
      ctx.fillStyle = 'black';
      ctx.fillRect(display.x, display.y, Math.trunc(dW * display.viewPoint.scale), Math.trunc(dH * display.viewPoint.scale));
      ctx.globalAlpha = 1;
    }
    if (this.overlayAlpha > 0) {
      ctx.globalAlpha = this.overlayAlpha;
      ctx.fillStyle = this.overlayColor;
      if (this.overlayRect) {
        const scale = display.viewPoint.scale;
        const x = display.x + Math.trunc(this.overlayRect.x * scale);
        const y = display.y + Math.trunc(this.overlayRect.y * scale);
        const w = Math.trunc(this.overlayRect.w * scale);
        const h = Math.trunc(this.overlayRect.h * scale);
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.fillRect(display.x, display.y, Math.trunc(dW * display.viewPoint.scale), Math.trunc(dH * display.viewPoint.scale));
      }
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
      h: this.gameImgProps.height / this.gameImgProps.viewPoint.scale
    };
  }
}
Lemmings.Stage = Stage;

export { Stage };
