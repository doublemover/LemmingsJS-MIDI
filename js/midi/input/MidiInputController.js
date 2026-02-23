import { CommandSelectSkill } from '../../commands/CommandSelectSkill.js';
import { SkillTypes } from '../../game/SkillTypes.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeInputChannel = (channel) => {
  if (typeof channel === 'number' && Number.isFinite(channel)) {
    return clamp(channel | 0, 1, 16);
  }
  const normalized = String(channel ?? 'omni').trim().toLowerCase();
  if (!normalized || normalized === 'omni') return 'omni';
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return clamp(Math.trunc(numeric), 1, 16);
  }
  return normalized;
};

const scaleValue = (value, min, max) => {
  const t = clamp(value / 127, 0, 1);
  return min + (max - min) * t;
};

/**
 * Translate live MIDI input events into gameplay and MIDI-config intents.
 */
class MidiInputController {
  constructor(view, { getConfig, onConfigChange } = {}) {
    this.view = view;
    this.getConfig = typeof getConfig === 'function' ? getConfig : () => view?.getMidiConfig?.();
    this.onConfigChange = typeof onConfigChange === 'function' ? onConfigChange : null;
    this.input = null;
    this.channel = 'omni';
    this._noteCapture = null;
    this._lastInputChannel = undefined;
    this._lastCcConfigRef = undefined;
    this._ccMappings = new Map();
    this._handler = this._onMessage.bind(this);
  }

  setConfig(config) {
    this._lastInputChannel = config?.input?.channel;
    this._lastCcConfigRef = config?.input?.cc;
    this.channel = normalizeInputChannel(this._lastInputChannel);
    this._buildCcMappingIndex(this._lastCcConfigRef);
  }

  /**
   * Index configured CC mappings by controller number to avoid per-message scans.
   * @param {object|null|undefined} ccConfig
   */
  _buildCcMappingIndex(ccConfig) {
    this._ccMappings.clear();
    if (!ccConfig || typeof ccConfig !== 'object') return;
    for (const [key, mapping] of Object.entries(ccConfig)) {
      const cc = Number.isFinite(mapping?.cc) ? Math.trunc(mapping.cc) : null;
      if (cc == null) continue;
      const list = this._ccMappings.get(cc) || [];
      list.push({ key, mapping });
      this._ccMappings.set(cc, list);
    }
  }

  /**
   * Resolve cached CC mappings and self-heal stale entries when config objects
   * are mutated in place.
   * @param {number} ccNumber
   * @param {object|null|undefined} ccConfig
   * @returns {Array<{key:string,mapping:object}>}
   */
  _resolveCcEntries(ccNumber, ccConfig) {
    if (!ccConfig || typeof ccConfig !== 'object') return [];
    let entries = this._ccMappings.get(ccNumber) || [];
    let hasStale = false;
    let validEntries = [];
    if (entries.length) {
      validEntries = entries.filter(({ key, mapping }) => {
        const currentMapping = ccConfig[key];
        const sameReference = currentMapping === mapping;
        const sameControllerNumber = Number.isFinite(currentMapping?.cc) &&
          Math.trunc(currentMapping.cc) === ccNumber;
        const valid = sameReference && sameControllerNumber;
        if (!valid) hasStale = true;
        return valid;
      });
    }
    if (hasStale) {
      this._buildCcMappingIndex(ccConfig);
      validEntries = this._ccMappings.get(ccNumber) || [];
    }
    if (validEntries.length) return validEntries;
    const scanned = [];
    for (const [key, mapping] of Object.entries(ccConfig)) {
      if (!Number.isFinite(mapping?.cc) || Math.trunc(mapping.cc) !== ccNumber) continue;
      scanned.push({ key, mapping });
    }
    if (scanned.length) {
      this._ccMappings.set(ccNumber, scanned);
    }
    return scanned;
  }

  /**
   * Track only config fields that affect input dispatch hot paths.
   * @param {object|null|undefined} config
   */
  _syncConfig(config) {
    const nextInputChannel = config?.input?.channel;
    const nextCcConfig = config?.input?.cc;
    if (
      nextInputChannel === this._lastInputChannel &&
      nextCcConfig === this._lastCcConfigRef
    ) {
      return;
    }
    this.setConfig(config);
  }

  attach(input) {
    if (this.input && this._handler) {
      this.input.removeListener('midimessage', this._handler);
    }
    this.input = input || null;
    if (this.input) {
      this.input.addListener('midimessage', this._handler);
    }
  }

  detach() {
    if (this.input && this._handler) {
      this.input.removeListener('midimessage', this._handler);
    }
    this.input = null;
  }

  setNoteCapture(handler) {
    this._noteCapture = typeof handler === 'function' ? handler : null;
  }

  _matchesChannel(channel) {
    if (this.channel === 'omni') return true;
    return channel === this.channel;
  }

  _applyConfigPatch(patch) {
    if (this.onConfigChange) {
      this.onConfigChange(patch);
      return;
    }
    if (this.view?.applyMidiOverrides) {
      this.view.applyMidiOverrides(patch);
    }
  }

