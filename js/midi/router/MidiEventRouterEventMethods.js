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

const midiEventRouterEventMethods = {
  _onEvent(event) {
    const app = this.context?.app || getAppContext();
    const perfEnabled = !!app &&
        (app.performanceAPI === true || app.perfMetrics === true) &&
        canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      if (!event || event.sfxId == null) return;
      if (!this.mapping.config?.enabled) return;
      if (typeof this.scheduler.hasAnyOutput === 'function') {
        if (!this.scheduler.hasAnyOutput()) return;
      } else if (!this.scheduler.output) {
        return;
      }
      const now = this._nowMs();
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
      const baseSfx = this.mapping.getSfxConfig(event.sfxId) || {};
      const triggerCfg = event?.triggerType != null
        ? this.mapping.config?.triggers?.[String(event.triggerType)] || null
        : null;
      if (isMidiFlagTriggerType(event?.triggerType) && !triggerCfg) {
        return;
      }
      const sfx = triggerCfg ? { ...baseSfx, ...triggerCfg } : baseSfx;
      const spec = this.mapping.mapEvent(event, context, density, sfx);
      if (!spec) return;
      if (typeof this.scheduler.hasOutput === 'function' && !this.scheduler.hasOutput(spec.outputId ?? null)) {
        return;
      }
      spec.reverse = !!event.reverse;
      if (tick != null && this._tickCounter.count >= maxPerTick) return;
      if (tick != null) {
        this._tickCounter.count += 1;
      }
      if (event.tick != null) {
        this._lastTickBySfx.set(event.sfxId, event.tick);
      }
      const priority = this._getEventPriority(event, sfx);
      const meta = {
        sfxId: event.sfxId,
        eventType: event.type,
        priority,
        triggerType: event.triggerType ?? null,
        trackId: spec.trackId ?? null,
        outputId: spec.outputId ?? null
      };
      const scheduleAhead = this.mapping.config?.timing?.scheduleAheadMs ?? 0;
      const base = this._resolveScheduleBase(event.timeMs, event.frameMs, event.speedFactor);
      const rawTime = Number.isFinite(event.timeMs) && base != null ? base + event.timeMs : now;
      const sendTimeMs = Math.max(rawTime, now + scheduleAhead);
      let noteList;
      if (Array.isArray(spec.notes) && spec.notes.length) {
        noteList = spec.notes;
      } else {
        this._singleNoteBuffer[0] = spec.note;
        noteList = this._singleNoteBuffer;
      }

      const arp = spec.arp;
      let activeNotes = noteList;
      if (arp?.enabled && noteList.length) {
        const sorted = this._arpNotesScratch;
        sorted.length = 0;
        for (let i = 0; i < noteList.length; i += 1) {
          sorted.push(noteList[i]);
        }
        sorted.sort((a, b) => a - b);
        const length = Math.max(1, Math.min(arp.length ?? sorted.length, sorted.length));
        let seqKey = '';
        for (let i = 0; i < length; i += 1) {
          seqKey += i === 0 ? String(sorted[i]) : `,${sorted[i]}`;
        }
        const patternSteps = this._arpPatternScratch;
        patternSteps.length = 0;
        if (Array.isArray(arp?.pattern?.steps)) {
          for (const rawStep of arp.pattern.steps) {
            const step = String(rawStep || '').trim().toLowerCase();
            if (step === 'up' || step === 'down' || step === 'hold') {
              patternSteps.push(step);
            }
          }
        }
        const useCustomPattern = arp?.pattern?.preset === 'custom' && patternSteps.length > 0;
        const patternKey = useCustomPattern ? patternSteps.join(',') : '';
        const arpKey = this._resolveArpKey(event, sfx);
        const state = this._arpStateBySfx.get(arpKey) || {
          index: 0,
          dir: 1,
          mode: arp.mode,
          length,
          seqKey,
          patternKey,
          patternIndex: 0
        };
        if (
          state.mode !== arp.mode ||
            state.length !== length ||
            state.seqKey !== seqKey ||
            state.patternKey !== patternKey
        ) {
          state.index = 0;
          state.dir = 1;
          state.patternIndex = 0;
        }
        state.mode = arp.mode;
        state.length = length;
        state.seqKey = seqKey;
        state.patternKey = patternKey;
        let idx = state.index;
        if (idx >= length || idx < 0) idx = 0;
        if (length <= 1) {
          this._singleNoteBuffer[0] = sorted[0];
          activeNotes = this._singleNoteBuffer;
          state.index = 0;
          state.dir = 1;
          state.patternIndex = 0;
        } else if (useCustomPattern) {
          this._singleNoteBuffer[0] = sorted[idx];
          activeNotes = this._singleNoteBuffer;
          const step = patternSteps[state.patternIndex % patternSteps.length] || 'hold';
          let nextIdx = idx;
          if (step === 'up') {
            nextIdx = idx + 1;
          } else if (step === 'down') {
            nextIdx = idx - 1;
          }
          if (nextIdx >= length) {
            nextIdx = 0;
          } else if (nextIdx < 0) {
            nextIdx = length - 1;
          }
          state.index = nextIdx;
          state.patternIndex = (state.patternIndex + 1) % patternSteps.length;
        } else if (arp.mode === 'down') {
          this._singleNoteBuffer[0] = sorted[length - 1 - idx];
          activeNotes = this._singleNoteBuffer;
          state.index = idx + 1;
        } else if (arp.mode === 'updown') {
          this._singleNoteBuffer[0] = sorted[idx];
          activeNotes = this._singleNoteBuffer;
          if (idx + state.dir >= length || idx + state.dir < 0) {
            state.dir *= -1;
          }
          state.index = idx + state.dir;
        } else {
          this._singleNoteBuffer[0] = sorted[idx];
          activeNotes = this._singleNoteBuffer;
          state.index = idx + 1;
        }
        this._storeArpState(arpKey, state);
      }

      const repeatCfg = { ...(this.mapping.config?.repeat || {}), ...(sfx.repeat || {}) };
      const bpm = this._getBpm();
      const repeatKey = event?.triggerType != null
        ? `trigger:${event.triggerType}:${event.sfxId}`
        : `sfx:${event.sfxId}`;
      const repeatFactor = this._getRepeatFactor(repeatKey, sendTimeMs, repeatCfg, bpm);
      const hasAmount = Number.isFinite(repeatCfg.amount);
      const velocityBoost = hasAmount ? 0 : (repeatCfg.velocityBoost ?? 0);
      const durationBoost = hasAmount ? 0 : (repeatCfg.durationBoost ?? 0);
      const velocityScale = 1 + velocityBoost * repeatFactor;
      const durationScale = 1 + durationBoost * repeatFactor;
      let specWithTime = {
        ...spec,
        timeMs: sendTimeMs,
        velocity: Math.max(1, Math.min(127, Math.round((spec.velocity ?? 64) * velocityScale))),
        durationTicks: Math.max(1, Math.round((spec.durationTicks ?? 1) * durationScale))
      };
      if (hasAmount && repeatFactor > 0) {
        const adjusted = this._applyRepeatTarget(specWithTime, activeNotes, repeatCfg, repeatFactor);
        specWithTime = adjusted.spec;
        activeNotes = adjusted.activeNotes;
      }
      const plan = this._planEntries(specWithTime, sendTimeMs, activeNotes.length);
      if (!this._shouldSend(meta, specWithTime, plan, now)) {
        return;
      }
      for (const note of activeNotes) {
        specWithTime.note = note;
        this.scheduler.sendNote(specWithTime, meta);
      }
      this._lastAcceptedBySfx.set(event.sfxId, sendTimeMs);
    } finally {
      if (perfEnabled) {
        recordPerformanceMeasure('MidiEventRouter onEvent', {
          start: perfStart,
          detail: { devtools: { track: 'MidiEventRouter', trackGroup: 'MIDI', color: 'primary', tooltipText: 'onEvent' } }
        });
      }
    }
  },

  dispose() {
    this.detach();
    this.scheduler.dispose();
  },
};

export { midiEventRouterEventMethods };
