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
const gameViewQueryMethods = {
  enableDebug() {
    if (this.game == null) {
      return;
    }
    this.game.setDebugMode(true);
  },

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
  },

  parseBool(query, names, def = false) {
    for (const name of names) {
      if (query.has(name)) {
        const raw = query.get(name);
        if (raw == null || raw === '') return true;
        const normalized = String(raw).trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        return def;
      }
    }
    return def;
  },

  parseProfileBool(query, names, fallback = false) {
    for (const name of names) {
      if (query.has(name)) {
        return this.parseBool(query, names, fallback);
      }
    }
    return fallback;
  },

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
      ['offscreenPresent'],
      rendering.offscreenPresentExperiment === true
    );
    this.workerOffscreenExperiment = renderRolloutEnabled && this.parseProfileBool(
      query,
      ['workerOffscreen'],
      rendering.workerOffscreenExperiment === true
    );
    this.stage?.setRenderExperimentFlags?.({
      offscreenPresent: this.offscreenPresentExperiment,
      workerOffscreen: this.workerOffscreenExperiment
    });
  },

  updateQuery() {
    const windowRef = getRuntimeDependency('window', null);
    const params = windowRef?.location?.search
      ? new URLSearchParams(windowRef.location.search)
      : new URLSearchParams('');
    const setParam = (longName, shortName, value, def, always) => {
      params.delete(longName);
      if (shortName) params.delete(shortName);
      if (always || (value !== undefined && value !== def)) {
        params.set(this.shortcut && shortName ? shortName : longName, value);
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
    setParam('offscreenPresent', null, this.offscreenPresentExperiment, false);
    setParam('workerOffscreen', null, this.workerOffscreenExperiment, false);
    setParam('profile', 'pr', this.startupProfile, DEFAULT_RUNTIME_PROFILE);

    if (this.shortcut) {
      params.set('_', true);
    } else {
      params.delete('_');
    }

    this.setHistoryState(params);
  },

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
  },

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
  },

  setHistoryRetentionPolicy(policy) {
    if (!policy || typeof policy !== 'object') {
      this._historyRetentionOverride = null;
      return null;
    }
    this._historyRetentionOverride = { ...policy };
    return { ...this._historyRetentionOverride };
  },

  applyProfileHistoryRetentionPolicy() {
    const policy = this.resolveHistoryRetentionPolicy();
    this._historyRetentionPolicy = { ...policy };
    return { ...policy };
  },

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
  },

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
  },

  setHistoryState(params) {
    const query = params instanceof URLSearchParams ? params : new URLSearchParams(params);
    const historyRef = getRuntimeDependency('history', null);
    historyRef?.replaceState?.(null, null, '?' + query.toString());
  }
};
export { gameViewQueryMethods };
