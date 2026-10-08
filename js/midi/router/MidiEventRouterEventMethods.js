import { clipCellEnabled, buildMidiClipPhrase, applyMidiClipTransforms, getMidiTransportBar } from '../project/MidiClipPlayback.js';
import { MidiMapping } from '../MidiMapping.js';
import { MidiScheduler } from '../MidiScheduler.js';
import { isMidiFlagTriggerType } from '../MidiFlagTriggers.js';
import { getAppContext } from '../../core/dependencies.js';
import { SoundEffectIds } from '../../game/SoundEvents.js';
import { quantizeToScale, resolveScale } from '../midi-mapping/MidiMappingDomain.js';
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
      if ((event.sfxId === SoundEffectIds.SPAWN || event.sfxId === SoundEffectIds.LAND) && !this.mapping.getSfxConfig(event.sfxId)) return;
      if (event.reverse || (Number.isInteger(event.tick) && this._tickCounter.tick != null && event.tick < this._tickCounter.tick)) {
        this.musicTension.reset(); this._releaseTensionVoices();
        this.scheduler.gamePhrases?.clear();
        this._arpStateBySfx.clear();
      }
      if (typeof this.scheduler.hasAnyOutput === 'function') {
        if (!this.scheduler.hasAnyOutput()) return;
      } else if (!this.scheduler.output) {
        return;
      }
      const now = this._nowMs();
      const tick = event.tick;
      const capturing = this.scheduler._captureEnabled?.();
      const game = capturing ? this.context?.game : null;
      const origin = capturing ? { origin: event.origin ?? (game?.laneCount ? 'procgen' : 'level'),
        seed: event.seed ?? game?.seed, generation: event.generation ?? game?.generation,
        generationStartTick: game?.generationStartTick, laneSeed: game?.laneSeeds?.[event.laneIndex ?? 0],
        themeId: game?.terrain?.laneThemes?.[event.laneIndex ?? 0], originId: game?.terrain?.recipe?.id,
        levelId: event.levelId ?? game?.level?.id ?? game?.level?.name ?? null } : null;
      const requestId = capturing ? this.scheduler._observe?.('request', { ...origin, type: 'event', sfxId: event.sfxId,
        eventType: event.type, tick, gameTimeMs: event.timeMs, speed: event.speedFactor, frameMs: event.frameMs,
        laneIndex: event.laneIndex ?? 0, laneCount: event.laneCount ?? 1, lemmingId: event.lemmingId,
        ...this._captureBeatFields(tick) }) : null;

      const limits = this.mapping.config?.limits || {};
      const maxPerTick = Math.min(Math.max(limits.maxEventsPerTick ?? MAX_EVENTS_PER_TICK, 1), MAX_EVENTS_PER_TICK);
      if (!this._hasTickBudget(tick, event.laneIndex, event.laneCount)) {
        this.scheduler.recordThrottle?.('tick-limit', now, { requestId, tick, laneIndex: event.laneIndex ?? 0, laneCount: event.laneCount ?? 1, lemmingId: event.lemmingId });
        return;
      }
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
      let spec = this.mapping.mapEvent(event, context, density, sfx);
      if (!spec) { this.scheduler._observe?.('drop', { requestId, type: 'event', reason: 'mapping-filtered', tick, laneIndex: event.laneIndex ?? 0 }); return; }
      if (typeof this.scheduler.hasOutput === 'function' && !this.scheduler.hasOutput(spec.outputId ?? null)) {
        return;
      }
      spec.reverse = !!event.reverse;
      if (event.tick != null) {
        this._lastTickBySfx.set(event.sfxId, event.tick);
      }
      const priority = spec.priority ?? this._getEventPriority(event, sfx);
      const meta = {
        ...origin, requestId, tick, speed: event.speedFactor, frameMs: event.frameMs, ...this._captureBeatFields(tick),
        sfxId: event.sfxId,
        eventType: event.type,
        priority,
        triggerType: event.triggerType ?? null,
        trackId: spec.trackId ?? null,
        voiceBudget: spec.voiceBudget ?? null,
        outputId: spec.outputId ?? null,
        laneIndex: event.laneIndex ?? 0,
        laneCount: event.laneCount ?? 1,
        lemmingId: event.lemmingId ?? null
      };
      const scheduleAhead = this.mapping.config?.timing?.scheduleAheadMs ?? 0;
      const base = this._resolveScheduleBase(event.timeMs, event.frameMs, event.speedFactor);
      const rawTime = Number.isFinite(event.timeMs) && base != null ? base + event.timeMs : now;
      const sendTimeMs = Math.max(rawTime, now + scheduleAhead);
      if (capturing) meta.intendedMs = rawTime;
      let noteList;
      if (Array.isArray(spec.notes) && spec.notes.length) {
        noteList = spec.notes;
      } else {
        this._singleNoteBuffer[0] = spec.note;
        noteList = this._singleNoteBuffer;
      }

      if (sfx.clipSequence?.steps?.length) {
        const sequence = sfx.clipSequence, length = sequence.steps.length;
        const key = this._resolveArpKey(event, sfx), previous = this._arpStateBySfx.get(key);
        const count = previous?.seqKey === sequence.id ? previous.index : 0;
        const completedPasses = previous?.seqKey === sequence.id ? previous.completedPasses || 0 : 0;
        const pass = sequence.advance === 'event' ? Math.floor(count / length) + 1 : sequence.passCounter === 'completed' ? completedPasses + 1 : count + 1;
        const timer = this._phraseTimer || this.context?.game?.getGameTimer?.();
        const bar = getMidiTransportBar(this.mapping.config?.timing, event.tick ?? timer?.getGameTicks?.(), timer?.TIME_PER_FRAME_MS || 60);
        this._storeArpState(key, { index: count + 1, dir: 1, length, seqKey: sequence.id, completedPasses, pass, bar, advance: sequence.advance });
        const mapStep = step => this.mapping.mapEvent(event, context, density, { ...sfx, note: step.note, notes: null,
          velocity: step.velocity, durationTicks: step.durationTicks, arp: null, phrase: null });
        if (sequence.advance === 'game-tick') {
          const cells = buildMidiClipPhrase(sequence, count + 1, pass, mapStep, bar);
          this._queueGameEventClip(event, spec, meta, cells, sequence.spacingTicks, () => {
            const state = this._arpStateBySfx.get(key);
            if (state?.seqKey === sequence.id && state.advance === 'game-tick') state.completedPasses += 1;
          });
          return;
        }
        const index = count % length, step = sequence.steps[index];
        if (!clipCellEnabled(sequence, step, count + 1, pass, bar)) return;
        spec = { ...mapStep(applyMidiClipTransforms(step, count + 1, pass, bar)), reverse: !!event.reverse, stepIndex: index, stepCount: length };
        noteList = [spec.note];
      }

      const fire = !sfx.clipSequence && event.type === 'lemming-fire';
      if (fire && !event.reverse) {
        const key = `fire:${event.sfxId}`;
        const previous = this._arpStateBySfx.get(key);
        const delta = event.tick - (previous?.tick ?? -Infinity);
        const window = Math.max(1, this.mapping.config?.density?.windowTicks ?? 24);
        const index = previous && delta >= 0 && delta < window
          ? (previous.index < 7 ? previous.index + 1 : 6) : 0;
        const step = index < 6 ? index : 6 + index % 2;
        const globalRange = this.mapping.config.noteRange;
        const roleRange = this.mapping.config.ensemble?.roles.find(role => role.id === spec.ensembleRole)?.register;
        const range = { min: Math.max(globalRange.min, roleRange?.min ?? globalRange.min), max: Math.min(globalRange.max, roleRange?.max ?? globalRange.max) };
        const scale = resolveScale(this.mapping.config.scale);
        const top = Math.min(127, range.max);
        const base = Math.max(range.min, Math.min(noteList[0], top - 21));
        const pitch = Math.max(range.min, Math.min(top, quantizeToScale(base + step * 3, scale)));
        noteList = [pitch];
        this._storeArpState(key, { tick: event.tick, index });
      }
      const arp = fire ? null : spec.arp;
      if (spec.phrase?.enabled && !fire && event.type !== 'bomber-countdown') {
        this._queueGameEventPhrase(event, spec, meta, noteList);
        return;
      }
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
      specWithTime = this._applyMusicTension(specWithTime, meta, tick);
      if (!specWithTime) return;
      const plan = this._planEntries(specWithTime, sendTimeMs, activeNotes.length);
      if (!this._shouldSend(meta, specWithTime, plan, now)) {
        this.scheduler.recordThrottle?.(this._lastRateReport?.reason || 'count-limit', now, meta);
        return;
      }
      this._hasTickBudget(tick, event.laneIndex, event.laneCount, true);
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
