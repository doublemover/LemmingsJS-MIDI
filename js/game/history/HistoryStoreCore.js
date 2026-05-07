// @ts-check
import {
  DEFAULT_OPTIONS,
  normalizeOptions
} from './HistoryShared.js';
import {
  applyLemmingSnapshot,
  cloneLemmingState,
  createLemmingState,
  ensureLemmingCapacity,
  snapshotLemming
} from './HistoryLemmingState.js';
import { isNoOpDelta } from './HistoryDeltaCodec.js';
import { historyStoreStatsMethods } from './HistoryStoreStatsMethods.js';
import { historyStoreColdBlockStorageMethods } from './HistoryStoreColdBlockStorageMethods.js';
import { historyStoreColdBlockCodecMethods } from './HistoryStoreColdBlockCodecMethods.js';
import { historyStoreLifecycleMethods } from './HistoryStoreLifecycleMethods.js';
import { historyStoreRecordingMethods } from './HistoryStoreRecordingMethods.js';
import { historyStoreDiffMethods } from './HistoryStoreDiffMethods.js';
import { historyStoreApplyStateMethods } from './HistoryStoreApplyStateMethods.js';
import { historyStoreApplyDeltaMethods } from './HistoryStoreApplyDeltaMethods.js';

class HistoryStore {
  constructor(options = {}) {
    this.options = normalizeOptions({ ...DEFAULT_OPTIONS, ...options });
    this.keyframes = [];
    this.keyframeTicks = [];
    this.deltas = [];
    this.minDeltaTick = null;
    this.maxDeltaTick = null;
    this.minKeyframeTick = null;
    this.maxKeyframeTick = null;
    this.deltaCount = 0;
    this.keyframeCount = 0;
    this._deltaPool = [];
    this._deltaBlocks = new Map();
    this._coldBlockStore = new Map();
    this._coldBlockCount = 0;
    this._coldBlockBytes = 0;
    this._coldCompactionCursor = null;
    this._historyWarned = false;
    this._recording = false;
    this._currentTick = null;
    this._currentDelta = null;
    this._lemmingState = createLemmingState(0);
    this._lemmingManagerState = null;
    this._entranceOpened = new Uint8Array(0);
    this._skillsState = null;
    this._victoryState = null;
    this._timerState = null;
    this._gameState = null;
    this._nextTriggerId = 1;
    this._triggerIds = new Map();
    this._triggerById = new Map();
    this._nextObjectId = 1;
    this._objectIds = new Map();
    this._objectById = new Map();
    this.game = null;
    this.timer = null;
    this._beforeTick = null;
    this._afterTick = null;
    this._groundDirty = true;
    this._lastKeyframe = null;
    this._scratchTouchedBlocks = new Set();
    this._scratchStaticTriggers = new Set();
    this._scratchRemoveOwners = new Set();
  }
}

Object.assign(
  HistoryStore.prototype,
  historyStoreStatsMethods,
  historyStoreColdBlockStorageMethods,
  historyStoreColdBlockCodecMethods,
  historyStoreLifecycleMethods,
  historyStoreRecordingMethods,
  historyStoreDiffMethods,
  historyStoreApplyStateMethods,
  historyStoreApplyDeltaMethods
);

const __test__ = {
  createLemmingState,
  cloneLemmingState,
  ensureLemmingCapacity,
  snapshotLemming,
  applyLemmingSnapshot,
  isNoOpDelta
};

export { HistoryStore, __test__ };
