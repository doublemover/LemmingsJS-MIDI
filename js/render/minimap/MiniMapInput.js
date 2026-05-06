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
  _hookPointer() {
    this._displayListeners = [
      ['onMouseDown', e => { this._handleMouseDown(e); }],
      ['onMouseUp', e => { this._handleMouseUp(e); }],
      ['onMouseMove', e => { this._handleMouseMove(e); }],
    ];
    for (const [event, handler] of this._displayListeners) {
      this.guiDisplay[event].on(handler);
    }
  },

  _updateViewportFromPointer(event) {
    if (!this.guiDisplay || !this.level) return;
    if (!Number.isFinite(event?.x) || !Number.isFinite(event?.y)) return;
    const gd = this.guiDisplay;
    const destX = gd.worldDataSize.width - this.width;
    const destY = gd.worldDataSize.height - this.height;

    const mx = event.x - destX;
    const my = event.y - destY;
    if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return;

    const pct = this.width <= 1 ? 0 : (mx / (this.width - 1));
    const stageViewWidth = getApp(this.runtime)?.stage?.getGameViewRect?.()?.w;
    const viewportWorldWidth = Number.isFinite(stageViewWidth) && stageViewWidth > 0
      ? stageViewWidth
      : gd.worldDataSize.width;
    const maxOffset = Math.max(0, this.levelWidth - viewportWorldWidth);
    const newX = clamp(Math.trunc(pct * maxOffset), 0, maxOffset);
    this.level.screenPositionX = newX;
    gd.setScreenPosition?.(newX, 0, { preserveScale: true });
  },

  _handleMouseDown(event){
    if (!this.guiDisplay) return;
    this._mouseDown = true;
    this._updateViewportFromPointer(event);
  },

  _handleMouseUp(event){
    if (!this.guiDisplay) return;
    this._mouseDown = false;
    this._updateViewportFromPointer(event);
  },

  _handleMouseMove(event){
    if (!this.guiDisplay) return;
    if (!this._mouseDown) return;
    this._updateViewportFromPointer(event);
  }
};
export { miniMapInputMethods };