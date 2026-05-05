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
const gameViewLevelSelectionMethods = {
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
  },

  changeHtmlText(htmlElement, value) {
    if (htmlElement == null) {
      return;
    }
    htmlElement.innerText = value;
  },

  prefixNumbers(list) {
    return list.map((item, idx) => `${idx + 1} - ${item}`);
  },

  strToNum(str) {
    return parseInt10(str, 0);
  },

  clearHtmlList(htmlList) {
    while (htmlList.options.length) {
      htmlList.remove(0);
    }
  },

  _getSavedLevelEntries() {
    if (!this.includeSavedLevels) return [];
    return listSavedLevels();
  },

  _getSavedGroupIndex(baseGroupCount, savedEntries = []) {
    if (!this.includeSavedLevels || !savedEntries.length) return -1;
    return baseGroupCount;
  },

  _isSavedGroupIndex(groupIndex, baseGroupCount, savedEntries = []) {
    return groupIndex === this._getSavedGroupIndex(baseGroupCount, savedEntries);
  },

  _getGroupCount(baseGroupCount, savedEntries = []) {
    const savedIndex = this._getSavedGroupIndex(baseGroupCount, savedEntries);
    return savedIndex >= 0 ? baseGroupCount + 1 : baseGroupCount;
  },

  _getGroupNames(savedEntries = []) {
    const baseGroups = this.gameResources?.getLevelGroups?.() ?? [];
    if (!this.includeSavedLevels || !savedEntries.length) return baseGroups;
    return [...baseGroups, 'Saved Levels'];
  },

  _getGroupLength(config, groupIndex, baseGroupCount, savedEntries = []) {
    if (this._isSavedGroupIndex(groupIndex, baseGroupCount, savedEntries)) {
      return savedEntries.length;
    }
    return config?.level?.getGroupLength?.(groupIndex) ?? 0;
  },

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
  },

  async _syncLevelGroupSelect(savedEntries = []) {
    if (!this.elementSelectLevelGroup || !this.gameResources) return;
    const config = await this.gameFactory.getConfig(this.gameType);
    const groups = this._getGroupNames(savedEntries);
    this.arrayToSelect(this.elementSelectLevelGroup, this.prefixNumbers(groups));
    this._normalizeSelection(config, savedEntries);
    this.elementSelectLevelGroup.selectedIndex = this.levelGroupIndex;
  },

  getEntranceFocusX(level, stageImage) {
    if (!level || !stageImage) return 0;
    const entrance = level.entrances?.[0];
    if (!entrance) return 0;
    const scale = stageImage.viewPoint.scale || 1;
    const viewW = stageImage.canvasViewportSize.width / scale;
    if (!isFinite(viewW) || viewW <= 0) return 0;
    const centerX = entrance.x + 24;
    return Math.round(centerX - viewW / 2);
  },

  applyLevelViewport(level) {
    if (!this.stage || !level) return;
    const stageImage = this.stage.gameImgProps;
    const hasSavedX = Number.isFinite(level.screenPositionX);
    const targetX = hasSavedX
      ? level.screenPositionX
      : this.getEntranceFocusX(level, stageImage);
    this.stage.applyViewport(
      stageImage,
      targetX,
      0,
      stageImage.viewPoint.scale
    );
    this.stage.redraw();
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  async loadLevel() {
    if (this.autoMoveTimer !== null) {
      const clearTimeoutFn = globalThis.window?.clearTimeout || globalThis.clearTimeout;
      if (typeof clearTimeoutFn === 'function') {
        clearTimeoutFn(this.autoMoveTimer);
      }
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
  },

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
      game.history?.captureReplayBaseline?.(game);
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
  },

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
  },

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
  },

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
};
export { gameViewLevelSelectionMethods };