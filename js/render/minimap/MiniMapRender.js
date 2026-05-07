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
const miniMapRenderMethods = {
  render() {
    const terrainChanged = this._flushTerrainInvalidation();
    if (terrainChanged) {
      this._frameNeedsCompose = true;
    }
    if (!this.guiDisplay) return false;
    const app = getApp(this.runtime);
    const reversing = isRuntimeReplayApplying(this.runtime);
    this._renderStats.draws += 1;

    let dashChanged = false;
    if (++this._viewportCounter >= this.viewportDashDelay) {
      this._viewportCounter = 0;
      this.viewportDashOffset += 1;
      dashChanged = true;
    }

    const {
      width: W,
      height: H,
      frame,
    } = this;
    const frameData = frame.data;

    const viewRect = app?.stage?.getGameViewRect?.();
    if (!viewRect) return false;
    const vpX = (viewRect.x * this.scaleX) | 0;
    let vpW = (viewRect.w * this.scaleX) | 0;
    const vpY = (viewRect.y * this.scaleY) | 0;
    const vpH = (viewRect.h * this.scaleY) | 0;
    const viewChanged =
        this._lastViewRectX !== vpX ||
        this._lastViewRectY !== vpY ||
        this._lastViewRectW !== vpW ||
        this._lastViewRectH !== vpH ||
        this._lastViewDashOffset !== this.viewportDashOffset;
    if (viewChanged || dashChanged) {
      this._frameNeedsCompose = true;
      this._lastViewRectX = vpX;
      this._lastViewRectY = vpY;
      this._lastViewRectW = vpW;
      this._lastViewRectH = vpH;
      this._lastViewDashOffset = this.viewportDashOffset;
    }

    if (this.liveDots !== this._lastLiveDotsRef || this.liveDotsLength !== this._lastLiveDotsLength) {
      this._frameNeedsCompose = true;
      this._lastLiveDotsRef = this.liveDots;
      this._lastLiveDotsLength = this.liveDotsLength;
    }
    const selectedVisible = !!this.selectedDot;
    const selectedX = selectedVisible ? this.selectedDot[0] : Number.NaN;
    const selectedY = selectedVisible ? this.selectedDot[1] : Number.NaN;
    const selectedChanged =
        this._lastSelectedDotVisible !== selectedVisible ||
        (selectedVisible && (
          this._lastSelectedDotX !== selectedX ||
          this._lastSelectedDotY !== selectedY
        ));
    if (selectedChanged) {
      this._frameNeedsCompose = true;
      this._lastSelectedDotVisible = selectedVisible;
      this._lastSelectedDotX = selectedX;
      this._lastSelectedDotY = selectedY;
    }
    if (reversing !== this._lastReversing) {
      this._frameNeedsCompose = true;
      this._lastReversing = reversing;
    }
    if (!reversing && this._decayDeathDots()) {
      this._frameNeedsCompose = true;
    }

    if (this._frameNeedsCompose) {
      frameData.set(this.terrainColors);
      this._paintObjectMarkers(frameData);

      let vpXW = vpX + vpW;
      // dumb fix to keep right edge of viewport rect visible
      if (vpXW === this.width) {
        vpW -= 1;
      }
      frame.drawMarchingAntRect(
        vpX,
        vpY,
        vpW,
        vpH,
        2,
        this.viewportDashOffset,
        0xFF00FF00,
        0xFF005500
      );

      /* Live lemmings */
      for (let i = 0; i < this.liveDotsLength; i += 2) {
        const x = this.liveDots[i];
        const y = this.liveDots[i + 1];
        if ((x >>> 0) < W && (y >>> 0) < H) {
          frameData[(y * W) + x] = 0xFF00FFFF;
        }
      }
      if (this.selectedDot) {
        const x = this.selectedDot[0];
        const y = this.selectedDot[1];
        if ((x >>> 0) < W && (y >>> 0) < H) {
          frameData[(y * W) + x] = 0xFFFFFFFF;
        }
      }

      /* Death flashes */
      const total = this.deadCount;
      for (let i = 0; i < total; ++i) {
        const ttl = this.deadTTLs[i];
        if (ttl <= 0) continue;
        if (ttl & 4) {
          const x = this.deadDots[i * 2];
          const y = this.deadDots[i * 2 + 1];
          if ((x >>> 0) < W && (y >>> 0) < H) {
            frameData[(y * W) + x] = 0xFF0000FF;
          }
        }
      }
      this._renderStats.composes += 1;
      this._frameNeedsCompose = false;
    } else {
      this._renderStats.reuses += 1;
      this._renderStats.lastTerrainCells = this._lastTerrainRevalidated;
      this._renderStats.lastDeadCount = this.deadCount;
      return false;
    }

    this._renderStats.lastTerrainCells = this._lastTerrainRevalidated;
    this._renderStats.lastDeadCount = this.deadCount;

    /* Blit */
    const destX = this.guiDisplay.worldDataSize.width  - W;
    const destY = this.guiDisplay.worldDataSize.height - H;
    this.guiDisplay.drawFrame(frame, destX, destY);
    return true;
  },

  dispose() {
    if (this.guiDisplay && this._displayListeners) {
      for (const [event, handler] of this._displayListeners) {
        this.guiDisplay[event].off(handler);
      }
      this._displayListeners = null;
    }
    this.gameDisplay = null;
    this.level = null;
    this.guiDisplay = null;
    this.terrain = null;
    this.fog = null;
    this.liveDots = null;
    this.liveDotsLength = 0;
    this.selectedDot = null;
    this.deadDots = null;
    this.deadTTLs = null;
    this.deadCount = 0;
    this.frame = null;
    this.runtime = null;
  }
};
export { miniMapRenderMethods };