import {
  BaseLogger,
  DIRTY_RECT_FULL_LIMIT,
  DIRTY_RECT_MERGE_PAD,
  DIRTY_TILE_FULL_LIMIT,
  EMPTY_DIRTY_RECTS,
  EventHandler,
  MAX_MARCHING_ANT_CACHE_ENTRIES,
  MAX_MARCHING_ANT_FAST_PERIMETER,
  MAX_MARCHING_ANT_PATTERN_CACHE_ENTRIES,
  MAX_NEAREST_COORD_CACHE_ENTRIES,
  MAX_SCALED_VARIANTS_PER_FRAME,
  __test__,
  cyrb53,
  drawDashedRect,
  drawMarchingAntRect,
  frameOpaqueCache,
  getClippedDestinationSpan,
  getMarchingAntPaintPattern,
  getMarchingAntPerimeterOffsets,
  getNearestCoordinateMap,
  getScaledFrameVariant,
  hqxScale,
  initHqx,
  isFrameFullyOpaque,
  marchingAntPatternCache,
  marchingAntPerimeterCache,
  nearestCoordinateCache,
  scaleHqx,
  scaleImage,
  scaleNearest,
  scaleXbrz,
  scaledFrameCache,
  toUint32Source
} from './DisplayImageShared.js';
import { displayDirtyTrackingMethods } from './DisplayDirtyTracking.js';
import { displayPrimitivesMethods } from './DisplayPrimitives.js';
import { displayBlitMethods } from './DisplayBlit.js';
class DisplayImage extends BaseLogger {
  constructor(stage) {
    super();
    this.stage = stage;
    this.onMouseUp = new EventHandler();
    this.onMouseDown = new EventHandler();
    this.onMouseRightDown = new EventHandler();
    this.onMouseRightUp = new EventHandler();
    this.onMouseMove = new EventHandler();
    this.onDoubleClick = new EventHandler();
    // 32‑bit view reused everywhere; set by initSize()
    this.buffer32 = null;
    this.background32 = null;
    this._hasBackground = false;
    this._dirtyFull = true;
    this._dirtyRects = [];
    this._dirtyRectListPool = [];
    this._dirtyTileSize = 0;
    this._dirtyTileColumns = 0;
    this._dirtyTileRows = 0;
    this._dirtyTileFull = true;
    this._dirtyTiles = new Set();
    this._dirtyTileListPool = [];
    this._allocationStats = {
      rectListCreated: 0,
      rectListReused: 0,
      tileListCreated: 0,
      tileListReused: 0
    };
    this._dynamicDirtyFull = false;
    this._dynamicDirtyRects = [];
    this._restoreFull = false;
    this._restoreRects = [];
    // this.onMouseDown.on(e => {
    //     // this.setDebugPixel(e.x, e.y);
    // });
    this.imgData = null;
  }
}
for (const methods of [
  displayDirtyTrackingMethods,
  displayPrimitivesMethods,
  displayBlitMethods
]) {
  Object.defineProperties(DisplayImage.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { DisplayImage };