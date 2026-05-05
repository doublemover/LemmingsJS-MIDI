import {
  BaseLogger,
  DEFAULT_RUNTIME_PROFILE,
  DEFAULT_RUNTIME_ROLLOUT_FLAGS,
  EditorSession,
  FileContainer,
  GameFactory,
  GameStateTypes,
  GameTypes,
  KeyboardShortcuts,
  Lemming,
  LevelIndexResolve,
  LevelReader,
  MIDI_FLAG_REGISTRATION_KEY,
  MidiEventRouter,
  MidiMapping,
  PASSIVE_RESIZE_LISTENER,
  STARTUP_PROFILES,
  SoundEffectIds,
  SoundEventTypes,
  Stage,
  Trigger,
  TriggerTypes,
  clampMidiFlagId,
  clearAppContext,
  cloneConfig,
  createCrosshairFrame,
  createEditorLevelFromClassic,
  detectRuntimeCapabilities,
  getDependency,
  getGameStateTypes,
  getGameTypes,
  getLemmingCtor,
  getProfileHistoryRetention,
  getRuntimeDependency,
  getRuntimeProfileIds,
  getRuntimeProfilePreset,
  getSpecialHistoryRetention,
  getTriggerTypes,
  hashString,
  listSavedLevels,
  loadEditorLevel,
  loadSavedLevel,
  normalizeRuntimeProfile,
  parseBoundedNumber,
  parseInt10,
  resolveRuntimeRolloutFlags,
  setAppContext,
  toMidiFlagTriggerType
} from './GameViewShared.js';
import { gameViewRuntimeMethods } from './GameViewRuntime.js';
import { gameViewMidiMethods } from './GameViewMidi.js';
import { gameViewQueryMethods } from './GameViewQuery.js';
import { gameViewLevelSelectionMethods } from './GameViewLevelSelection.js';
import { gameViewDiagnosticsMethods } from './GameViewDiagnostics.js';
import { gameViewEditorModeMethods } from './GameViewEditorMode.js';
class GameView extends BaseLogger {
  constructor() {
    super();
    setAppContext(this);
    this.gameType = null;
    this.levelIndex = 0;
    this.levelGroupIndex = 0;
    this.gameResources = null;
    this.game = null;
    const Factory = getDependency('GameFactory', GameFactory);
    this.gameFactory = new Factory('./');
    this.stage = null;
    this.gameSpeedFactor = 1;
    this.bench = false; // just keep spawning lems
    this.bench2 = false;
    this.benchReverse = false;
    this.benchSequence = false;
    this._benchMeasureExtras = false;
    this.endless = false; // time doesn't run out, game doesn't end
    this.nukeAfter = 0; // nuke after x seconds
    this.scale = 0; // zoom
    this.laggedOut = 0;
    this.extraLemmings = 0;
    this.perfMetrics = false;
    this.performanceAPI = false;
    this.perfOverlay = false;
    this.offscreenPresentExperiment = false;
    this.workerOffscreenExperiment = false;
    this.startupProfile = DEFAULT_RUNTIME_PROFILE;
    this.rolloutFlags = { ...DEFAULT_RUNTIME_ROLLOUT_FLAGS };
    this.runtimeCapabilities = detectRuntimeCapabilities();
    this.steps = 0;
    this._benchMonitor = null;
    this._benchSpeedTrack = null;
    this._benchMaxSpeed = 0;
    this._benchCounts = [];
    this._benchIndex = 0;
    this._benchExtraList = null;
    this._benchExtraIndex = 0;
    this._benchStartTime = 0;
    this._benchBaseEntrances = null;
    this._benchEntrancePool = null;
    this._historyRetentionOverride = null;
    this._historyRetentionPolicy = null;
    this.preserveHistory = false;
    this.cheatEnabled = false;
    this.applyQuery();
    this.elementGameState = null;
    this.autoMoveTimer = null;
    this.resumeTimer = null;
    this.elementSelectGameType = null;
    this.elementSelectLevelGroup = null;
    this.elementSelectLevel = null;
    this.configs = null;
    const Shortcuts = getDependency('KeyboardShortcuts', KeyboardShortcuts);
    this.shortcuts = new Shortcuts(this);
    this.midiRouter = null;
    this._midiOut = null;
    this._midiMapping = null;
    this._midiBaseConfig = null;
    this._midiOverrides = {};
    this._midiSchemaHash = null;
    this._midiStatusHandlers = { onEnabled: null, onError: null };
    this.midiEnabled = false;
  
    this.includeSavedLevels = false;
    this.autoExitEditorOnSelect = false;
    this.editorMode = false;
    this.editorSession = null;
    this.editorPlaytest = false;
    this._editorWasRunning = false;
    this._editorInputWasEnabled = true;
    this._editorPanWasEnabled = true;
  
    const gameTypes = getGameTypes();
    this.log.log('selected level: ' + gameTypes.toString(this.gameType) + ' : ' + this.levelIndex + ' / ' + this.levelGroupIndex);
  }
}
for (const methods of [
  gameViewRuntimeMethods,
  gameViewMidiMethods,
  gameViewQueryMethods,
  gameViewLevelSelectionMethods,
  gameViewDiagnosticsMethods,
  gameViewEditorModeMethods
]) {
  Object.defineProperties(GameView.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { GameView };