  _setNested(target, path, value) {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!parts.length) return;
    let node = target;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!node[key] || typeof node[key] !== 'object') node[key] = {};
      node = node[key];
    }
    node[parts[parts.length - 1]] = value;
  }

  _restartLevel() {
    if (this.view?.moveToLevel) this.view.moveToLevel(0);
  }

  _pauseGame() {
    if (this.view?.suspend) this.view.suspend();
  }

  _resumeGame() {
    if (this.view?.continue) this.view.continue();
  }

  _setSpeedFactor(value) {
    const speed = clamp(value, 0.1, 120);
    if (this.view?.selectSpeedFactor) {
      this.view.selectSpeedFactor(speed);
    } else if (this.view?.gameSpeedFactor != null) {
      this.view.gameSpeedFactor = speed;
    }
  }

  _changeSpeed(delta) {
    const current = this.view?.game?.getGameTimer?.()?.speedFactor ?? this.view?.gameSpeedFactor ?? 1;
    this._setSpeedFactor(current + delta);
  }

  _handleTransport(status, config) {
    const transport = config?.input?.transport || {};
    const action = status === 0xFA
      ? transport.start
      : (status === 0xFB ? transport.continue : transport.stop);
    if (action === 'restart') this._restartLevel();
    if (action === 'pause') this._pauseGame();
    if (action === 'resume') this._resumeGame();
  }

  _handleNoteOn(note, velocity, config, channel) {
    if (velocity === 0) return;
    if (this._noteCapture) {
      const handled = this._noteCapture(note, velocity, channel);
      if (handled) return;
    }
    const notesCfg = config?.input?.notes || {};
    const skillBase = notesCfg.skillBase ?? 60;
    const skillOrder = notesCfg.skillOrder || [];
    const skillIdx = note - skillBase;
    if (skillIdx >= 0 && skillIdx < skillOrder.length) {
      const key = skillOrder[skillIdx];
      const skill = SkillTypes[key];
      if (skill != null && this.view?.game?.queueCommand) {
        this.view.game.queueCommand(new CommandSelectSkill(skill));
        if (this.view.game.gameGui) this.view.game.gameGui.skillSelectionChanged = true;
      }
      return;
    }

    const actions = notesCfg.actions || {};
    const match = Object.entries(actions).find(([, mapped]) => mapped === note);
    if (!match) return;
    const action = match[0];
    if (action === 'pause') this._pauseGame();
    if (action === 'resume') this._resumeGame();
    if (action === 'restart') this._restartLevel();
    if (action === 'speedDown') this._changeSpeed(-1);
    if (action === 'speedUp') this._changeSpeed(1);
    if (action === 'speedReset') this._setSpeedFactor(1);
    if (action === 'toggleMidi' && this.view?.setMidiEnabled) {
      this.view.setMidiEnabled(!this.view.midiEnabled);
    }
    if (action === 'toggleViewPan') {
      const current = this.getConfig?.()?.position?.viewPan ?? false;
      this._applyConfigPatch({ position: { viewPan: !current } });
    }
  }

  _handleControlChange(cc, value, config) {
    const ccNumber = Math.trunc(cc);
    const nextCcConfig = config?.input?.cc;
    if (nextCcConfig && nextCcConfig !== this._lastCcConfigRef) {
      this._lastCcConfigRef = nextCcConfig;
      this._buildCcMappingIndex(nextCcConfig);
    }
    const entries = this._resolveCcEntries(ccNumber, nextCcConfig);
    if (!entries || !entries.length) return;
    for (const { key, mapping } of entries) {
      if (key === 'speed') {
        const min = mapping.min ?? 0.1;
        const max = mapping.max ?? 8;
        this._setSpeedFactor(scaleValue(value, min, max));
      } else if (key === 'bpmBase') {
        const min = mapping.min ?? 60;
        const max = mapping.max ?? 200;
        const bpm = Math.round(scaleValue(value, min, max));
        this._applyConfigPatch({ timing: { bpmBase: bpm } });
      } else if (key === 'intensity') {
        const min = mapping.min ?? 10;
        const max = mapping.max ?? 127;
        const intensity = Math.round(scaleValue(value, min, max));
        this._applyConfigPatch({ velocityRange: { default: intensity } });
      } else if (key === 'accent') {
        const min = mapping.min ?? 0;
        const max = mapping.max ?? 1;
        const boost = scaleValue(value, min, max);
        this._applyConfigPatch({ density: { velocityBoost: boost } });
      } else if (mapping?.target) {
        const patch = {};
        let finalValue = null;
        if (Array.isArray(mapping.values) && mapping.values.length) {
          const index = Math.round((value / 127) * (mapping.values.length - 1));
          const bounded = Math.max(0, Math.min(mapping.values.length - 1, index));
          finalValue = mapping.values[bounded];
        } else {
          const min = mapping.min ?? 0;
          const max = mapping.max ?? 1;
          const mapped = scaleValue(value, min, max);
          finalValue = mapping.round ? Math.round(mapped) : mapped;
        }
        const boolValue = mapping.toggle ? value >= 64 : finalValue;
        this._setNested(patch, mapping.target, boolValue);
        this._applyConfigPatch(patch);
      }
    }
  }

  _onMessage(event) {
    const config = this.getConfig?.() || {};
    this._syncConfig(config);
    const data = event?.data;
    if (!data || data.length === 0) return;
    if (typeof window !== 'undefined') {
      window.lastMidiInputMessage = Array.from(data);
    }
    const status = data[0];
    if (status >= 0xF8) {
      if (status === 0xFA || status === 0xFB || status === 0xFC) {
        this._handleTransport(status, config);
      }
      return;
    }
    const type = status & 0xF0;
    const channel = (status & 0x0F) + 1;
    if (!this._matchesChannel(channel)) return;
    if (type === 0x90 || type === 0x80) {
      const note = data[1];
      const velocity = data[2] ?? 0;
      if (type === 0x90) this._handleNoteOn(note, velocity, config, channel);
      return;
    }
    if (type === 0xB0) {
      const cc = data[1];
      const value = data[2] ?? 0;
      this._handleControlChange(cc, value, config);
    }
  }
}

export { MidiInputController };
