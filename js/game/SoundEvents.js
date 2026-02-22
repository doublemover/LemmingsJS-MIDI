import { EventHandler } from '../util/EventHandler.js';
import { getAppContext } from '../core/dependencies.js';

const canMeasurePerformance = () => (typeof performance !== 'undefined' &&
  typeof performance.now === 'function' &&
  typeof performance.measure === 'function');

const EMIT_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'SoundEvents',
    trackGroup: 'Game State',
    color: 'secondary',
    tooltipText: 'emit'
  })
});

const SoundEventTypes = Object.freeze({
  LEVEL_START: 'level-start',
  ENTRANCE_OPEN: 'entrance-open',
  SKILL_SELECT: 'skill-select',
  SKILL_ASSIGN: 'skill-assign',
  BUILDER_STEP: 'builder-step',
  BUILDER_WARNING: 'builder-warning',
  STEEL_HIT: 'steel-hit',
  LEMMING_OHNO: 'lemming-ohno',
  LEMMING_EXPLODE: 'lemming-explode',
  LEMMING_SPLAT: 'lemming-splat',
  LEMMING_EXIT: 'lemming-exit',
  LEMMING_DROWN: 'lemming-drown',
  LEMMING_FIRE: 'lemming-fire',
  LEMMING_FELL_OFF: 'lemming-fell-off',
  LEMMING_BASH: 'lemming-bash',
  LEMMING_DIG: 'lemming-dig',
  LEMMING_MINE: 'lemming-mine',
  TRAP_TRIGGER: 'trap-trigger'
});

const SoundEffectIds = Object.freeze({
  NONE: 0x00,
  SKILL_SELECT: 0x01,
  ENTRANCE_OPEN: 0x02,
  LEVEL_START: 0x03,
  SKILL_ASSIGN: 0x04,
  OHNO: 0x05,
  TRAP_ZAP: 0x06,
  TRAP_SQUISH: 0x07,
  SPLAT: 0x08,
  TRAP_SLICER: 0x09,
  STEEL_HIT: 0x0A,
  UNKNOWN_0B: 0x0B,
  EXPLOSION: 0x0C,
  TRAP_FIRE: 0x0D,
  TRAP_TEN_TON: 0x0E,
  TRAP_BEAR: 0x0F,
  EXIT: 0x10,
  DROWN: 0x11,
  BUILDER_WARNING: 0x12,
  FELL_OFF: 0x13,
  BUILDER_STEP: 0x14,
  BASH: 0x15,
  DIG: 0x16,
  MINE: 0x17
});

class SoundEventBus {
  constructor(gameTimer) {
    this.gameTimer = gameTimer;
    this.onEvent = new EventHandler();
    this._queue = [];
    this._queueLimit = 2048;
    this._sequence = 0;
    this.history = null;
  }

  emit(event) {
    const app = getAppContext();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      if (!event) return;
      const handlers = this.onEvent?.handlers || null;
      const hasListeners = !!handlers && handlers.size > 0;
      const hasHistory = !!this.history?.recordSoundEvent;
      const queueLimit = this._queueLimit | 0;
      const queue = this._queue;
      const queueLen = queue.length;
      const queueOpen = queueLimit > 0 && queueLen < queueLimit;

      if (!hasListeners && !hasHistory && !queueOpen) {
        return;
      }

      const timer = this.gameTimer;
      const tick = timer?.getGameTicks?.() ?? 0;
      const frameMs = timer?.frameTime ?? timer?.TIME_PER_FRAME_MS ?? 60;
      const payload = {
        id: this._sequence + 1,
        tick,
        timeMs: tick * frameMs,
        frameMs,
        speedFactor: timer?.speedFactor ?? 1,
        tps: timer?.tps ?? null
      };
      this._sequence += 1;

      for (const key in event) {
        if (!Object.prototype.hasOwnProperty.call(event, key)) continue;
        payload[key] = event[key];
      }

      if (queueOpen) {
        queue.push(payload);
      }
      this.history?.recordSoundEvent?.(payload);
      if (this.onEvent) this.onEvent.trigger(payload);
    } finally {
      if (perfEnabled) {
        try {
          performance.measure('SoundEventBus emit', {
            start: perfStart,
            detail: EMIT_MEASURE_DETAIL
          });
        } catch {
          /* ignored */
        }
      }
    }
  }

  emitSfx(type, sfxId, data = {}) {
    this.emit({ type, sfxId, ...data });
  }

  flush() {
    const out = this._queue;
    this._queue = [];
    return out;
  }

  setHistoryStore(history) {
    this.history = history;
  }

  dispose() {
    if (this.onEvent?.dispose) this.onEvent.dispose();
    this.onEvent = null;
    this._queue = [];
    this.gameTimer = null;
    this.history = null;
  }
}

const getSoundBus = () => {
  const app = getAppContext();
  if (app?.game?.soundEvents) {
    return app.game.soundEvents;
  }
  return null;
};

export { SoundEventTypes, SoundEffectIds, SoundEventBus, getSoundBus };
