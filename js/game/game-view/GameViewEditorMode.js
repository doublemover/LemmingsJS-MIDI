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
const gameViewEditorModeMethods = {
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
  },

  ensureEditorSession() {
    if (!this.editorSession) {
      this.editorSession = new EditorSession();
    }
    return this.editorSession;
  },

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
  },

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
  },

  toggleEditorMode() {
    if (this.editorMode) {
      this.exitEditorMode();
    } else {
      this.enterEditorMode();
    }
  },

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
  },

  createBlankEditorLevel(options = {}) {
    this.enterEditorMode();
    const level = this.editorSession.createBlank(options);
    if (options.render !== false) {
      this.loadEditorPreviewLevel({ suspend: true });
    }
    return level;
  },

  loadEditorLevelFromText(text, options = {}) {
    this.enterEditorMode();
    const level = this.editorSession.loadFromText(text);
    if (options.render !== false) {
      this.loadEditorPreviewLevel({ suspend: true });
    }
    return level;
  },

  getEditorLevelText() {
    const session = this.ensureEditorSession();
    return session.toText();
  },

  getEditorLevelTitle() {
    const session = this.ensureEditorSession();
    return session.getTitle();
  },

  async loadEditorPreviewLevel(options = {}) {
    if (this.autoMoveTimer !== null) {
      const clearTimeoutFn = globalThis.window?.clearTimeout || globalThis.clearTimeout;
      if (typeof clearTimeoutFn === 'function') {
        clearTimeoutFn(this.autoMoveTimer);
      }
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
  },

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
  },

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
};
export { gameViewEditorModeMethods };