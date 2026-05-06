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
const gameViewMidiMethods = {
  get midiOut() { return this._midiOut; },

  set midiOut(output) {
    this._midiOut = output;
    this.midiRouter?.setOutput?.(output);
  },

  setMidiStatusHandlers({ onEnabled = null, onError = null } = {}) {
    this._midiStatusHandlers = {
      onEnabled: typeof onEnabled === 'function' ? onEnabled : null,
      onError: typeof onError === 'function' ? onError : null
    };
  },

  _getWebMidi() {
    return getRuntimeDependency('webMidi', null);
  },

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
  },

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
  },

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
  },

  async initMidiRouting() {
    if (!this.midiEnabled) {
      this.midiRouter?.detach?.();
      this.midiRouter?.scheduler?.allNotesOff?.();
      return null;
    }
    if (!this.midiRouter) {
      await this._ensureWebMidiEnabled();
      this._midiMapping = this._midiMapping || await this._loadMidiMapping();
      if (this._midiProjectConfig) {
        this.setMidiProjectConfig(this._midiProjectConfig);
      } else {
        this.applyMidiOverrides(this._midiOverrides);
      }
      const Router = getDependency('MidiEventRouter', MidiEventRouter);
      this.midiRouter = new Router(this._midiMapping);
    }
    const webMidi = this._getWebMidi();
    if (webMidi?.enabled) {
      this.midiRouter?.setOutputs?.(webMidi.outputs || []);
    }
    if (!this._midiOut) {
      if (webMidi?.enabled && webMidi.outputs?.length) {
        this._midiOut = webMidi.outputs[0];
      }
    }
    if (this._midiOut) this.midiRouter.setOutput(this._midiOut);
    return this.midiRouter;
  },

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
  },

  applyMidiOverrides(overrides) {
    if (!this._midiBaseConfig) return;
    const merged = typeof MidiMapping?.mergeConfigs === 'function'
      ? MidiMapping.mergeConfigs(this._midiBaseConfig, overrides || {})
      : { ...this._midiBaseConfig, ...(overrides || {}) };
    this._midiMapping = new MidiMapping(merged);
    if (this.midiRouter) this.midiRouter.setMapping(this._midiMapping);
  },

  setMidiOverrides(overrides) {
    this._midiOverrides = cloneConfig(overrides || {});
    this.applyMidiOverrides(this._midiOverrides);
  },

  setMidiProjectConfig(config) {
    this._midiProjectConfig = cloneConfig(config || {});
    this._midiMapping = new MidiMapping(this._midiProjectConfig);
    if (this.midiRouter) this.midiRouter.setMapping(this._midiMapping);
  },

  getMidiConfig() {
    return this._midiMapping?.config ?? null;
  },

  getMidiBaseConfig() {
    return this._midiBaseConfig;
  },

  getMidiSchemaHash() {
    return this._midiSchemaHash;
  },

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
        __historyKind: 'midi_flag',
        __historyData: {
          midiFlagId,
          triggerType,
          pieceId: flag.pieceId ?? null
        },
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
      const trigger = new Trigger(
        TriggerTypes.NO_TRIGGER,
        x1,
        y1,
        x2,
        y2,
        cooldownTicks,
        -1,
        owner
      );
      if (typeof game.triggerManager.addObserver === 'function') {
        game.triggerManager.addObserver(trigger);
      } else {
        game.triggerManager.add(trigger);
      }
    }
  }
};
export { gameViewMidiMethods };
