import { createCrosshairFrame } from '../input/CrosshairCursor.js';
import { GameFactory } from './GameFactory.js';
import { GameStateTypes } from './GameStateTypes.js';
import { GameTypes } from './GameTypes.js';
import { KeyboardShortcuts } from '../input/KeyboardShortcuts.js';
import { Lemming } from '../lemmings/Lemming.js';
import { BaseLogger } from '../util/LogHandler.js';
import { MidiEventRouter } from '../midi/MidiEventRouter.js';
import { MidiMapping } from '../midi/MidiMapping.js';
import { Stage } from '../render/Stage.js';
import { Trigger } from '../level/Trigger.js';
import { TriggerTypes } from '../level/TriggerTypes.js';
import { SoundEffectIds, SoundEventTypes } from './SoundEvents.js';
import { FileContainer } from '../data/FileContainer.js';
import { LevelIndexResolve } from '../level/LevelIndexResolve.js';
import { LevelReader } from '../level/LevelReader.js';
import { EditorSession } from '../editor/EditorSession.js';
import { createEditorLevelFromClassic } from '../editor/ClassicLevelConverter.js';
import { loadEditorLevel } from '../editor/EditorLevelLoader.js';
import { listSavedLevels, loadSavedLevel } from '../editor/EditorStorage.js';
import {
  getDependency,
  setAppContext,
  clearAppContext,
  getRuntimeDependency
} from '../core/dependencies.js';
import { clampMidiFlagId, toMidiFlagTriggerType } from '../midi/MidiFlagTriggers.js';
import { parseBoundedNumber, parseInt10 } from '../core/numberParsing.js';
import {
  DEFAULT_RUNTIME_PROFILE,
  getProfileHistoryRetention,
  getRuntimeProfileIds,
  getRuntimeProfilePreset,
  getSpecialHistoryRetention,
  normalizeRuntimeProfile
} from '../core/runtimeProfiles.js';
import { detectRuntimeCapabilities } from '../core/capabilityMatrix.js';
import {
  DEFAULT_RUNTIME_ROLLOUT_FLAGS,
  resolveRuntimeRolloutFlags
} from '../core/rolloutFlags.js';

const getGameTypes = () => getDependency('GameTypes', GameTypes);
const getGameStateTypes = () => getDependency('GameStateTypes', GameStateTypes);
const getTriggerTypes = () => getDependency('TriggerTypes', TriggerTypes);
const getLemmingCtor = () => getDependency('Lemming', Lemming);
const STARTUP_PROFILES = new Set(getRuntimeProfileIds());
const MIDI_FLAG_REGISTRATION_KEY = Symbol('midi-flag-registration');
const PASSIVE_RESIZE_LISTENER = Object.freeze({ passive: true });

const cloneConfig = (config) => JSON.parse(JSON.stringify(config || {}));

