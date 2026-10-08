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
const miniMapInputMethods = {
  setHoverInvalidationHandler(handler) { this.onHoverChanged = handler; },

  _setHoverTarget(target) {
    const previous = this._hoverTarget;
    if ((!previous && !target) || (previous && target && previous.x === target.x && previous.y === target.y && previous.w === target.w && previous.h === target.h)) return;
    this._hoverTarget = target; this._frameNeedsCompose = true;
    this.onHoverChanged?.();
  },

  _hookPointer() {
    this._displayListeners = [
      ['onMouseDown', e => { this._handleMouseDown(e); }],
      ['onMouseUp', e => { this._handleMouseUp(e); }],
      ['onMouseMove', e => { this._handleMouseMove(e); }],
    ];
    for (const [event, handler] of this._displayListeners) {
      this.guiDisplay[event].on(handler);
    }
    const stage = this.guiDisplay.stage, canvas = stage?.stageCav;
    const leave = () => this._setHoverTarget(null);
    const move = event => { if (stage.getStageImageAt?.(event.x, event.y)?.display !== this.guiDisplay) leave(); };
    stage?.controller?.onMouseMove?.on?.(move);
    canvas?.addEventListener?.('pointerleave', leave);
    this._hoverPointerCleanup = () => { stage?.controller?.onMouseMove?.off?.(move); canvas?.removeEventListener?.('pointerleave', leave); };
  },

  _viewportTargetFromPointer(event) {
    if (!this.guiDisplay || !this.level) return null;
    if (!Number.isFinite(event?.x) || !Number.isFinite(event?.y)) return null;
    const gd = this.guiDisplay;
    const destX = gd.worldDataSize.width - this.width;
    const destY = gd.worldDataSize.height - this.height;

    const mx = event.x - destX;
    const my = event.y - destY;
    if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return null;

    const pct = this.width <= 1 ? 0 : (mx / (this.width - 1));
    const viewRect = getApp(this.runtime)?.stage?.getGameViewRect?.();
    const stageViewWidth = viewRect?.w;
    const viewportWorldWidth = Number.isFinite(stageViewWidth) && stageViewWidth > 0
      ? stageViewWidth
      : gd.worldDataSize.width;
    const maxOffset = Math.max(0, this.levelWidth - viewportWorldWidth);
    const newX = clamp(Math.trunc(pct * maxOffset), 0, maxOffset);
    return { x: newX, y: viewRect?.y || 0, w: viewportWorldWidth, h: viewRect?.h || this.levelHeight };
  },

  _updateViewportFromPointer(event) {
    const target = this._viewportTargetFromPointer(event);
    if (!target) return;
    this.level.screenPositionX = target.x;
    this.guiDisplay.setScreenPosition?.(target.x, 0, { preserveScale: true });
  },

  _handleMouseDown(event){
    if (!this.guiDisplay) return;
    this._mouseDown = true;
    this._setHoverTarget(this._viewportTargetFromPointer(event));
    this._updateViewportFromPointer(event);
  },

  _handleMouseUp(event){
    if (!this.guiDisplay) return;
    this._mouseDown = false;
    this._setHoverTarget(this._viewportTargetFromPointer(event));
    this._updateViewportFromPointer(event);
  },

  _handleMouseMove(event){
    if (!this.guiDisplay) return;
    this._setHoverTarget(this._viewportTargetFromPointer(event));
    if (!this._mouseDown) return;
    this._updateViewportFromPointer(event);
  }
};
export { miniMapInputMethods };