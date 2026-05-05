import { Frame } from '../Frame.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { getAppContext } from '../../core/dependencies.js';
import {
  getRuntimeHistory,
  getRuntimePerformanceContext,
  isRuntimeReplayApplying
} from '../../game/GameRuntime.js';

const getApp = (runtime = null) => getRuntimePerformanceContext(runtime) || getAppContext();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export {
  Frame,
  TriggerTypes,
  clamp,
  getApp,
  getAppContext,
  getRuntimeHistory,
  getRuntimePerformanceContext,
  isRuntimeReplayApplying
};