const hashString = (input) => {
  let hash = 2166136261;
  const str = String(input ?? '');
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

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

  set gameCanvas(el) {
    if (this.stage && this.stage.dispose) {
      window.removeEventListener('resize', this._stageResize, PASSIVE_RESIZE_LISTENER);
      window.removeEventListener('orientationchange', this._stageResize, PASSIVE_RESIZE_LISTENER);
      this.stage.dispose();
    }
    const StageCtor = getDependency('Stage', Stage);
    this.stage = new StageCtor(el);
    this.stage.setPerfOverlay?.(this.perfOverlay, () => this.getPerfOverlayData());
    this.stage.setRenderExperimentFlags?.({
      offscreenPresent: this.offscreenPresentExperiment,
      workerOffscreen: this.workerOffscreenExperiment
    });
    this._stageResize = () => this.stage.scheduleUpdateStageSize();
    window.addEventListener('resize', this._stageResize, PASSIVE_RESIZE_LISTENER);
    window.addEventListener('orientationchange', this._stageResize, PASSIVE_RESIZE_LISTENER);
    this._stageResize();
  }

  /** start or continue the game */
  async start(replayString) {
    if (!this.gameFactory) return;
    if (this.game != null) {
      this.continue();
      return;
    }
    try {
      const game = await this.gameFactory.getGame(this.gameType, this.gameResources);
      await game.loadLevel(this.levelGroupIndex, this.levelIndex);
      if (replayString != null) {
        game.getCommandManager().loadReplay(replayString);
      }
      game.setGameDisplay(this.stage.getGameDisplay());
      game.setGuiDisplay(this.stage.getGuiDisplay());
      if (this.stage && game.level) {
        this.applyLevelViewport(game.level);
      }
      game.getGameTimer().speedFactor = this.gameSpeedFactor;
      this._applyHistoryRetentionPolicy(game, replayString);
      if (this.preserveHistory || replayString != null) {
        game.history?.setPreserveFutureHistory?.(true);
      }
      this._registerMidiFlagTriggers(game);
      // Display a custom crosshair cursor sized relative to a lemming
      this.stage.setCursorSprite(createCrosshairFrame(24));
      if (this.midiEnabled) {
        await this.initMidiRouting();
        this.midiRouter?.attach(game.soundEvents, { game, stage: this.stage });
      }
      game.start();
      const gameStateTypes = getGameStateTypes();
      this.changeHtmlText(this.elementGameState, gameStateTypes.toString(gameStateTypes.RUNNING));
      game.onGameEnd.on(state => this.onGameEnd(state));
      this.game = game;
      if (this.cheatEnabled) this.game.cheat();
      if (this.debug) this.game.showDebug = true;
    } catch (e) {
      this.log.log('Error starting game:', e);
    }
  }

  onGameEnd(gameResult) {
    const gameStateTypes = getGameStateTypes();
    this.changeHtmlText(this.elementGameState, gameStateTypes.toString(gameResult.state));
    this.stage.startFadeOut();
    console.dir(gameResult);
    const appWindow = globalThis.window;
    const setTimeoutFn = appWindow?.setTimeout || globalThis.setTimeout;
    if (typeof setTimeoutFn !== 'function') {
      return;
    }
    this.autoMoveTimer = setTimeoutFn(() => {
      const gameStateTypes = getGameStateTypes();
      if (gameResult.state === gameStateTypes.SUCCEEDED) {
        /// move to next level
        this.moveToLevel(1);
      } else {
        /// redo this level
        this.moveToLevel(0);
      }
      this.autoMoveTimer = null;
    }, 2500);
  }

  async loadReplay(replayString) {
    await this.start(replayString);
  }

  cheat() {
    if (this.game == null) {
      return;
    }
    this.game.cheat();
  }

  suspend() {
    if (this.game == null) {
      return;
    }
    this.game.getGameTimer().suspend();
  }

  suspendWithColor(color) {
    if (this.game == null) {
      return;
    }
    const appWindow = globalThis.window;
    const clearTimeoutFn = appWindow?.clearTimeout || globalThis.clearTimeout;
    const setTimeoutFn = appWindow?.setTimeout || globalThis.setTimeout;
    this.game.getGameTimer().suspend();
    if (this.stage?.startOverlayFade) {
      let rect = null;
      if (this.bench || this.bench2 || this.benchReverse) {
        const gui = this.stage.guiImgProps;
        const scale = gui.viewPoint.scale;
        rect = {
          x: gui.x + 160 * scale,
          y: gui.y + 32 * scale,
          width: 16 * scale,
          height: 10 * scale
        };
      }
      this.stage.startOverlayFade(color, rect);
    }
    if (this.resumeTimer) {
      if (typeof clearTimeoutFn === 'function') {
        clearTimeoutFn(this.resumeTimer);
      }
      this.resumeTimer = null;
    }
    if (typeof setTimeoutFn !== 'function') {
      return;
    }
    this.resumeTimer = setTimeoutFn(() => {
      if (this.game) this.game.getGameTimer().continue();
      this.resumeTimer = null;
    }, 2000);
  }

  continue () {
    if (this.game == null) {
      return;
    }
    this.game.getGameTimer().continue();
  }

  nextFrame() {
    if (this.game == null) {
      return;
    }
    const timer = this.game.getGameTimer();
    if (!timer) return;
    if (this.game.timeTravel?.isReversing) {
      this.game.timeTravel.stopReverse();
    }
    this.game.history?.truncateAfter?.(timer.tickIndex);
    timer.tick(1);
    if (this.game.gameGui) {
      this.game.gameGui.gameTimeChanged = true;
    }
    this.game.render();
  }

  prevFrame() {
    if (this.game == null) {
      return;
    }
    const timeTravel = this.game.timeTravel;
    if (timeTravel?.stepBackward) {
      timeTravel.stepBackward(1);
      return;
    }
    this.game.getGameTimer().tick(-1);
    this.game.render();
  }

  selectSpeedFactor(newSpeed) {
    if (this.game == null) {
      return;
    }
    this.gameSpeedFactor = newSpeed;
    this.game.getGameTimer().speedFactor = newSpeed;
  }

  playMusic(moveInterval) {

  }

  stopMusic() {

  }

  stopSound() {

  }

  playSound(moveInterval) {

  }

  get midiOut() { return this._midiOut; }
  set midiOut(output) {
    this._midiOut = output;
    this.midiRouter?.setOutput?.(output);
  }

  setMidiStatusHandlers({ onEnabled = null, onError = null } = {}) {
    this._midiStatusHandlers = {
      onEnabled: typeof onEnabled === 'function' ? onEnabled : null,
      onError: typeof onError === 'function' ? onError : null
    };
  }

  _getWebMidi() {
    return getRuntimeDependency('webMidi', null);
  }

  _formatMidiEnableError(err) {
    const rawMessage = err?.message ? String(err.message) : String(err || '');
    const runtimeWindow = getRuntimeDependency('window', null);
    const isSecure = runtimeWindow
      ? (runtimeWindow.isSecureContext || runtimeWindow.location?.protocol === 'https:' || runtimeWindow.location?.hostname === 'localhost')
      : true;
    if (!isSecure) {
      return 'WebMIDI requires HTTPS or localhost.';
    }
    if (err?.name === 'NotAllowedError' || /permission/i.test(rawMessage)) {
      return 'WebMIDI permission denied. Check browser permissions.';
    }
    if (err?.name === 'SecurityError' || /secure context/i.test(rawMessage)) {
      return 'WebMIDI requires HTTPS or localhost.';
    }
    if (err?.name === 'NotSupportedError') {
      return 'WebMIDI is not supported in this browser.';
    }
    if (!rawMessage) {
      return 'WebMIDI enable failed.';
    }
    return `WebMIDI enable failed: ${rawMessage}`;
  }

  async _ensureWebMidiEnabled() {
    const webMidi = this._getWebMidi();
    if (!webMidi) {
      this._midiStatusHandlers?.onError?.('WebMIDI is not supported in this browser.');
      return null;
    }
    if (webMidi.enabled) return webMidi;
    try {
      await webMidi.enable();
      this._midiStatusHandlers?.onEnabled?.();
      return webMidi;
    } catch (e) {
      this.log.log('WebMidi enable failed', e);
      this._midiStatusHandlers?.onError?.(this._formatMidiEnableError(e));
      return null;
    }
  }

  async _loadMidiMapping() {
    if (!this.gameFactory?.fileProvider) return new MidiMapping();
    try {
      const text = await this.gameFactory.fileProvider.loadString('midi-mapping.json');
      const mapping = MidiMapping.fromJson(text);
      this._midiSchemaHash = hashString(text);
      this._midiBaseConfig = cloneConfig(mapping.config);
      return mapping;
    } catch (e) {
      this.log.log('Unable to load midi-mapping.json, using defaults', e);
      const mapping = new MidiMapping();
      this._midiSchemaHash = hashString(JSON.stringify(mapping.config));
      this._midiBaseConfig = cloneConfig(mapping.config);
      return mapping;
    }
  }

  async initMidiRouting() {
    if (!this.midiEnabled) {
      this.midiRouter?.detach?.();
      this.midiRouter?.scheduler?.allNotesOff?.();
      return null;
    }
    if (!this.midiRouter) {
      await this._ensureWebMidiEnabled();
      this._midiMapping = this._midiMapping || await this._loadMidiMapping();
      this.applyMidiOverrides(this._midiOverrides);
      const Router = getDependency('MidiEventRouter', MidiEventRouter);
      this.midiRouter = new Router(this._midiMapping);
    }
    if (!this._midiOut) {
      const webMidi = this._getWebMidi();
      if (webMidi?.enabled && webMidi.outputs?.length) {
        this._midiOut = webMidi.outputs[0];
      }
    }
    if (this._midiOut) this.midiRouter.setOutput(this._midiOut);
    return this.midiRouter;
  }

  async setMidiEnabled(enabled) {
    this.midiEnabled = !!enabled;
    if (!this.midiEnabled) {
      this.midiRouter?.detach?.();
      this.midiRouter?.scheduler?.allNotesOff?.();
      return;
    }
    await this.initMidiRouting();
    if (this.game?.soundEvents) {
      this.midiRouter?.attach(this.game.soundEvents, { game: this.game, stage: this.stage });
    }
  }

  applyMidiOverrides(overrides) {
    if (!this._midiBaseConfig) return;
    const merged = typeof MidiMapping?.mergeConfigs === 'function'
      ? MidiMapping.mergeConfigs(this._midiBaseConfig, overrides || {})
      : { ...this._midiBaseConfig, ...(overrides || {}) };
    this._midiMapping = new MidiMapping(merged);
    if (this.midiRouter) this.midiRouter.setMapping(this._midiMapping);
  }

  setMidiOverrides(overrides) {
    this._midiOverrides = cloneConfig(overrides || {});
    this.applyMidiOverrides(this._midiOverrides);
  }

  getMidiConfig() {
    return this._midiMapping?.config ?? null;
  }

  getMidiBaseConfig() {
    return this._midiBaseConfig;
  }

  getMidiSchemaHash() {
    return this._midiSchemaHash;
  }

  enableDebug() {
    if (this.game == null) {
      return;
    }
    this.game.setDebugMode(true);
  }

  /** add/subtract one to the current levelIndex */
  async moveToLevel(moveInterval = 0) {
    if (this.inMoveToLevel) return;
    this.inMoveToLevel = true;
    const oldGameType = this.gameType;
    try {
      const gameTypes = getGameTypes();
      let gameType = this.gameType;
      let levelGroupIndex = this.levelGroupIndex;
      let levelIndex = (this.levelIndex + moveInterval) | 0;
      let config = await this.gameFactory.getConfig(gameType);

      const savedEntries = this._getSavedLevelEntries();
      const getBaseGroupCount = cfg => cfg?.level?.order?.length ?? 0;
      const getGroupLength = (cfg, groupIndex) => {
        const baseGroupCount = getBaseGroupCount(cfg);
        return this._getGroupLength(cfg, groupIndex, baseGroupCount, savedEntries);
      };
      const getGroupCount = (cfg) => {
        const baseGroupCount = getBaseGroupCount(cfg);
        return this._getGroupCount(baseGroupCount, savedEntries);
      };
      const isValidGameType = (type) =>
        type > 0 && type < gameTypes.length;

      if (moveInterval < 0) {
        let rewindAttempts = 0;
        const rewindLimit = Math.max(1, gameTypes.length * 4);
        while (levelIndex < 0) {
          rewindAttempts += 1;
          if (rewindAttempts > rewindLimit) {
            levelIndex = 0;
            break;
          }
          if (levelGroupIndex > 0) {
            levelGroupIndex--;
            levelIndex += getGroupLength(config, levelGroupIndex);
            continue;
          }
          if (gameType > 1) {
            gameType--;
            config = await this.gameFactory.getConfig(gameType);
            levelGroupIndex = Math.max(0, getGroupCount(config) - 1);
            levelIndex += getGroupLength(config, levelGroupIndex);
            continue;
          }
          const lastType = gameTypes.length - 1;
          if (isValidGameType(lastType) && lastType !== gameType) {
            gameType = lastType;
            config = await this.gameFactory.getConfig(gameType);
            levelGroupIndex = Math.max(0, getGroupCount(config) - 1);
            levelIndex += getGroupLength(config, levelGroupIndex);
            continue;
          }
          levelIndex = 0;
          break;
        }
      } else if (moveInterval > 0) {
        while (true) {
          const groupLength = getGroupLength(config, levelGroupIndex);
          if (groupLength <= 0) {
            if (levelGroupIndex + 1 < getGroupCount(config)) {
              levelGroupIndex++;
              continue;
            }
            gameType++;
            if (!isValidGameType(gameType)) {
              gameType = 1;
            }
            config = await this.gameFactory.getConfig(gameType);
            levelGroupIndex = 0;
            continue;
          }
          if (levelIndex < groupLength) break;
          levelIndex -= groupLength;
          if (levelGroupIndex + 1 < getGroupCount(config)) {
            levelGroupIndex++;
            continue;
          }
          gameType++;
          if (!isValidGameType(gameType)) {
            gameType = 1;
          }
          config = await this.gameFactory.getConfig(gameType);
          levelGroupIndex = 0;
        }
      }

      if (!isValidGameType(gameType)) {
        gameType = 1;
        levelGroupIndex = 0;
        levelIndex = 0;
      }

      this.gameType = gameType;
      this.levelGroupIndex = levelGroupIndex;
      this.levelIndex = levelIndex;

      if (oldGameType !== this.gameType) {
        this.gameResources = await this.gameFactory.getGameResources(this.gameType);
      }
      if (this.autoExitEditorOnSelect && this.editorMode) {
        this.exitEditorMode();
      }
      if (this.editorMode) {
        await this.loadEditorLevelFromSelection();
      } else {
        await this.loadLevel();
      }
    } finally {
      this.inMoveToLevel = false;
    }
  }
  /** helper to parse a numeric query value */
  parseNumber(query, names, def, min, max, multiplier = 1) {
    for (const name of names) {
      const raw = query.get(name);
      if (raw !== null) {
        const parsed = parseBoundedNumber(raw, {
          fallback: null,
          min,
          max,
          multiplier
        });
        if (parsed != null) return parsed;
      }
    }
    return def;
  }

  /** helper to parse a boolean query value */
  parseBool(query, names, def = false) {
    for (const name of names) {
      if (query.has(name)) {
        return query.get(name) === 'true';
      }
    }
    return def;
  }

  parseProfileBool(query, names, fallback = false) {
    for (const name of names) {
      if (query.has(name)) {
        return this.parseBool(query, names, fallback);
      }
    }
    return fallback;
  }

  /** convert a string to a number or return 0 if NaN */
  /** read parameters from the current URL */
  applyQuery() {
    this.gameType = 1;
    const windowRef = getRuntimeDependency('window', null);
    const query = windowRef?.location?.search
      ? new URLSearchParams(windowRef.location.search)
      : new URLSearchParams('');
    this.rolloutFlags = resolveRuntimeRolloutFlags({
      query,
      runtimeFlags: getRuntimeDependency('rolloutFlags', null)
    });
    this.runtimeCapabilities = detectRuntimeCapabilities({
      windowRef,
      navigatorRef: getRuntimeDependency('navigator', windowRef?.navigator || null),
      webMidi: getRuntimeDependency('webMidi', windowRef?.WebMidi || null)
    });
    this.gameType = this.parseNumber(query, ['version', 'v'], 1, 1, 6);
    this.levelGroupIndex = this.parseNumber(query, ['difficulty', 'd'], 1, 1, 6) - 1;
    this.levelIndex = this.parseNumber(query, ['level', 'l'], 1, 1, 100) - 1;
    this.gameSpeedFactor = this.parseNumber(query, ['speed', 's'], 1, 0, 100);
    // values above normal correspond to discrete steps
    if (this.gameSpeedFactor > 1) {
      this.gameSpeedFactor = Math.round(this.gameSpeedFactor);
    }
    this.cheatEnabled = this.parseBool(query, ['cheat', 'c']);
    this.debug = this.parseBool(query, ['debug', 'dbg']);
    this.bench = this.parseBool(query, ['bench', 'b']);
    this.bench2 = this.parseBool(query, ['bench2', 'b2']);
    this.benchReverse = this.parseBool(query, ['benchReverse', 'bR']);
    this.benchSequence = this.parseBool(query, ['benchSequence', 'bs']);        
    this.preserveHistory = this.parseBool(query, ['preserveHistory', 'ph']);
    if (this.bench || this.bench2 || this.benchSequence) {
      this.benchReverse = false;
    }
    this.endless = this.parseBool(query, ['endless', 'e']);
    this.nukeAfter = this.parseNumber(query, ['nukeAfter', 'na'], 0, 1, 60, 10);
    this.extraLemmings = this.parseNumber(query, ['extra', 'ex'], 0, 1, 1000);
    this.scale = this.parseNumber(query, ['scale', 'sc'], 0, 0.0125, 8);
    this.laggedOut = 0;

    this.shortcut = false;
    if (query.get('shortcut') || query.get('_')) {
      this.shortcut = (query.get('shortcut') || query.get('_')) === 'true';
    }
    const profileRaw = query.get('profile') || query.get('pr') || DEFAULT_RUNTIME_PROFILE;
    this.startupProfile = normalizeRuntimeProfile(profileRaw);
    if (!STARTUP_PROFILES.has(this.startupProfile)) {
      this.startupProfile = DEFAULT_RUNTIME_PROFILE;
    }
    const profilePreset = getRuntimeProfilePreset(this.startupProfile);
    const instrumentation = profilePreset.instrumentation || {};
    const rendering = profilePreset.rendering || {};
    this.performanceAPI = this.parseProfileBool(
      query,
      ['performanceAPI', 'pa'],
      instrumentation.performanceAPI === true
    );
    this.perfMetrics = this.parseProfileBool(
      query,
      ['perfMetrics', 'pm'],
      instrumentation.perfMetrics === true || this.performanceAPI
    );
    this.perfOverlay = this.parseProfileBool(
      query,
      ['perfOverlay', 'po'],
      instrumentation.perfOverlay === true
    );
    const renderRolloutEnabled = this.rolloutFlags?.renderPresentPath !== false;
    this.offscreenPresentExperiment = renderRolloutEnabled && this.parseProfileBool(
      query,
      ['offscreenPresent', 'osp'],
      rendering.offscreenPresentExperiment === true
    );
    this.workerOffscreenExperiment = renderRolloutEnabled && this.parseProfileBool(
      query,
      ['workerOffscreen', 'osw'],
      rendering.workerOffscreenExperiment === true
    );
    this.stage?.setRenderExperimentFlags?.({
      offscreenPresent: this.offscreenPresentExperiment,
      workerOffscreen: this.workerOffscreenExperiment
    });
  }
  updateQuery() {
    const windowRef = getRuntimeDependency('window', null);
    const params = windowRef?.location?.search
      ? new URLSearchParams(windowRef.location.search)
      : new URLSearchParams('');
    const setParam = (longName, shortName, value, def, always) => {
      params.delete(longName);
      params.delete(shortName);
      if (always || (value !== undefined && value !== def)) {
        params.set(this.shortcut ? shortName : longName, value);
      }
    };

    // main game state should always remain visible
    setParam('version', 'v', this.gameType, undefined, true);
    setParam('difficulty', 'd', this.levelGroupIndex + 1, undefined, true);
    setParam('level', 'l', this.levelIndex + 1, undefined, true);
    setParam('speed', 's', this.gameSpeedFactor, undefined, true);
    setParam('cheat', 'c', this.cheatEnabled, undefined, true);

    // optional flags only appear when non-default
    setParam('debug', 'dbg', this.debug, false);
    setParam('bench', 'b', this.bench, false);
    setParam('bench2', 'b2', this.bench2, false);
    setParam('benchReverse', 'bR', this.benchReverse, false);
    setParam('benchSequence', 'bs', this.benchSequence, false);
    setParam('preserveHistory', 'ph', this.preserveHistory, false);
    setParam('endless', 'e', this.endless, false);
    setParam('nukeAfter', 'na', this.nukeAfter ? this.nukeAfter / 10 : undefined);
    setParam('extra', 'ex', this.extraLemmings, 0);
    setParam('scale', 'sc', this.scale, 0);
    setParam('performanceAPI', 'pa', this.performanceAPI, false);
    setParam('perfMetrics', 'pm', this.perfMetrics, this.performanceAPI);
    setParam('perfOverlay', 'po', this.perfOverlay, false);
    setParam('offscreenPresent', 'osp', this.offscreenPresentExperiment, false);
    setParam('workerOffscreen', 'osw', this.workerOffscreenExperiment, false);
    setParam('profile', 'pr', this.startupProfile, DEFAULT_RUNTIME_PROFILE);

    if (this.shortcut) {
      params.set('_', true);
    } else {
      params.delete('_');
    }

    this.setHistoryState(params);
  }

  getPerfOverlayData() {
    const timer = this.game?.getGameTimer?.() || null;
    const lines = [];
    if (timer) {
      lines.push(`tick ${timer.tickIndex ?? 0} speed ${Number(timer.speedFactor || 0).toFixed(2)}`);
      lines.push(`tps ${Number(timer.tps || 0).toFixed(1)} frame ${Number(timer.frameTime || 0).toFixed(2)}ms`);
    }
    if (this.bench || this.bench2 || this.benchReverse || this.benchSequence) {
      lines.push(`bench steps ${this.steps | 0} lag ${this.laggedOut | 0}`);
    }
    if (this.game?.timeTravel?.isReversing) {
      lines.push('reverse playback active');
    }
    return { lines };
  }

  resolveHistoryRetentionPolicy() {
    if (this._historyRetentionOverride) {
      return { ...this._historyRetentionOverride };
    }
    let profilePolicy = getProfileHistoryRetention(this.startupProfile);
    if (this.endless) {
      profilePolicy = getSpecialHistoryRetention('endless') || profilePolicy;
    }
    if (this.bench || this.bench2 || this.benchReverse || this.benchSequence) {
      profilePolicy = getSpecialHistoryRetention('bench') || profilePolicy;
    }
    if (this.rolloutFlags?.historyCodec === false) {
      profilePolicy = {
        ...profilePolicy,
        coldBlockAgeTicks: 0,
        enableColdBlockCompression: false,
        enableColdBlockDedupe: false
      };
    }
    return { ...profilePolicy };
  }

  setHistoryRetentionPolicy(policy) {
    if (!policy || typeof policy !== 'object') {
      this._historyRetentionOverride = null;
      return null;
    }
    this._historyRetentionOverride = { ...policy };
    return { ...this._historyRetentionOverride };
  }

  applyProfileHistoryRetentionPolicy() {
    const policy = this.resolveHistoryRetentionPolicy();
    this._historyRetentionPolicy = { ...policy };
    return { ...policy };
  }

  _applyHistoryRetentionPolicy(game, replayString = null) {
    const basePolicy = this.resolveHistoryRetentionPolicy();
    const preserveFutureHistory = !!(this.preserveHistory || replayString != null);
    const requested = {
      ...basePolicy,
      preserveFutureHistory
    };
    let applied = requested;
    if (game?.timeTravel?.setHistoryRetention) {
      applied = game.timeTravel.setHistoryRetention(requested) || requested;
    } else if (game?.history?.configureRetention) {
      applied = game.history.configureRetention(requested) || requested;
    }
    this._historyRetentionPolicy = { ...applied };
    return { ...this._historyRetentionPolicy };
  }

  getRuntimeDiagnostics() {
    const windowRef = getRuntimeDependency('window', null);
    const capabilities = detectRuntimeCapabilities({
      windowRef,
      navigatorRef: getRuntimeDependency('navigator', windowRef?.navigator || null),
      webMidi: getRuntimeDependency('webMidi', windowRef?.WebMidi || null)
    });
    this.runtimeCapabilities = capabilities;
    const fileProviderStats = this.gameFactory?.fileProvider?.getCacheStats?.() || null;
    const sanitizedFileProviderStats = fileProviderStats
      ? {
        memoryEntries: fileProviderStats.memoryEntries ?? 0,
        localStorageBytes: fileProviderStats.localStorageBytes ?? 0,
        indexedDbBytes: fileProviderStats.indexedDbBytes ?? 0
      }
      : null;
    return {
      profile: this.startupProfile || DEFAULT_RUNTIME_PROFILE,
      rolloutFlags: {
        ...DEFAULT_RUNTIME_ROLLOUT_FLAGS,
        ...(this.rolloutFlags || {})
      },
      capabilities,
      history: {
        retention: this._historyRetentionPolicy
          ? { ...this._historyRetentionPolicy }
          : this.resolveHistoryRetentionPolicy()
      },
      featureFlags: {
        performanceAPI: !!this.performanceAPI,
        perfMetrics: !!this.perfMetrics,
        perfOverlay: !!this.perfOverlay,
        offscreenPresentExperiment: !!this.offscreenPresentExperiment,
        workerOffscreenExperiment: !!this.workerOffscreenExperiment,
        debug: !!this.debug,
        cheatEnabled: !!this.cheatEnabled,
        endless: !!this.endless,
        midiEnabled: !!this.midiEnabled,
        editorMode: !!this.editorMode,
        editorPlaytest: !!this.editorPlaytest,
        preserveHistory: !!this.preserveHistory,
        includeSavedLevels: !!this.includeSavedLevels,
        bench: !!this.bench,
        bench2: !!this.bench2,
        benchReverse: !!this.benchReverse,
        benchSequence: !!this.benchSequence
      },
      caches: {
        fileProvider: sanitizedFileProviderStats,
        midiOverrideKeys: Object.keys(this._midiOverrides || {}).sort()
      },
      renderExperiments: this.stage?.getRenderExperimentStatus?.() || null
    };
  }
  setHistoryState(params) {
    const query = params instanceof URLSearchParams ? params : new URLSearchParams(params);
    const historyRef = getRuntimeDependency('history', null);
    historyRef?.replaceState?.(null, null, '?' + query.toString());
  }
  /** change the the text of a html element */
  changeHtmlText(htmlElement, value) {
    if (htmlElement == null) {
      return;
    }
    htmlElement.innerText = value;
  }
  /** prefix items with an increasing index */
  prefixNumbers(list) {
    return list.map((item, idx) => `${idx + 1} - ${item}`);
  }

  /** convert select values to integers */
  strToNum(str) {
    return parseInt10(str, 0);
  }
  /** remove items of a <select> */
  clearHtmlList(htmlList) {
    while (htmlList.options.length) {
      htmlList.remove(0);
    }
  }

  _getSavedLevelEntries() {
    if (!this.includeSavedLevels) return [];
    return listSavedLevels();
  }

  _getSavedGroupIndex(baseGroupCount, savedEntries = []) {
    if (!this.includeSavedLevels || !savedEntries.length) return -1;
    return baseGroupCount;
  }

  _isSavedGroupIndex(groupIndex, baseGroupCount, savedEntries = []) {
    return groupIndex === this._getSavedGroupIndex(baseGroupCount, savedEntries);
  }

  _getGroupCount(baseGroupCount, savedEntries = []) {
    const savedIndex = this._getSavedGroupIndex(baseGroupCount, savedEntries);
    return savedIndex >= 0 ? baseGroupCount + 1 : baseGroupCount;
  }

  _getGroupNames(savedEntries = []) {
    const baseGroups = this.gameResources?.getLevelGroups?.() ?? [];
    if (!this.includeSavedLevels || !savedEntries.length) return baseGroups;
    return [...baseGroups, 'Saved Levels'];
  }

  _getGroupLength(config, groupIndex, baseGroupCount, savedEntries = []) {
    if (this._isSavedGroupIndex(groupIndex, baseGroupCount, savedEntries)) {
      return savedEntries.length;
    }
    return config?.level?.getGroupLength?.(groupIndex) ?? 0;
  }

  _normalizeSelection(config, savedEntries = []) {
    const baseGroupCount = config?.level?.order?.length ??
      this.gameResources?.getLevelGroups?.().length ?? 0;
    const groupCount = this._getGroupCount(baseGroupCount, savedEntries);
    if (groupCount <= 0) {
      this.levelGroupIndex = 0;
      this.levelIndex = 0;
      return;
    }
    let groupIndex = Math.min(Math.max(this.levelGroupIndex, 0), groupCount - 1);
    let levelIndex = Math.max(this.levelIndex, 0);
    let groupLength = this._getGroupLength(
      config,
      groupIndex,
      baseGroupCount,
      savedEntries
    );
    if (groupLength <= 0) {
      let found = false;
      for (let i = 0; i < groupCount; i++) {
        const length = this._getGroupLength(config, i, baseGroupCount, savedEntries);
        if (length > 0) {
          groupIndex = i;
          levelIndex = 0;
          found = true;
          break;
        }
      }
      if (!found) {
        groupIndex = 0;
        levelIndex = 0;
      }
    } else if (levelIndex >= groupLength) {
      levelIndex = 0;
    }
    this.levelGroupIndex = groupIndex;
    this.levelIndex = levelIndex;
  }

  async _syncLevelGroupSelect(savedEntries = []) {
    if (!this.elementSelectLevelGroup || !this.gameResources) return;
    const config = await this.gameFactory.getConfig(this.gameType);
    const groups = this._getGroupNames(savedEntries);
    this.arrayToSelect(this.elementSelectLevelGroup, this.prefixNumbers(groups));
    this._normalizeSelection(config, savedEntries);
    this.elementSelectLevelGroup.selectedIndex = this.levelGroupIndex;
  }

  getEntranceFocusX(level, stageImage) {
    if (!level || !stageImage) return 0;
    const entrance = level.entrances?.[0];
    if (!entrance) return 0;
    const scale = stageImage.viewPoint.scale || 1;
    const viewW = stageImage.canvasViewportSize.width / scale;
    if (!isFinite(viewW) || viewW <= 0) return 0;
    const centerX = entrance.x + 24;
    return Math.round(centerX - viewW / 2);
  }

  applyLevelViewport(level) {
    if (!this.stage || !level) return;
    const stageImage = this.stage.gameImgProps;
    const rawX = Number.isFinite(level.screenPositionX) ? level.screenPositionX : 0;
    const targetX = Number.isFinite(rawX) ? rawX : this.getEntranceFocusX(level, stageImage);
    this.stage.applyViewport(
      stageImage,
      targetX,
      0,
      stageImage.viewPoint.scale
    );
    this.stage.redraw();
  }
  /** add array elements to a <select> */
  arrayToSelect(htmlList, list) {
    if (htmlList == null) {
      return;
    }
    this.clearHtmlList(htmlList);
    for (let i = 0; i < list.length; i++) {
      const opt = list[i];
      const el = document.createElement('option');
      el.textContent = opt;
      el.value = i.toString();
      htmlList.appendChild(el);
    }
  }
  /** fill the level select with the names for the current group */
  async populateLevelSelect() {
    if (!this.elementSelectLevel || !this.gameResources) return;
    const config = await this.gameFactory.getConfig(this.gameType);
    const savedEntries = this._getSavedLevelEntries();
    const baseGroupCount = this.gameResources.getLevelGroups().length;
    if (this._isSavedGroupIndex(this.levelGroupIndex, baseGroupCount, savedEntries)) {
      const list = savedEntries.map((entry, index) => `${index + 1}: ${entry.name}`);
      this.arrayToSelect(this.elementSelectLevel, list);
      if (list.length) {
        this.levelIndex = Math.min(this.levelIndex, list.length - 1);
      } else {
        this.levelIndex = 0;
      }
      this.elementSelectLevel.selectedIndex = this.levelIndex;
      return;
    }
    const groupLength = this._getGroupLength(
      config,
      this.levelGroupIndex,
      baseGroupCount,
      savedEntries
    );
    const list = [];
    for (let i = 0; i < groupLength; i++) {
      try {
        const lvl = await this.gameResources.getLevel(this.levelGroupIndex, i);
        if (lvl) {
          list.push((i + 1) + ': ' + lvl.name);
          continue;
        }
      } catch (e) {
        // keep slot alignment even if a level fails to load
      }
      list.push((i + 1) + ': [missing]');
    }
    this.arrayToSelect(this.elementSelectLevel, list);
    if (list.length) {
      this.levelIndex = Math.min(this.levelIndex, list.length - 1);
    } else {
      this.levelIndex = 0;
    }
    this.elementSelectLevel.selectedIndex = this.levelIndex;
  }
  /** switch the selected level group */
  async selectLevelGroup(newLevelGroupIndex) {
    if (!this.gameResources) return;
    const savedEntries = this._getSavedLevelEntries();
    const baseGroupCount = this.gameResources.getLevelGroups().length;
    const max = Math.max(0, this._getGroupCount(baseGroupCount, savedEntries) - 1);
    if (newLevelGroupIndex < 0) newLevelGroupIndex = 0;
    else if (newLevelGroupIndex > max) newLevelGroupIndex = max;
    this.levelGroupIndex = newLevelGroupIndex;
    this.levelIndex = 0;
    await this.populateLevelSelect();
    if (this.autoExitEditorOnSelect && this.editorMode) {
      this.exitEditorMode();
    }
    if (this.editorMode) {
      await this.loadEditorLevelFromSelection();
      return;
    }
    this.loadLevel();
  }
  /** switch the selected game type */
  async selectGameType(newGameType) {
    // dropdown values correspond to config array indices
    if (this.configs && this.configs[newGameType]) {
      newGameType = this.configs[newGameType].gametype;
    }
    this.gameType = newGameType;
    this.levelGroupIndex = 0;
    this.levelIndex = 0;
    const newGameResources = await this.gameFactory.getGameResources(this.gameType);
    this.gameResources = newGameResources;
    const savedEntries = this._getSavedLevelEntries();
    await this._syncLevelGroupSelect(savedEntries);
    await this.populateLevelSelect();
    if (this.autoExitEditorOnSelect && this.editorMode) {
      this.exitEditorMode();
    }
    if (this.editorMode) {
      await this.loadEditorLevelFromSelection();
      return;
    }
    this.loadLevel();
  }
  /** select a specific level */
  async selectLevel(newLevelIndex) {
    this.levelIndex = newLevelIndex;
    if (this.autoExitEditorOnSelect && this.editorMode) {
      this.exitEditorMode();
    }
    if (this.editorMode) {
      await this.loadEditorLevelFromSelection();
      return;
    }
    this.loadLevel();
  }
  /** select a game type */
  async setup() {
    this.applyQuery();
    if (!this._midiMapping) {
      this._midiMapping = await this._loadMidiMapping();
      this.applyMidiOverrides(this._midiOverrides);
    }
    this.configs = await this.gameFactory.configReader.configs;
    this.arrayToSelect(this.elementSelectGameType, this.configs.map(c => c.name));
    const typeIndex = this.configs.findIndex(c => c.gametype === this.gameType);
    if (typeIndex >= 0 && this.elementSelectGameType)
      this.elementSelectGameType.selectedIndex = typeIndex;
    const newGameResources = await this.gameFactory.getGameResources(this.gameType);
    this.gameResources = newGameResources;
    const savedEntries = this._getSavedLevelEntries();
    await this._syncLevelGroupSelect(savedEntries);
    const populatePromise = this.populateLevelSelect();
    await this.loadLevel();
    await populatePromise;
    if (this.benchSequence) {
      await this.benchSequenceStart();
    }
  }

  async setupEditor() {
    this.applyQuery();
    this.configs = await this.gameFactory.configReader.configs;
    this.arrayToSelect(this.elementSelectGameType, this.configs.map(c => c.name));
    const typeIndex = this.configs.findIndex(c => c.gametype === this.gameType);
    if (typeIndex >= 0 && this.elementSelectGameType)
      this.elementSelectGameType.selectedIndex = typeIndex;
    const newGameResources = await this.gameFactory.getGameResources(this.gameType);
    this.gameResources = newGameResources;
    const savedEntries = this._getSavedLevelEntries();
    await this._syncLevelGroupSelect(savedEntries);
    await this.populateLevelSelect();
  }
  /** load a level and render it to the display */
  async loadLevel() {
    if (this.autoMoveTimer !== null) {
      window.clearTimeout(this.autoMoveTimer);
      this.autoMoveTimer = null;
    }
    if (!this.gameResources) return;
    const savedEntries = this._getSavedLevelEntries();
    const baseGroupCount = this.gameResources.getLevelGroups().length;
    if (this._isSavedGroupIndex(this.levelGroupIndex, baseGroupCount, savedEntries)) {
      return this.loadSavedLevelFromSelection(savedEntries);
    }
    if (this.game) {
      this.midiRouter?.detach?.();
      this.game.stop();
      this.game = null;
    }
    const gameStateTypes = getGameStateTypes();
    this.changeHtmlText(this.elementGameState, gameStateTypes[gameStateTypes.UNKNOWN]);
    const level = await this.gameResources.getLevel(this.levelGroupIndex, this.levelIndex);
    if (!level) return;
    if (this.elementSelectGameType && this.configs) {
      const idx = this.configs.findIndex(c => c.gametype === this.gameType);
      if (idx >= 0) this.elementSelectGameType.selectedIndex = idx;
    }
    if (this.elementSelectLevelGroup) this.elementSelectLevelGroup.selectedIndex = this.levelGroupIndex;
    if (this.elementSelectLevel) this.elementSelectLevel.selectedIndex = this.levelIndex;
    if (this.stage) {
      const gameDisplay = this.stage.getGameDisplay();
      gameDisplay.clear();
      this.stage.resetFade();
      level.render(gameDisplay);
      this.stage.updateStageSize();
      this.applyLevelViewport(level);
    }
    this.updateQuery();
    this.log.debug(level);
    return this.start();
  }

  async benchStart(entrances) {
    this.bench = true;
    this._benchMeasureExtras = false;
    await this.loadLevel();
    const level = this.game.level;
    if (this.stage) {
      this.applyLevelViewport(level);
    }
    const cfg = this.configs?.find(c => c.gametype === this.gameType);
    const pack = cfg?.name || this.gameType;
    const savedEntries = this._getSavedLevelEntries();
    const group = this._getGroupNames(savedEntries)[this.levelGroupIndex];
    const lvlName = level.name ? level.name.trim() : '';
    console.log(`starting bench series for ${lvlName} in ${group} in ${pack}, adding ${entrances} entrances with ${this.extraLemmings} extra lemmings`);

    if (!this._benchBaseEntrances) {
      this._benchBaseEntrances = level.entrances.slice();
    }
    level.entrances.length = 0;
    const baseEntrances = this._benchBaseEntrances;
    const groundMask = level.getGroundMaskLayer();
    const triggerTypes = getTriggerTypes();
    const badTriggers = new Set([
      triggerTypes.DROWN,
      triggerTypes.FRYING,
      triggerTypes.KILL,
      triggerTypes.TRAP,
    ]);

    const increments = [100, 50, 25, 12, 6];
    const SEGMENT_DURATION = 60;
    const ENTRANCE_HEIGHT = 28;
    const SPAWN_OFFSET_Y = 14;
    const SAFE_ENTRANCE_DROP = getLemmingCtor().LEM_MAX_FALLING - SPAWN_OFFSET_Y;

    const clearHeight = (x, y) => {
      if (y < 0 || y + ENTRANCE_HEIGHT > level.height) return false;
      for (let i = 0; i < ENTRANCE_HEIGHT; i++) {
        if (groundMask.hasGroundAt(x, y + i)) return false;
      }
      return true;
    };

    const findOpenSegment = x => {
      let best = null;
      let y = 0;
      while (y < level.height) {
        while (y < level.height && groundMask.hasGroundAt(x, y)) y++;
        const start = y;
        while (y < level.height && !groundMask.hasGroundAt(x, y)) y++;
        const end = y;
        if (end >= level.height) break;
        const h = end - start;
        if (h >= ENTRANCE_HEIGHT + 15 && (!best || h > best.height)) {
          best = { top: start, bottom: end, height: h };
        }
        y++; // skip ground
      }
      return best;
    };

    const trySpawn = spawnX => {
      if (spawnX < 0 || spawnX >= level.width) return false;
      const seg = findOpenSegment(spawnX);
      if (!seg) return false;
      const drop = Math.min(seg.height - ENTRANCE_HEIGHT, SAFE_ENTRANCE_DROP);
      if (drop < 15) return false;
      const entY = seg.bottom - ENTRANCE_HEIGHT - drop;
      if (!clearHeight(spawnX, entY)) return false;

      for (const tr of level.triggers) {
        if (!badTriggers.has(tr.type)) continue;
        if (spawnX < tr.x1 || spawnX > tr.x2) continue;
        // disallow if entrance intersects or is above a deadly trigger
        if (entY + ENTRANCE_HEIGHT > tr.y1 && entY < tr.y2) return false;
        if (entY + ENTRANCE_HEIGHT <= tr.y1 && seg.bottom >= tr.y1) return false;
      }

      const entX = spawnX - 24;
      if (entX < 0 || entX >= level.width || entY < 0 || entY >= level.height) return false;

      for (const ent of level.entrances) {
        if (ent.x === entX && ent.y === entY) return false;
      }

      level.entrances.push({ x: entX, y: entY });
      return true;
    };

    if (!this._benchEntrancePool) {
      level.entrances = baseEntrances.slice();
      const target = Math.max(...this._benchCounts);
      for (const step of increments) {
        let offset = 0;
        while (level.entrances.length < target && offset <= level.width) {
          for (const base of baseEntrances) {
            if (level.entrances.length >= target) break;
            const center = base.x + 24;
            if (offset === 0) {
              trySpawn(center);
              continue;
            }
            trySpawn(center + offset);
            if (level.entrances.length >= target) break;
            trySpawn(center - offset);
          }
          offset += step;
        }
        if (level.entrances.length >= target) break;
      }
      this._benchEntrancePool = level.entrances.slice();
    } else {
      level.entrances = this._benchEntrancePool.slice();
    }
    if (entrances > level.entrances.length) {
      entrances = level.entrances.length;
    }
    level.entrances.length = entrances;
    if (this.game.getLemmingManager) {
      const lm = this.game.getLemmingManager();
      if (lm) lm.spawnCount = entrances;
    }
    const timer = this.game.getGameTimer();
    timer.speedFactor = 6;
    timer.benchStartupFrames = 120;
    timer.benchStableFactor = 8;
    this._benchStartTime = timer.getGameTime();
    if (this.benchSequence) {
      if (this._benchMonitor) timer.eachGameSecond.off(this._benchMonitor);
      if (this._benchSpeedTrack) timer.eachGameSecond.off(this._benchSpeedTrack);
      this._benchMaxSpeed = timer.speedFactor;
      this._benchSpeedTrack = () => {
        if (timer.speedFactor > this._benchMaxSpeed) this._benchMaxSpeed = timer.speedFactor;
      };
      timer.eachGameSecond.on(this._benchSpeedTrack);
      this._benchMonitor = async () => {
        if (timer.speedFactor < 1 ||
              timer.getGameTime() - this._benchStartTime >= SEGMENT_DURATION) {
          timer.eachGameSecond.off(this._benchMonitor);
          timer.eachGameSecond.off(this._benchSpeedTrack);
          timer.suspend();
          const count = this.game.getLemmingManager().getLemmings().length;
          const tps = (this._benchMaxSpeed * (1000 / timer.TIME_PER_FRAME_MS)).toFixed(1);
          console.log(`series finished for ${entrances} entrances - ${count} lemmings - ${this._benchMaxSpeed.toFixed(1)} highest speed achieved (${tps} ticks per second)`);
          this._benchIndex++;
          if (this._benchIndex >= this._benchCounts.length) {
            this._benchIndex = 0;
            if (this._benchExtraList && ++this._benchExtraIndex < this._benchExtraList.length) {
              this.extraLemmings = this._benchExtraList[this._benchExtraIndex];
            } else if (this._benchExtraList) {
              return;
            }
          }
          await this.benchStart(this._benchCounts[this._benchIndex]);
        }
      };
      timer.eachGameSecond.on(this._benchMonitor);
    }
  }

  async benchMeasureExtras() {
    this.bench = true;
    this._benchMeasureExtras = true;
    await this.loadLevel();
    const lm = this.game.getLemmingManager();
    if (lm) lm.spawnCount = this.game.level.entrances.length;
    const vc = this.game.getVictoryCondition();
    if (vc) vc.releaseRate = vc.getMinReleaseRate();
    const timer = this.game.getGameTimer();
    timer.speedFactor = 10;
    timer.benchStartupFrames = 120;
    timer.benchStableFactor = 2;
    let extras = 0;
    let prev = lm.spawnTotal;
    let spawned = 0;
    return new Promise(resolve => {
      const monitor = () => {
        const delta = lm.spawnTotal - prev;
        prev = lm.spawnTotal;
        spawned += delta / (extras + 1);
        while (spawned >= 10) {
          spawned -= 1;
          extras += 1;
          this.extraLemmings = extras;
        }
        if (timer.speedFactor < 1 || timer.getGameTime() >= 120) {
          timer.eachGameSecond.off(monitor);
          timer.suspend();
          this._benchMeasureExtras = false;
          console.log(`extra lemmings threshold reached at ${extras}`);
          resolve(extras);
        }
      };
      timer.eachGameSecond.on(monitor);
    });
  }

  async benchSequenceStart() {
    this._benchCounts = [50, 25, 10, 1];
    this._benchIndex = 0;
    const extras = await this.benchMeasureExtras();
    this._benchExtraList = [extras, Math.floor(extras / 2), 0];
    this._benchExtraIndex = 0;
    this._benchBaseEntrances = null;
    this._benchEntrancePool = null;
    this.extraLemmings = this._benchExtraList[0];
    await this.benchStart(this._benchCounts[0]);
  }

  ensureEditorSession() {
    if (!this.editorSession) {
      this.editorSession = new EditorSession();
    }
    return this.editorSession;
  }

  enterEditorMode() {
    if (this.editorMode) return;
    this.editorMode = true;
    this.editorPlaytest = false;
    const timer = this.game?.getGameTimer?.();
    this._editorWasRunning = !!timer?.isRunning?.();
    timer?.suspend?.();
    if (this.stage) {
      this._editorPanWasEnabled = this.stage.panEnabled !== false;
      this.stage.panEnabled = false;
    }
    if (this.game) {
      this._editorInputWasEnabled = this.game.inputEnabled !== false;
      this.game.inputEnabled = false;
    }
    if (!this.editorSession) {
      this.editorSession = new EditorSession();
      this.editorSession.createBlank();
    }
  }

  exitEditorMode() {
    if (!this.editorMode) return;
    this.editorMode = false;
    this.editorPlaytest = false;
    const timer = this.game?.getGameTimer?.();
    if (this._editorWasRunning) {
      timer?.continue?.();
    }
    this._editorWasRunning = false;
    if (this.stage) {
      this.stage.panEnabled = this._editorPanWasEnabled !== false;
    }
    if (this.game) {
      this.game.inputEnabled = this._editorInputWasEnabled !== false;
    }
  }

  toggleEditorMode() {
    if (this.editorMode) {
      this.exitEditorMode();
    } else {
      this.enterEditorMode();
    }
  }

  setEditorPlaytest(enabled) {
    this.editorPlaytest = !!enabled;
    if (!this.editorMode) return;
    const timer = this.game?.getGameTimer?.();
    if (this.editorPlaytest) {
      timer?.continue?.();
    } else {
      timer?.suspend?.();
    }
    if (this.game) {
      this.game.inputEnabled = this.editorPlaytest;
    }
    if (this.stage) {
      this.stage.panEnabled = this.editorPlaytest;
    }
  }

  createBlankEditorLevel(options = {}) {
    this.enterEditorMode();
    const level = this.editorSession.createBlank(options);
    if (options.render !== false) {
      this.loadEditorPreviewLevel({ suspend: true });
    }
    return level;
  }

  loadEditorLevelFromText(text, options = {}) {
    this.enterEditorMode();
    const level = this.editorSession.loadFromText(text);
    if (options.render !== false) {
      this.loadEditorPreviewLevel({ suspend: true });
    }
    return level;
  }

  getEditorLevelText() {
    const session = this.ensureEditorSession();
    return session.toText();
  }

  getEditorLevelTitle() {
    const session = this.ensureEditorSession();
    return session.getTitle();
  }

  async _startWithLevel(level) {
    if (!this.gameFactory) return;
    if (this.game != null) {
      this.continue();
      return;
    }
    const baseResources = this.gameResources;
    if (!baseResources) return;
    const editorResources = Object.create(baseResources);
    editorResources.getLevel = async () => level;
    try {
      const game = await this.gameFactory.getGame(this.gameType, editorResources);
      await game.loadLevel(this.levelGroupIndex, this.levelIndex);
      game.setGameDisplay(this.stage.getGameDisplay());
      game.setGuiDisplay(this.stage.getGuiDisplay());
      if (this.stage && game.level) {
        const preserveViewport = this._preserveEditorViewport === true;
        if (!preserveViewport) {
          this.applyLevelViewport(game.level);
        }
        this._preserveEditorViewport = false;
      }
      game.getGameTimer().speedFactor = this.gameSpeedFactor;
      this._registerMidiFlagTriggers(game);
      this.stage.setCursorSprite(createCrosshairFrame(24));
      if (this.midiEnabled) {
        await this.initMidiRouting();
        this.midiRouter?.attach(game.soundEvents, { game, stage: this.stage });
      }
      game.start();
      const gameStateTypes = getGameStateTypes();
      this.changeHtmlText(this.elementGameState, gameStateTypes.toString(gameStateTypes.RUNNING));
      game.onGameEnd.on(state => this.onGameEnd(state));
      this.game = game;
      if (this.cheatEnabled) this.game.cheat();
      if (this.debug) this.game.showDebug = true;
    } catch (e) {
      this.log.log('Error starting custom level:', e);
    }
  }

  async loadEditorPreviewLevel(options = {}) {
    if (this.autoMoveTimer !== null) {
      window.clearTimeout(this.autoMoveTimer);
      this.autoMoveTimer = null;
    }
    if (!this.editorSession?.level || !this.gameFactory) return null;
    const config = this.gameResources?.config || await this.gameFactory.getConfig(this.gameType);
    if (!config) return null;
    if (this.game) {
      this.midiRouter?.detach?.();
      this.game.stop();
      this.game = null;
    }
    const gameStateTypes = getGameStateTypes();
    this.changeHtmlText(this.elementGameState, gameStateTypes[gameStateTypes.UNKNOWN]);
    const level = await loadEditorLevel(
      this.editorSession.level,
      config,
      this.gameFactory.fileProvider,
      {
        levelGroupIndex: this.levelGroupIndex,
        levelIndex: this.levelIndex
      }
    );
    if (!level) return null;
    if (this.elementSelectGameType && this.configs) {
      const idx = this.configs.findIndex(c => c.gametype === this.gameType);
      if (idx >= 0) this.elementSelectGameType.selectedIndex = idx;
    }
    if (this.elementSelectLevelGroup) this.elementSelectLevelGroup.selectedIndex = this.levelGroupIndex;
    if (this.elementSelectLevel) this.elementSelectLevel.selectedIndex = this.levelIndex;
    const preserveView = options.preserveView === true;
    const prevViewport = preserveView && this.stage
      ? {
        x: this.stage.gameImgProps.viewPoint.x,
        y: this.stage.gameImgProps.viewPoint.y,
        scale: this.stage.gameImgProps.viewPoint.scale
      }
      : null;
    this._preserveEditorViewport = !!prevViewport;

    if (this.stage) {
      const gameDisplay = this.stage.getGameDisplay();
      gameDisplay.clear();
      this.stage.resetFade();
      level.render(gameDisplay);
      this.stage.updateStageSize();
      if (prevViewport) {
        this.stage.applyViewport(
          this.stage.gameImgProps,
          prevViewport.x,
          prevViewport.y,
          prevViewport.scale
        );
        this.stage.redraw();
      } else {
        this.applyLevelViewport(level);
      }
    }
    this.updateQuery();
    this.log.debug(level);
    await this._startWithLevel(level);
    if (prevViewport && this.stage) {
      this.stage.applyViewport(
        this.stage.gameImgProps,
        prevViewport.x,
        prevViewport.y,
        prevViewport.scale
      );
      this.stage.redraw();
    }
    this._preserveEditorViewport = false;
    if (this.editorMode && this.game) {
      this.game.inputEnabled = this.editorPlaytest;
    } else if (this.game) {
      this.game.inputEnabled = true;
    }
    if (this.editorMode && this.stage) {
      this.stage.panEnabled = this.editorPlaytest;
    } else if (this.stage) {
      this.stage.panEnabled = true;
    }
    const timer = this.game?.getGameTimer?.();
    if (options.suspend !== false && !this.editorPlaytest) {
      timer?.suspend?.();
    } else if (this.editorPlaytest) {
      timer?.continue?.();
    }
    return level;
  }

  /**
   * Register runtime owner triggers that emit MIDI-routing events for editor
   * MIDI flags.
   */
  _registerMidiFlagTriggers(game) {
    if (!game?.triggerManager || !game?.soundEvents) return;
    if (game[MIDI_FLAG_REGISTRATION_KEY]) return;
    game[MIDI_FLAG_REGISTRATION_KEY] = true;
    const flags = Array.isArray(game?.level?.midiFlags) ? game.level.midiFlags : [];
    if (!flags.length) return;
    for (let i = 0; i < flags.length; i += 1) {
      const flag = flags[i] || {};
      const midiFlagId = clampMidiFlagId(Number(flag.id));
      const triggerType = Number.isFinite(flag.triggerType)
        ? flag.triggerType
        : toMidiFlagTriggerType(midiFlagId);
      if (!Number.isFinite(triggerType)) continue;
      const x1 = Number(flag.x1);
      const y1 = Number(flag.y1);
      const x2 = Number(flag.x2);
      const y2 = Number(flag.y2);
      if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
        continue;
      }
      const cooldownTicks = Number.isFinite(flag.cooldownTicks)
        ? Math.max(0, Math.trunc(flag.cooldownTicks))
        : 0;
      const owner = {
        id: `midi_flag_${midiFlagId ?? i}_${i}`,
        onTrigger: (_tick, lemming, trigger, x, y) => {
          game.soundEvents.emit({
            type: SoundEventTypes.TRAP_TRIGGER,
            sfxId: SoundEffectIds.NONE,
            triggerType,
            midiFlagId,
            pieceId: flag.pieceId ?? null,
            x,
            y,
            lemmingId: lemming?.id ?? null,
            triggerBounds: {
              x1: trigger?.x1 ?? x1,
              y1: trigger?.y1 ?? y1,
              x2: trigger?.x2 ?? x2,
              y2: trigger?.y2 ?? y2
            }
          });
        }
      };
      game.triggerManager.add(new Trigger(
        TriggerTypes.NO_TRIGGER,
        x1,
        y1,
        x2,
        y2,
        cooldownTicks,
        -1,
        owner
      ));
    }
  }

  async loadSavedLevelFromSelection(savedEntries = null) {
    if (!this.gameResources || !this.gameFactory) return null;
    const entries = savedEntries ?? this._getSavedLevelEntries();
    if (!entries.length) return null;
    if (this.levelIndex < 0) this.levelIndex = 0;
    if (this.levelIndex >= entries.length) {
      this.levelIndex = entries.length - 1;
    }
    const entry = entries[this.levelIndex];
    if (!entry) return null;
    const text = loadSavedLevel(undefined, entry.id);
    if (!text) return null;
    if (this.autoExitEditorOnSelect && this.editorMode) {
      this.exitEditorMode();
    }
    const session = this.ensureEditorSession();
    session.loadFromText(text);
    return this.loadEditorPreviewLevel({ suspend: false });
  }

  async refreshSavedLevels() {
    if (!this.includeSavedLevels || !this.gameResources) return;
    const savedEntries = this._getSavedLevelEntries();
    await this._syncLevelGroupSelect(savedEntries);
    await this.populateLevelSelect();
    const baseGroupCount = this.gameResources.getLevelGroups().length;
    if (!this.editorMode &&
        this._isSavedGroupIndex(this.levelGroupIndex, baseGroupCount, savedEntries)) {
      await this.loadSavedLevelFromSelection(savedEntries);
    }
  }
  async _loadClassicLevelReader(gameType, levelGroupIndex, levelIndex) {
    const provider = this.gameFactory?.fileProvider;
    if (!provider) return null;
    const config = await this.gameFactory.getConfig(gameType);
    if (!config) return null;
    const resolver = new LevelIndexResolve(config);
    const levelInfo = resolver.resolve(levelGroupIndex, levelIndex);
    if (!levelInfo) return null;
    const paddedFileId = ('0000' + levelInfo.fileId).slice(-3);
    const levelDat = await provider.loadBinary(
      config.path,
      config.level.filePrefix + paddedFileId + '.DAT'
    );
    const levelsContainer = new FileContainer(levelDat);
    return new LevelReader(levelsContainer.getPart(levelInfo.partIndex));
  }

  async loadEditorLevelFromSelection(options = {}) {
    this.enterEditorMode();
    const reader = await this._loadClassicLevelReader(
      this.gameType,
      this.levelGroupIndex,
      this.levelIndex
    );
    if (!reader) return null;
    const editorLevel = createEditorLevelFromClassic(reader, options);
    this.editorSession.level = editorLevel;
    if (options.render !== false) {
      await this.loadEditorPreviewLevel({ suspend: true });
    }
    return editorLevel;
  }

  /** cleanup keyboard and stage handlers */
  dispose() {
    const appWindow = globalThis.window;
    // Fall back to the global timer helpers so disposal works in headless tests.
    if (this.autoMoveTimer != null) {
      (appWindow?.clearTimeout || globalThis.clearTimeout)?.(this.autoMoveTimer);
      this.autoMoveTimer = null;
    }
    if (this.resumeTimer != null) {
      (appWindow?.clearTimeout || globalThis.clearTimeout)?.(this.resumeTimer);
      this.resumeTimer = null;
    }
    clearAppContext(this);
    if (this.shortcuts) {
      this.shortcuts.dispose();
      this.shortcuts = null;
    }
    if (this.midiRouter) {
      this.midiRouter.dispose();
      this.midiRouter = null;
    }
    if (this.stage && this.stage.dispose) {
      appWindow?.removeEventListener?.('resize', this._stageResize, PASSIVE_RESIZE_LISTENER);
      appWindow?.removeEventListener?.('orientationchange', this._stageResize, PASSIVE_RESIZE_LISTENER);
      this.stage.dispose();
      this.stage = null;
    }
  }
}

export { GameView };
