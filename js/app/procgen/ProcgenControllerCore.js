import {
  HAZARD_TRIGGER_TYPES,
  Lemming,
  SkillTypes,
  SoundEventTypes,
  TriggerTypes
} from './ProcgenControllerShared.js';
import { procgenLifecycleMethods } from './ProcgenLifecycle.js';
import { procgenAiDirectorMethods } from './ProcgenAiDirector.js';
import { procgenTerrainDirectorMethods } from './ProcgenTerrainDirector.js';
import { procgenTerrainPlanningMethods } from './ProcgenTerrainPlanning.js';
class ProcgenController {
  constructor({ view, game, level, assets, stamper, options = {} }) {
    this.view = view || null;
    this.game = game || null;
    this.level = level || null;
    this.window = options.window || globalThis?.window;
    this.assets = assets || null;
    this.stamper = stamper || null;
    this._rng = typeof options.rng === 'function' ? options.rng : Math.random;
    this._rngSeed = Number.isFinite(options.rngSeed) ? (Math.trunc(options.rngSeed) >>> 0) : null;
    this._tickHandler = null;
    this._running = false;
    this._cameraX = 0;
    this._groundEndX = 0;
    this._groundTopY = 0;
    this._segmentColorIndex = 0;
    this._colorTransition = {
      from: 1,
      to: 1,
      remaining: 0,
      total: 0,
      current: 1,
      step: 0
    };
    this._sustainBaseY = 0;
    this._sustainRemaining = 0;
    this._builderCursorId = 0;
    this._seenFalls = new Map();
    this._soundHandler = null;
    this._builderBurst = null;
    this._cameraTargetX = null;
    this._lastSecond = null;
    this._bombCheckElapsed = 0;
    this._bombChance = 0.0001;
    this._nukeElapsed = 0;
    this._terrainPlan = { mode: 'flat', remaining: 0 };
    this._pendingDrop = false;
    this._gaps = [];
    this._gapScanStart = 0;
    this._gapCooldown = 0;
    this._structurePlan = null;
    this._aiLastDecisionTick = 0;
    this._aiDecisionInterval = 3;
    this._aiBudget = null;
    this._aiBudgetMax = null;
    this._aiBudgetRegen = null;
    this._aiLastDecision = null;
    this._aiDebug = null;
    this._aiLemmingCooldown = new Map();
    this._aiStallState = new Map();
    this._hazardTriggers = [];
    this._hazardTriggerSource = null;
    this._hazardTriggerSourceSize = -1;
    this._hazardIndexLastRefreshTick = -Infinity;
    this._scanCacheTick = -Infinity;
    this._scanCacheGround = null;
    this._scanCache = null;
    this._trackerPruneElapsed = 0;
    this._leftFallCounter = 0;
    this._splatStreak = 0;
    this._splatTarget = this._randInt(3, 10);
    this._pendingMidairBuilder = null;
    this._recentDecor = [];

    this.groundHeight = Number.isFinite(options.groundHeight) ? options.groundHeight : 4;
    this.groundColorIndex = Number.isFinite(options.groundColorIndex) ? options.groundColorIndex : 1;
    this.initialGroundWidth = Number.isFinite(options.initialGroundWidth) ? options.initialGroundWidth : 120;
    this.segmentMinWidth = Number.isFinite(options.segmentMinWidth) ? options.segmentMinWidth : 2;
    this.segmentMaxWidth = Number.isFinite(options.segmentMaxWidth) ? options.segmentMaxWidth : 6;
    this.extendThreshold = Number.isFinite(options.extendThreshold) ? options.extendThreshold : 4;
    this.lookAhead = Number.isFinite(options.lookAhead) ? options.lookAhead : 20;
    this.followLerp = Number.isFinite(options.followLerp) ? options.followLerp : 0.12;
    this.maxStepUp = Number.isFinite(options.maxStepUp) ? options.maxStepUp : 3;
    this.maxDrop = Number.isFinite(options.maxDrop) ? options.maxDrop : (Lemming.LEM_MAX_FALLING - 1);
    this.gapChance = Number.isFinite(options.gapChance) ? options.gapChance : 0.08;
    this.gapMinWidth = Number.isFinite(options.gapMinWidth) ? options.gapMinWidth : 3;
    this.gapMaxWidth = Number.isFinite(options.gapMaxWidth) ? options.gapMaxWidth : 9;
    this.gapTriggerDistance = Number.isFinite(options.gapTriggerDistance) ? options.gapTriggerDistance : 10;
    this.decorChance = Number.isFinite(options.decorChance) ? options.decorChance : 0.12;
    this.aiDecisionInterval = Number.isFinite(options.aiDecisionInterval) ? options.aiDecisionInterval : 3;
    this.aiScanAhead = Number.isFinite(options.aiScanAhead) ? options.aiScanAhead : 24;
    this.aiWallHeight = Number.isFinite(options.aiWallHeight) ? options.aiWallHeight : 10;
    this.aiHazardDistance = Number.isFinite(options.aiHazardDistance) ? options.aiHazardDistance : 18;
    this.aiFloaterDrop = Number.isFinite(options.aiFloaterDrop) ? options.aiFloaterDrop : (Lemming.LEM_MAX_FALLING - 2);
    this.aiDebugOverlay = options.aiDebugOverlay === true;
    this.aiActionCooldown = Number.isFinite(options.aiActionCooldown) ? options.aiActionCooldown : 5;
    this.aiHazardIndexRefreshTicks = Number.isFinite(options.aiHazardIndexRefreshTicks)
      ? Math.max(1, Math.floor(options.aiHazardIndexRefreshTicks))
      : 64;
    this.aiTrackerPruneIntervalSeconds = Number.isFinite(options.aiTrackerPruneIntervalSeconds)
      ? Math.max(1, Math.floor(options.aiTrackerPruneIntervalSeconds))
      : 10;
    this.fallEventMemoryTicks = Number.isFinite(options.fallEventMemoryTicks)
      ? Math.max(30, Math.floor(options.fallEventMemoryTicks))
      : 360;
    this.entranceX = Number.isFinite(options.entranceX) ? options.entranceX : null;
    this.entranceY = Number.isFinite(options.entranceY) ? options.entranceY : null;
    this.entranceClearance = Number.isFinite(options.entranceClearance) ? options.entranceClearance : 24;
  }
}
for (const methods of [
  procgenLifecycleMethods,
  procgenAiDirectorMethods,
  procgenTerrainDirectorMethods,
  procgenTerrainPlanningMethods
]) {
  Object.defineProperties(ProcgenController.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { ProcgenController };