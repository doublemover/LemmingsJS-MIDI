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
const gameViewRuntimeMethods = {
  set gameCanvas(el) {
    const appWindow = globalThis.window;
    if (this.stage && this.stage.dispose) {
      appWindow?.removeEventListener?.('resize', this._stageResize, PASSIVE_RESIZE_LISTENER);
      appWindow?.removeEventListener?.('orientationchange', this._stageResize, PASSIVE_RESIZE_LISTENER);
      this.stage.dispose();
    }
    const StageCtor = getDependency('Stage', Stage);
    this.stage = new StageCtor(el, {
      getScale: () => this.scale
    });
    this.stage.setPerfOverlay?.(this.perfOverlay, () => this.getPerfOverlayData());
    this.stage.setRenderExperimentFlags?.({
      offscreenPresent: this.offscreenPresentExperiment,
      workerOffscreen: this.workerOffscreenExperiment
    });
    this._stageResize = () => this.stage.scheduleUpdateStageSize();
    appWindow?.addEventListener?.('resize', this._stageResize, PASSIVE_RESIZE_LISTENER);
    appWindow?.addEventListener?.('orientationchange', this._stageResize, PASSIVE_RESIZE_LISTENER);
    this._stageResize();
  },

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
      game.history?.captureReplayBaseline?.(game);
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
  },

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
  },

  async loadReplay(replayString) {
    await this.start(replayString);
  },

  cheat() {
    if (this.game == null) {
      return;
    }
    this.game.cheat();
  },

  suspend() {
    if (this.game == null) {
      return;
    }
    this.game.getGameTimer().suspend();
  },

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
  },

  continue () {
    if (this.game == null) {
      return;
    }
    this.game.getGameTimer().continue();
  },

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
  },

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
  },

  selectSpeedFactor(newSpeed) {
    if (this.game == null) {
      return;
    }
    this.gameSpeedFactor = newSpeed;
    this.game.getGameTimer().speedFactor = newSpeed;
  },

  playMusic(moveInterval) {

  },

  stopMusic() {

  },

  stopSound() {

  },

  playSound(moveInterval) {

  }
};
export { gameViewRuntimeMethods };