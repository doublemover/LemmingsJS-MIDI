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
import { levelGroundMutationMethods } from './LevelGroundMutation.js';
import { levelArrowSteelMethods } from './LevelArrowSteel.js';
import { levelRenderMethods } from './LevelRender.js';
class Level extends BaseLogger {
  constructor(width, height) {
    super();
    this.width = width | 0;
    this.height = height | 0;
    this.groundMask = new SolidLayer(this.width, this.height);
    this.groundImages = null;
    this.steelRanges = new Int32Array(0);
    this.steelMask = new SolidLayer(this.width, this.height);
  
    this.objects = [];
    this.entrances = [];
    this.triggers = [];
    this.arrowRanges = new Int32Array(0);
    this.arrowTriggers = [];
  
    this.name = '';
    this.releaseRate = 0;
    this.releaseCount = 0;
    this.needCount = 0;
    this.timeLimit = 0;
    this.skills = new Array(Object.keys(SkillTypes).length);
    this.screenPositionX = 0;
    this.isSuperLemming = false;
    /** mechanics customization */
    this.mechanics = {};
  
    /** @type {Frame|null} prebuilt debug overlay */
    this._debugFrame = null;
    this._groundTileSize = 64;
    this._groundTileColumns = Math.max(1, Math.ceil(this.width / this._groundTileSize));
    this._groundTileRows = Math.max(1, Math.ceil(this.height / this._groundTileSize));
    this._groundDirtyTiles = new Set();
    this._groundDirtyFull = true;
    this._groundDirtyRects = [];
    this.runtime = null;
  }

  renderDebug(gameDisplay) {
    if (!this._debugFrame) this.#buildDebugFrame();
    gameDisplay.drawFrame(this._debugFrame, 0, 0);
  }

  #buildDebugFrame() {
    const frame = new Frame(this.width, this.height);
    const steelColor  = ColorPalette.colorFromRGB(0, 255, 255);
    const arrowRColor = ColorPalette.colorFromRGB(128, 255, 0);
    const arrowLColor = ColorPalette.colorFromRGB(255, 128, 0);
  
    const s = this.steelRanges;
    for (let i = 0, len = s.length; i < len; i += 4) {
      frame.drawRect(s[i], s[i+1], s[i+2], s[i+3], steelColor);
    }
  
    const a = this.arrowRanges;
    for (let i = 0, len = a.length; i < len; i += 5) {
      const col = a[i+4] ? arrowRColor : arrowLColor;
      frame.drawRect(a[i], a[i+1], a[i+2], a[i+3], col);
    }
  
    this._debugFrame = frame;
  }
}
for (const methods of [
  levelGroundMutationMethods,
  levelArrowSteelMethods,
  levelRenderMethods
]) {
  Object.defineProperties(Level.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { Level };