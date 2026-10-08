import { MidiMapping } from '../MidiMapping.js';
import { MidiScheduler } from '../MidiScheduler.js';
import { isMidiFlagTriggerType } from '../MidiFlagTriggers.js';
import { getAppContext } from '../../core/dependencies.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../../util/performanceInstrumentation.js';
import {
  MAX_ARP_STATE_ENTRIES,
  MAX_EVENTS_PER_TICK,
  MAX_MIDI_MESSAGES_PER_SECOND,
  MAX_REPEAT_HISTORY_KEYS
} from './MidiEventRouterShared.js';

const midiEventRouterLifecycleMethods = {
  setCapture(capture = null) { this.scheduler.setCapture?.(capture); },

  getEventPlaybackState(event) {
    const base = this.mapping.config?.sfx?.[event?.sfxId];
    const mapping = event?.triggerType != null ? { ...base, ...this.mapping.config?.triggers?.[event.triggerType] } : base;
    const key = this._resolveArpKey(event, mapping);
    const state = this._arpStateBySfx.get(key);
    return { nextIndex: state ? state.index % Math.max(1, state.length) : 0, direction: state?.dir ?? 1,
      ...(mapping?.clipSequence ? { eventCount: state?.index || 0, passCount: state?.pass || 1, completedPasses: state?.completedPasses || 0, triggerBar: state?.bar || 1 } : {}) };
  },

  setMapping(mapping) {
    this.mapping = mapping instanceof MidiMapping ? mapping : new MidiMapping(mapping || {});
    this.scheduler.setConfig(this.mapping.config);
  },

  setOutput(output) {
    this.scheduler.setOutput(output);
  },

  setOutputs(outputs) {
    this.scheduler.setOutputs?.(outputs);
  },

  resetClock({ preserveGamePhrases = false } = {}) {
    this._clockBaseMs = null; this._clockFrameMs = null; this._clockSpeedFactor = null;
    this._lastAcceptedBySfx.clear(); this._repeatHistoryByKey.clear();
    this.scheduler?.allNotesOff?.({ preserveGamePhrases });
    this.scheduler?.clearQueue?.({ preserveGamePhrases });
  },

  attach(soundBus, context = {}) {
    this._phraseTimer?.onGameTick?.off?.(this._boundPhraseTick);
    const nextTimer = context?.game?.getGameTimer?.() || soundBus?.gameTimer || null;
    if (this._phraseTimer !== nextTimer || this.soundBus !== soundBus) {
      this.resetClock();
      this.scheduler.gamePhrases?.clear();
      this._arpStateBySfx.clear();
      this._lastTickBySfx.clear();
    }
    this._phraseTimer = nextTimer;
    this._phraseTimer?.onGameTick?.on?.(this._boundPhraseTick);
    if (this.soundBus?.onEvent) {
      this.soundBus.onEvent.off(this._boundOnEvent);
    }
    this.soundBus = soundBus;
    this.context = context || {};
    this.soundBus?.onEvent?.on(this._boundOnEvent);
  },

  detach() {
    this._arpStateBySfx.clear();
    this._lastTickBySfx.clear();
    this._phraseTimer?.onGameTick?.off?.(this._boundPhraseTick);
    this._phraseTimer = null;
    this.scheduler.gamePhrases?.clear();
    if (this.soundBus?.onEvent) {
      this.soundBus.onEvent.off(this._boundOnEvent);
    }
    this.soundBus = null;
  },

  _hasTickBudget(tick, laneIndex = 0, laneCount = 1, consume = false) {
    if (tick == null) return true;
    if (this._tickCounter.tick !== tick) {
      this._tickCounter = { tick, count: 0 };
      this._tickLaneCounts.clear();
    }
    const maximum = Math.min(Math.max(this.mapping.config?.limits?.maxEventsPerTick ?? MAX_EVENTS_PER_TICK, 1), MAX_EVENTS_PER_TICK);
    const lanes = Math.max(1, Math.min(1024, Math.trunc(Number(laneCount) || 1)));
    const lane = Math.max(0, Math.min(lanes - 1, Math.trunc(Number(laneIndex) || 0)));
    const share = Math.ceil(maximum / lanes);
    const available = this._tickCounter.count < maximum && (this._tickLaneCounts.get(lane) || 0) < share;
    if (available && consume) {
      this._tickCounter.count += 1;
      this._tickLaneCounts.set(lane, (this._tickLaneCounts.get(lane) || 0) + 1);
    }
    return available;
  },

  _tickMsFromEvent(event) {
    if (Number.isFinite(event?.tps) && event.tps > 0) return 1000 / event.tps;
    if (Number.isFinite(event?.frameMs) && event.frameMs > 0) return event.frameMs;
    const timer = this.context?.game?.getGameTimer?.();
    if (Number.isFinite(timer?.frameTime) && timer.frameTime > 0) {
      return timer.frameTime;
    }
    return 60;
  },

  _densityForEvent(event) {
    const windowTicks = this.mapping.config?.density?.windowTicks ?? 0;
    if (!windowTicks || event?.tick == null || event?.sfxId == null) return 0;
    const last = this._lastTickBySfx.get(event.sfxId);
    if (last == null) return 0;
    const delta = event.tick - last;
    if (delta <= 0) return 1;
    if (delta >= windowTicks) return 0;
    return (windowTicks - delta) / windowTicks;
  },

  _nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  },

  _resolveScheduleBase(eventTimeMs, frameMs, speedFactor) {
    if (!Number.isFinite(eventTimeMs)) return null;
    const frameChanged = Number.isFinite(frameMs) &&
        this._clockFrameMs != null &&
        Math.abs(frameMs - this._clockFrameMs) > 0.001;
    const speedChanged = Number.isFinite(speedFactor) &&
        this._clockSpeedFactor != null &&
        speedFactor !== this._clockSpeedFactor;
    if (frameChanged || speedChanged) {
      this._clockBaseMs = null;
      this._lastAcceptedBySfx.clear();
      for (const [key, state] of this._arpStateBySfx) if (state.completedPasses == null) this._arpStateBySfx.delete(key);
      this._repeatHistoryByKey.clear();
      this.scheduler?.allNotesOff?.({ preserveGamePhrases: true, preserveRateHistory: true });
      this.scheduler?.clearQueue?.({ preserveGamePhrases: true, preserveRateHistory: true });
    }
    if (this._clockBaseMs == null) {
      this._clockBaseMs = this._nowMs() - eventTimeMs;
    }
    if (Number.isFinite(frameMs)) this._clockFrameMs = frameMs;
    if (Number.isFinite(speedFactor)) this._clockSpeedFactor = speedFactor;
    return this._clockBaseMs;
  },

  _getEventPriority(event, sfx) {
    if (Number.isFinite(sfx?.priority)) return sfx.priority;
    const priorityList = this.mapping.config?.limits?.prioritySfx || [];
    if (priorityList.includes(event?.sfxId)) return 2;
    return 1;
  },

  _captureBeatFields(tick) {
    if (!this.scheduler._captureEnabled?.()) return {};
    const base = this.mapping.config?.timing?.bpmBase;
    const tempoBpm = Math.max(20, Number.isFinite(base) ? base : 120);
    const frame = this._phraseTimer?.TIME_PER_FRAME_MS ?? this.context?.game?.getGameTimer?.()?.TIME_PER_FRAME_MS;
    const baseTickMs = Number.isFinite(frame) && frame > 0 ? frame : 60;
    const beat = Number.isFinite(tick) ? Math.max(0, tick) * baseTickMs / 60000 * tempoBpm : null;
    return { tick, tempoBpm, baseTickMs, beat: Number.isFinite(beat) ? beat : null, beatClock: 'simulation-base-ticks' };
  },

  _getBpm() {
    const base = this.mapping.config?.timing?.bpmBase ?? 120;
    const speed = this.context?.game?.getGameTimer?.()?.speedFactor ?? 1;
    return Math.max(20, base * speed);
  },

  _resolveArpKey(event, sfx) {
    if (sfx?.clipSequence && event?.triggerType != null) return `clip:${event.triggerType}:${event.sfxId}`;
    if (event?.triggerType != null && sfx?.arp?.independent) {
      const objectId = Number.isFinite(event.objectId) ? event.objectId : null;
      if (objectId != null) {
        return `trigger:${event.triggerType}:${event.sfxId}:object:${objectId}`;
      }
      const lemmingId = Number.isFinite(event.lemmingId) ? event.lemmingId : null;
      if (lemmingId != null) {
        return `trigger:${event.triggerType}:${event.sfxId}:lemming:${lemmingId}`;
      }
      const x = Number.isFinite(event.x) ? Math.round(event.x) : 'x';
      const y = Number.isFinite(event.y) ? Math.round(event.y) : 'y';
      return `trigger:${event.triggerType}:${event.sfxId}:${x}:${y}`;
    }
    return `sfx:${event?.sfxId ?? 'unknown'}`;
  },

  _storeArpState(key, state) {
    if (!key) return;
    if (this._arpStateBySfx.has(key)) {
      this._arpStateBySfx.delete(key);
    }
    this._arpStateBySfx.set(key, state);
    while (this._arpStateBySfx.size > MAX_ARP_STATE_ENTRIES) {
      const oldestKey = this._arpStateBySfx.keys().next().value;
      if (oldestKey == null) break;
      this._arpStateBySfx.delete(oldestKey);
    }
  },

  _storeRepeatHistory(key, history) {
    if (!key) return;
    if (this._repeatHistoryByKey.has(key)) {
      this._repeatHistoryByKey.delete(key);
    }
    this._repeatHistoryByKey.set(key, history);
    while (this._repeatHistoryByKey.size > MAX_REPEAT_HISTORY_KEYS) {
      const oldestKey = this._repeatHistoryByKey.keys().next().value;
      if (oldestKey == null) break;
      this._repeatHistoryByKey.delete(oldestKey);
    }
  },
};

export { midiEventRouterLifecycleMethods };
