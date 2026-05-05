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
  setMapping(mapping) {
    this.mapping = mapping instanceof MidiMapping ? mapping : new MidiMapping(mapping || {});
    this.scheduler.setConfig(this.mapping.config);
  },

  setOutput(output) {
    this.scheduler.setOutput(output);
  },

  attach(soundBus, context = {}) {
    if (this.soundBus?.onEvent) {
      this.soundBus.onEvent.off(this._boundOnEvent);
    }
    this.soundBus = soundBus;
    this.context = context || {};
    this.soundBus?.onEvent?.on(this._boundOnEvent);
  },

  detach() {
    if (this.soundBus?.onEvent) {
      this.soundBus.onEvent.off(this._boundOnEvent);
    }
    this.soundBus = null;
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
      this._arpStateBySfx.clear();
      this._repeatHistoryByKey.clear();
      this.scheduler?.allNotesOff?.();
      this.scheduler?.clearQueue?.();
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

  _getBpm() {
    const base = this.mapping.config?.timing?.bpmBase ?? 120;
    const speed = this.context?.game?.getGameTimer?.()?.speedFactor ?? 1;
    return Math.max(20, base * speed);
  },

  _resolveArpKey(event, sfx) {
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
