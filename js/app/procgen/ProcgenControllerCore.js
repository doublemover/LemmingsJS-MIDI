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
    this._selectedTheme = options.selectedTheme || assets?.styleName || assets?.selectedTheme || null;
    this._themeContract = options.themeContract || null;
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
    this._recentAssists = [];
    this._recentChunks = [];
    this._recentCertificates = [];
    this._recentPieces = [];
    this._recentChunkSerial = 0;
    this._recentCertificateSerial = 0;
    this._recentPieceSerial = 0;
    this._lastNoopAssist = null;
    this._frontierState = null;
    this._frontierCacheTick = -Infinity;
    this._frontierLemmingState = new Map();
    this._lookaheadState = null;
    this._lookAheadDistance = 0;
    this._lookAheadThreshold = 0;

    this.groundHeight = Number.isFinite(options.groundHeight) ? options.groundHeight : 4;
    this.groundColorIndex = Number.isFinite(options.groundColorIndex) ? options.groundColorIndex : 1;
    this.initialGroundWidth = Number.isFinite(options.initialGroundWidth) ? options.initialGroundWidth : 120;
    this.segmentMinWidth = Number.isFinite(options.segmentMinWidth) ? options.segmentMinWidth : 24;
    this.segmentMaxWidth = Number.isFinite(options.segmentMaxWidth) ? options.segmentMaxWidth : 72;
    this.extendThreshold = Number.isFinite(options.extendThreshold) ? options.extendThreshold : 16;
    const explicitLookAhead = Number.isFinite(options.lookAhead)
      ? Math.max(24, Math.floor(options.lookAhead))
      : null;
    this.lookAheadMin = Number.isFinite(options.lookAheadMin)
      ? Math.max(24, Math.floor(options.lookAheadMin))
      : (explicitLookAhead ?? 140);
    this.lookAheadMax = Number.isFinite(options.lookAheadMax)
      ? Math.max(this.lookAheadMin, Math.floor(options.lookAheadMax))
      : Math.max(this.lookAheadMin, explicitLookAhead ?? 220);
    this.lookAhead = this.lookAheadMax;
    this.lookAheadSpeedTicks = Number.isFinite(options.lookAheadSpeedTicks)
      ? Math.max(0, Math.floor(options.lookAheadSpeedTicks))
      : 48;
    this.recentChunkLimit = Number.isFinite(options.recentChunkLimit)
      ? Math.max(1, Math.floor(options.recentChunkLimit))
      : 32;
    this.recentCertificateLimit = Number.isFinite(options.recentCertificateLimit)
      ? Math.max(1, Math.floor(options.recentCertificateLimit))
      : 32;
    this.recentPieceLimit = Number.isFinite(options.recentPieceLimit)
      ? Math.max(1, Math.floor(options.recentPieceLimit))
      : 96;
    this.procgenCertificateVerification = options.procgenCertificateVerification !== false;
    this.procgenCertificateVerifier = typeof options.procgenCertificateVerifier === 'function'
      ? options.procgenCertificateVerifier
      : null;
    this.procgenCertificateOptions = options.procgenCertificateOptions &&
      typeof options.procgenCertificateOptions === 'object' &&
      !Array.isArray(options.procgenCertificateOptions)
      ? options.procgenCertificateOptions
      : {};
    this.generatedTrackingPruneDistance = Number.isFinite(options.generatedTrackingPruneDistance)
      ? Math.max(0, Math.floor(options.generatedTrackingPruneDistance))
      : 512;
    this.followLerp = Number.isFinite(options.followLerp) ? options.followLerp : 0.12;
    this.maxStepUp = Number.isFinite(options.maxStepUp) ? options.maxStepUp : 3;
    this.maxDrop = Number.isFinite(options.maxDrop) ? options.maxDrop : (Lemming.LEM_MAX_FALLING - 1);
    this.gapChance = Number.isFinite(options.gapChance) ? options.gapChance : 0.08;
    this.gapMinWidth = Number.isFinite(options.gapMinWidth) ? options.gapMinWidth : 3;
    this.gapMaxWidth = Number.isFinite(options.gapMaxWidth) ? options.gapMaxWidth : 9;
    this.gapTriggerDistance = Number.isFinite(options.gapTriggerDistance) ? options.gapTriggerDistance : 10;
    this.decorChance = Number.isFinite(options.decorChance) ? options.decorChance : 0.06;
    this.aiDecisionInterval = Number.isFinite(options.aiDecisionInterval) ? options.aiDecisionInterval : 3;
    this.aiScanAhead = Number.isFinite(options.aiScanAhead) ? options.aiScanAhead : 24;
    this.aiWallHeight = Number.isFinite(options.aiWallHeight) ? options.aiWallHeight : 10;
    this.aiHazardDistance = Number.isFinite(options.aiHazardDistance) ? options.aiHazardDistance : 18;
    this.aiFloaterDrop = Number.isFinite(options.aiFloaterDrop) ? options.aiFloaterDrop : (Lemming.LEM_MAX_FALLING - 2);
    this.aiDebugOverlay = options.aiDebugOverlay === true;
    this.aiActionCooldown = Number.isFinite(options.aiActionCooldown) ? options.aiActionCooldown : 5;
    this.aiNoopDebugIntervalTicks = Number.isFinite(options.aiNoopDebugIntervalTicks)
      ? Math.max(1, Math.floor(options.aiNoopDebugIntervalTicks))
      : 30;
    this.aiHazardIndexRefreshTicks = Number.isFinite(options.aiHazardIndexRefreshTicks)
      ? Math.max(1, Math.floor(options.aiHazardIndexRefreshTicks))
      : 64;
    this.aiTrackerPruneIntervalSeconds = Number.isFinite(options.aiTrackerPruneIntervalSeconds)
      ? Math.max(1, Math.floor(options.aiTrackerPruneIntervalSeconds))
      : 10;
    this.fallEventMemoryTicks = Number.isFinite(options.fallEventMemoryTicks)
      ? Math.max(30, Math.floor(options.fallEventMemoryTicks))
      : 360;
    this.frontierStuckTicks = Number.isFinite(options.frontierStuckTicks)
      ? Math.max(1, Math.floor(options.frontierStuckTicks))
      : 90;
    this.frontierTurnaroundLimit = Number.isFinite(options.frontierTurnaroundLimit)
      ? Math.max(1, Math.floor(options.frontierTurnaroundLimit))
      : 6;
    this.frontierTurnaroundPenalty = Number.isFinite(options.frontierTurnaroundPenalty)
      ? Math.max(0, Math.floor(options.frontierTurnaroundPenalty))
      : 12;
    this.frontierMaxTrackedLemmings = Number.isFinite(options.frontierMaxTrackedLemmings)
      ? Math.max(1, Math.floor(options.frontierMaxTrackedLemmings))
      : 128;
    this.gapTrackingLimit = Number.isFinite(options.gapTrackingLimit)
      ? Math.max(1, Math.floor(options.gapTrackingLimit))
      : 256;
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
