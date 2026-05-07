import { COUNTER_LIMIT } from '../../core/constants.js';
import { SoundEventTypes, SoundEffectIds } from '../../game/SoundEvents.js';
import { ActionBashSystem } from '../../actions/ActionBashSystem.js';
import { ActionBlockerSystem } from '../../actions/ActionBlockerSystem.js';
import { ActionBuildSystem } from '../../actions/ActionBuildSystem.js';
import { ActionClimbSystem } from '../../actions/ActionClimbSystem.js';
import { ActionCountdownSystem } from '../../actions/ActionCountdownSystem.js';
import { ActionDiggSystem } from '../../actions/ActionDiggSystem.js';
import { ActionDrowningSystem } from '../../actions/ActionDrowningSystem.js';
import { ActionExitingSystem } from '../../actions/ActionExitingSystem.js';
import { ActionExplodingSystem } from '../../actions/ActionExplodingSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { ActionFloatingSystem } from '../../actions/ActionFloatingSystem.js';
import { ActionFryingSystem } from '../../actions/ActionFryingSystem.js';
import { ActionHoistSystem } from '../../actions/ActionHoistSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { ActionMineSystem } from '../../actions/ActionMineSystem.js';
import { ActionOhNoSystem } from '../../actions/ActionOhNoSystem.js';
import { ActionShrugSystem } from '../../actions/ActionShrugSystem.js';
import { ActionSplatterSystem } from '../../actions/ActionSplatterSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { Lemming } from '../Lemming.js';
import { LemmingStateType } from '../LemmingStateType.js';
import { BaseLogger, LogHandler } from '../../util/LogHandler.js';
import { SkillTypes } from '../../game/SkillTypes.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { getAppContext, getDependency } from '../../core/dependencies.js';
import { getRuntimeSoundEvents } from '../../game/GameRuntime.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../../util/performanceInstrumentation.js';

const TICK_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'LemmingManager',
    trackGroup: 'Game State',
    color: 'tertiary-dark',
    tooltipText: 'tick'
  })
});
const RENDER_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'LemmingManager',
    trackGroup: 'Render',
    color: 'tertiary-dark',
    tooltipText: 'render'
  })
});
const getApp = () => getAppContext();
const isBenchMode = (app) => app?.bench || app?.bench2 || app?.benchReverse;

export {
  ActionBashSystem,
  ActionBlockerSystem,
  ActionBuildSystem,
  ActionClimbSystem,
  ActionCountdownSystem,
  ActionDiggSystem,
  ActionDrowningSystem,
  ActionExitingSystem,
  ActionExplodingSystem,
  ActionFallSystem,
  ActionFloatingSystem,
  ActionFryingSystem,
  ActionHoistSystem,
  ActionJumpSystem,
  ActionMineSystem,
  ActionOhNoSystem,
  ActionShrugSystem,
  ActionSplatterSystem,
  ActionWalkSystem,
  BaseLogger,
  COUNTER_LIMIT,
  Lemming,
  LemmingStateType,
  LogHandler,
  RENDER_MEASURE_DETAIL,
  SkillTypes,
  SoundEffectIds,
  SoundEventTypes,
  TICK_MEASURE_DETAIL,
  TriggerTypes,
  canMeasurePerformance,
  getApp,
  getAppContext,
  getDependency,
  getRuntimeSoundEvents,
  isBenchMode,
  recordPerformanceMeasure
};
