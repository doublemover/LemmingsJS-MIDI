import { MidiMapping } from './MidiMapping.js';
import { MidiScheduler } from './MidiScheduler.js';

const MAX_EVENTS_PER_TICK = 32;
// Cap note-on rate so note-off traffic fits MIDI 1.0 bandwidth.
const MAX_MIDI_EVENTS_PER_SECOND = 250;

class MidiEventRouter {
  constructor(mapping = null) {
    this.mapping = mapping instanceof MidiMapping ? mapping : new MidiMapping(mapping || {});
    this.scheduler = new MidiScheduler(this.mapping.config);
    this.soundBus = null;
    this.context = {};
    this._lastTickBySfx = new Map();
    this._tickCounter = { tick: null, count: 0 };
    this._rateLimit = { maxPerSecond: 0, tokens: 0, lastMs: 0 };
    this._boundOnEvent = this._onEvent.bind(this);
    this._resetRateLimit();
  }

  setMapping(mapping) {
    this.mapping = mapping instanceof MidiMapping ? mapping : new MidiMapping(mapping || {});
    this.scheduler.setConfig(this.mapping.config);
    this._resetRateLimit();
  }

  setOutput(output) {
    this.scheduler.setOutput(output);
  }

  attach(soundBus, context = {}) {
    if (this.soundBus?.onEvent) {
      this.soundBus.onEvent.off(this._boundOnEvent);
    }
    this.soundBus = soundBus;
    this.context = context || {};
    this._resetRateLimit();
    this.soundBus?.onEvent?.on(this._boundOnEvent);
  }

  detach() {
    if (this.soundBus?.onEvent) {
      this.soundBus.onEvent.off(this._boundOnEvent);
    }
    this.soundBus = null;
  }

  _tickMsFromEvent(event) {
    if (event?.tps) return 1000 / event.tps;
    if (event?.frameMs) return event.frameMs;
    const timer = this.context?.game?.getGameTimer?.();
    return timer?.frameTime ?? 60;
  }

  _densityForEvent(event) {
    const windowTicks = this.mapping.config?.density?.windowTicks ?? 0;
    if (!windowTicks || event?.tick == null || event?.sfxId == null) return 0;
    const last = this._lastTickBySfx.get(event.sfxId);
    if (last == null) return 0;
    const delta = event.tick - last;
    if (delta <= 0) return 1;
    if (delta >= windowTicks) return 0;
    return (windowTicks - delta) / windowTicks;
  }

  _nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  _resetRateLimit() {
    const limits = this.mapping.config?.limits || {};
    const maxPerSecond = limits.maxEventsPerSecond ?? MAX_MIDI_EVENTS_PER_SECOND;
    const capped = Math.min(Math.max(maxPerSecond, 1), MAX_MIDI_EVENTS_PER_SECOND);
    this._rateLimit.maxPerSecond = capped;
    this._rateLimit.tokens = capped;
    this._rateLimit.lastMs = this._nowMs();
  }

  _consumeRateToken() {
    const rate = this._rateLimit;
    const now = this._nowMs();
    const elapsedMs = Math.max(0, now - rate.lastMs);
    if (elapsedMs > 0) {
      rate.tokens = Math.min(rate.maxPerSecond, rate.tokens + (elapsedMs / 1000) * rate.maxPerSecond);
      rate.lastMs = now;
    }
    if (rate.tokens < 1) return false;
    rate.tokens -= 1;
    return true;
  }

  _onEvent(event) {
    if (!event || event.sfxId == null) return;
    if (!this.mapping.config?.enabled) return;
    if (!this.scheduler.output) return;
    const tick = event.tick;
    if (tick != null && this._tickCounter.tick !== tick) {
      this._tickCounter.tick = tick;
      this._tickCounter.count = 0;
    }
    const limits = this.mapping.config?.limits || {};
    const maxPerTick = Math.min(Math.max(limits.maxEventsPerTick ?? MAX_EVENTS_PER_TICK, 1), MAX_EVENTS_PER_TICK);
    const tickMs = this._tickMsFromEvent(event);
    this.scheduler.setTickMs(tickMs);
    const density = this._densityForEvent(event);
    const viewRect = this.context?.stage?.getGameViewRect?.() || null;
    const context = {
      levelWidth: this.context?.game?.level?.width ?? this.context?.level?.width ?? null,
      levelHeight: this.context?.game?.level?.height ?? this.context?.level?.height ?? null,
      viewRect
    };
    const spec = this.mapping.mapEvent(event, context, density);
    if (!spec) return;
    if (tick != null && this._tickCounter.count >= maxPerTick) return;
    if (!this._consumeRateToken()) return;
    if (tick != null) {
      this._tickCounter.count += 1;
    }
    if (event.tick != null) {
      this._lastTickBySfx.set(event.sfxId, event.tick);
    }
    this.scheduler.sendNote(spec);
  }

  dispose() {
    this.detach();
    this.scheduler.dispose();
  }
}

export { MidiEventRouter };
