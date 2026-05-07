import { BaseLogger } from '../../util/LogHandler.js';
import { Animation } from '../../render/Animation.js';
import { ColorPalette } from '../../render/ColorPalette.js';
import { Frame } from '../../render/Frame.js';
import { MapObject } from '../MapObject.js';
import { Range } from '../../util/Range.js';
import { SkillTypes } from '../../game/SkillTypes.js';
import { SolidLayer } from '../../render/SolidLayer.js';
import { Trigger } from '../Trigger.js';
import { getAppContext } from '../../core/dependencies.js';
import {
  getRuntimeHistory,
  getRuntimeMiniMap,
  getRuntimePerformanceContext
} from '../../game/GameRuntime.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../../util/performanceInstrumentation.js';

const FIRE_INDICES = Object.freeze([3, 4, 5, 6, 10, 11, 12, 13, 14]);
const ICE_COLORS   = Object.freeze([
  ColorPalette.colorFromRGB(92, 224, 255),
  ColorPalette.colorFromRGB(96, 255, 255),
  ColorPalette.colorFromRGB(72, 192, 255),
  ColorPalette.colorFromRGB(64, 160, 255),
  ColorPalette.colorFromRGB(4, 48, 136),
  ColorPalette.colorFromRGB(0, 64, 152),
  ColorPalette.colorFromRGB(2, 32, 120),
  ColorPalette.colorFromRGB(0, 64, 152),
  ColorPalette.colorFromRGB(64, 160, 255)
]);
const SET_MAP_OBJECTS_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'Level',
    trackGroup: 'Game State',
    color: 'primary-light',
    tooltipText: 'setMapObjects'
  })
});
const SET_STEEL_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'Level',
    trackGroup: 'Game State',
    color: 'secondary-light',
    tooltipText: 'newSetSteelAreas'
  })
});
const getRuntimeApp = (runtime = null) => getRuntimePerformanceContext(runtime) || getAppContext();
const getMaskTransparentSpans = (mask) => {
  if (!mask) return null;
  if (typeof mask.getTransparentSpans === 'function') {
    return mask.getTransparentSpans();
  }
  const spans = mask.transparentSpans || null;
  if (spans?.rows && spans?.starts && spans?.lengths) return spans;
  return null;
};

export {
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
};
