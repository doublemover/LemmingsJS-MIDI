import {
  Animation,
  BaseLogger,
  ColorPalette,
  FIRE_INDICES,
  Frame,
  ICE_COLORS,
  MapObject,
  Range,
  SET_MAP_OBJECTS_MEASURE_DETAIL,
  SET_STEEL_MEASURE_DETAIL,
  SkillTypes,
  SolidLayer,
  Trigger,
  canMeasurePerformance,
  getAppContext,
  getMaskTransparentSpans,
  getRuntimeApp,
  getRuntimeHistory,
  getRuntimeMiniMap,
  getRuntimePerformanceContext,
  recordPerformanceMeasure
} from './LevelShared.js';
const levelRenderMethods = {
  setGroundImage(img) {
    this.groundImage = new Uint8ClampedArray(img);
    this._groundTileColumns = Math.max(1, Math.ceil(this.width / this._groundTileSize));
    this._groundTileRows = Math.max(1, Math.ceil(this.height / this._groundTileSize));
    this._markGroundDirtyAll();
  },

  setPalettes(colorPalette, groundPalette) {
    this.colorPalette = colorPalette;
    this.groundPalette = groundPalette;
  },

  render(gameDisplay) {
    gameDisplay.initSize(this.width, this.height);
    if (typeof gameDisplay.restoreBackground === 'function' &&
          typeof gameDisplay.syncBackground === 'function') {
      gameDisplay.setDirtyTileSize?.(this._groundTileSize);
      gameDisplay.restoreBackground();
      if (this._groundDirtyFull || !gameDisplay.hasBackground?.()) {
        gameDisplay.syncBackground(this.groundImage, this.groundMask, null, this._groundTileSize);
        gameDisplay.groundMask = this.groundMask;
        this._groundDirtyFull = false;
        this._groundDirtyTiles.clear();
        this._groundDirtyRects.length = 0;
        return;
      }
      if (this._groundDirtyTiles.size || this._groundDirtyRects.length) {
        let dirtyRects = this._consumeGroundDirtyTileRects();
        if (!dirtyRects.length && this._groundDirtyRects.length) {
          dirtyRects = this._groundDirtyRects.slice();
        }
        gameDisplay.syncBackground(this.groundImage, this.groundMask, dirtyRects, this._groundTileSize);
        gameDisplay.groundMask = this.groundMask;
        this._groundDirtyRects.length = 0;
        return;
      }
      gameDisplay.groundMask = this.groundMask;
      return;
    }
    gameDisplay.setBackground(this.groundImage, this.groundMask);
  }
};
export { levelRenderMethods };