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
import { miniMapInputMethods } from './MiniMapInput.js';
import { miniMapTerrainMethods } from './MiniMapTerrain.js';
import { miniMapRenderMethods } from './MiniMapRender.js';
class MiniMap {
  static palette = null;

  static DEATH_DOT_TTL = 30;

  constructor(gameDisplay, level, guiDisplay, runtime = null) {
    this.gameDisplay = gameDisplay;
    this.level = level;
    this.guiDisplay = guiDisplay;
    this.runtime = runtime;
  
    this.width = 127;
    this.height = 24;
    this.size = this.width * this.height;
    const levelWidth = Number.isFinite(level?.width) && level.width > 0 ? level.width : this.width;
    const levelHeight = Number.isFinite(level?.height) && level.height > 0 ? level.height : this.height;
    this.levelWidth = levelWidth;
    this.levelHeight = levelHeight;
    this.scaleX = this.width / levelWidth;
    this.scaleY = this.height / levelHeight;
  
    this.terrain = new Uint8Array(this.size);
    this.terrainColors = new Uint32Array(this.size);
    this._terrainDirtyFlags = new Uint8Array(this.size);
    this._terrainDirtyIndices = new Uint16Array(this.size);
    this._terrainDirtyCount = 0;
    this._terrainDirtyRead = 0;
    this._terrainDirtyWrite = 0;
    this.terrainRevalidateBudget = Math.max(64, this.size >> 2);
    this._objectMarkerIndices = new Uint16Array(0);
    this._objectMarkerColors = new Uint32Array(0);
  
    if (!MiniMap.palette) {
      MiniMap.palette = new Uint32Array(129);
      for (let i = 1; i <= 128; ++i) {
        MiniMap.palette[i] = 0xFF000000 | ((i*2) << 8);
      }
    }
    this._buildTerrain();
    this._buildObjectMarkers();
  
    // dynamic state
    this.fog = new Uint8Array(this.size); // 0 = unseen
    this.fog.fill(1); // disabled
    // typed array storing [x1,y1,x2,y2,...] scaled to minimap
    this.liveDots = new Uint8Array(0);
    this.liveDotsLength = 0;
    this.selectedDot = null;
    // typed arrays storing [x1,y1,x2,y2,...] and TTL per dot
    this.deadDots = new Uint8Array(64);
    this.deadTTLs = new Uint8Array(32);
    this.deadCount = 0;
  
    // render target (drawn into the GUI canvas once per frame)
    this.frame = new Frame(this.width, this.height);
    this.frame.mask.fill(1);
    //this.renderFrame = new Frame(this.renderWidth, this.renderHeight);
  
    this._displayListeners = null;
    this._mouseDown = false;
    this.viewportDashOffset = 0;
    this._viewportCounter = 0;
    this.viewportDashDelay = 100;
    this._frameNeedsCompose = true;
    this._lastViewRectX = Number.NaN;
    this._lastViewRectY = Number.NaN;
    this._lastViewRectW = Number.NaN;
    this._lastViewRectH = Number.NaN;
    this._lastViewDashOffset = Number.NaN;
    this._lastLiveDotsRef = this.liveDots;
    this._lastLiveDotsLength = 0;
    this._lastSelectedDotVisible = false;
    this._lastSelectedDotX = Number.NaN;
    this._lastSelectedDotY = Number.NaN;
    this._lastReversing = false;
    this._lastTerrainRevalidated = 0;
    this._renderStats = {
      draws: 0,
      composes: 0,
      reuses: 0,
      lastTerrainCells: 0,
      lastDeadCount: 0
    };
    if (this.guiDisplay) this._hookPointer();
  }
}
for (const methods of [
  miniMapInputMethods,
  miniMapTerrainMethods,
  miniMapRenderMethods
]) {
  Object.defineProperties(MiniMap.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { MiniMap };