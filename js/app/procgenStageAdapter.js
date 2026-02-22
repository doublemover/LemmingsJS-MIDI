import { DisplayImage } from '../render/DisplayImage.js';

class ProcgenStageAdapter {
  constructor({ view, controller, canvas }) {
    this.view = view || null;
    this.controller = controller || null;
    this.canvas = canvas || null;
    this.stage = view?.stage || null;
    this._wheelHandler = null;
    this._resizeHandler = null;
    this._snapOverridden = false;
    this._snapScaleOriginal = null;
    this._installed = false;
    this.maxScale = 6;
    this.zoomStep = 1.1;
  }

  install() {
    if (this._installed || !this.stage) return;
    this._ensureGuiBuffer();
    this._overrideScaleClamp();
    this._bindZoom();
    this._bindResize();
    this._installed = true;
  }

  /** Release all bound listeners and restore stage behavior. */
  dispose() {
    this._unbindZoom();
    this._unbindResize();
    this._restoreScaleClamp();
    this._installed = false;
  }

  updateStageSize() {
    if (!this.stage) return;
    this._ensureGuiBuffer();
    this.stage.updateStageSize?.();
  }

  _bindZoom() {
    if (!this.canvas || this._wheelHandler) return;
    this._wheelHandler = event => {
      event.preventDefault();
      const stage = this.stage;
      const stageImage = stage?.gameImgProps;
      if (!stage || !stageImage) return;
      const current = stageImage.viewPoint.scale || 1;
      const factor = event.deltaY > 0 ? 1 / this.zoomStep : this.zoomStep;
      const next = this._clampScale(current * factor);
      if (next === current) return;
      stage.applyViewport(stageImage, stageImage.viewPoint.x || 0, stageImage.viewPoint.y || 0, next);
      stage.redraw();
    };
    this.canvas.addEventListener('wheel', this._wheelHandler, { passive: false });
  }

  _unbindZoom() {
    if (!this.canvas || !this._wheelHandler) return;
    this.canvas.removeEventListener('wheel', this._wheelHandler);
    this._wheelHandler = null;
  }

  _bindResize() {
    if (this._resizeHandler) return;
    this._resizeHandler = () => {
      this.updateStageSize();
    };
    window.addEventListener('resize', this._resizeHandler);
  }

  _unbindResize() {
    if (!this._resizeHandler) return;
    window.removeEventListener('resize', this._resizeHandler);
    this._resizeHandler = null;
  }

  _clampScale(scale) {
    const minScale = this._getMinScale();
    return Math.min(this.maxScale, Math.max(minScale, scale));
  }

  _getMinScale() {
    const stageImage = this.stage?.gameImgProps;
    const level = this.view?.game?.level || this.controller?.level;
    if (!stageImage || !level) return 0.1;
    const worldWidth = Math.max(1, this._getWorldWidth());
    const worldHeight = Math.max(1, level.height || 1);
    const vp = stageImage.canvasViewportSize;
    const fitX = vp.width > 0 ? vp.width / worldWidth : 0.1;
    const fitY = vp.height > 0 ? vp.height / worldHeight : 0.1;
    if (fitX >= 1 && fitY >= 1) {
      return 1;
    }
    return Math.max(0.01, Math.min(1, Math.min(fitX, fitY)));
  }

  _overrideScaleClamp() {
    if (this._snapOverridden || !this.stage) return;
    this._snapOverridden = true;
    this._snapScaleOriginal = this.stage.snapScale;
    this.stage.snapScale = (rawScale) => {
      const display = this.stage?.gameImgProps?.display;
      const { width: dispW, height: dispH } = display?.worldDataSize || {};
      if (!dispW || !dispH) return rawScale;
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const g = gcd(dispW, dispH);
      const step = 1 / g;
      const minScale = this._getMinScale();
      let clamped = rawScale;
      if (clamped < minScale) clamped = minScale;
      if (clamped > this.maxScale) clamped = this.maxScale;
      return Math.round(clamped / step) * step;
    };
  }

  _restoreScaleClamp() {
    if (!this._snapOverridden || !this.stage) return;
    this.stage.snapScale = this._snapScaleOriginal;
    this._snapScaleOriginal = null;
    this._snapOverridden = false;
  }

  _getWorldWidth() {
    const level = this.view?.game?.level || this.controller?.level;
    const extent = this.controller?.getGroundExtentX?.();
    if (Number.isFinite(extent) && extent > 0) return extent;
    return Number.isFinite(level?.width) && level.width > 0 ? level.width : 1;
  }

  _ensureGuiBuffer() {
    if (!this.stage) return;
    const guiProps = this.stage.guiImgProps;
    if (guiProps?.display) return;
    const display = new DisplayImage(this.stage);
    display.initSize(1, 1);
    guiProps.display = display;
    guiProps.canvasViewportSize = { width: 1, height: 1 };
    guiProps.viewPoint.setX(0);
    guiProps.viewPoint.setY(0);
  }
}

export { ProcgenStageAdapter };
