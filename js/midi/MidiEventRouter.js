import { MidiMapping } from './MidiMapping.js';
import { MidiScheduler } from './MidiScheduler.js';
import { isMidiFlagTriggerType } from './MidiFlagTriggers.js';
import { getAppContext } from '../core/dependencies.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../util/performanceInstrumentation.js';

const MAX_EVENTS_PER_TICK = 32;
const MAX_MIDI_MESSAGES_PER_SECOND = 1000;
const MAX_ARP_STATE_ENTRIES = 256;
const MAX_REPEAT_HISTORY_KEYS = 512;

class MidiEventRouter {
  constructor(mapping = null) {
    this.mapping = mapping instanceof MidiMapping ? mapping : new MidiMapping(mapping || {});
    this.scheduler = new MidiScheduler(this.mapping.config);
    this.soundBus = null;
    this.context = {};
    this._lastTickBySfx = new Map();
    this._tickCounter = { tick: null, count: 0 };
    this._clockBaseMs = null;
    this._clockFrameMs = null;
    this._clockSpeedFactor = null;
    this._lastAcceptedBySfx = new Map();
    this._arpStateBySfx = new Map();
    this._repeatHistoryByKey = new Map();
    this._singleNoteBuffer = [0];
    this._arpNotesScratch = [];
    this._arpPatternScratch = [];
    this._lastRateReport = null;
    this._boundOnEvent = this._onEvent.bind(this);
  }

  setMapping(mapping) {
    this.mapping = mapping instanceof MidiMapping ? mapping : new MidiMapping(mapping || {});
    this.scheduler.setConfig(this.mapping.config);
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
    this.soundBus?.onEvent?.on(this._boundOnEvent);
  }

  detach() {
    if (this.soundBus?.onEvent) {
      this.soundBus.onEvent.off(this._boundOnEvent);
    }
    this.soundBus = null;
  }

  _tickMsFromEvent(event) {
    if (Number.isFinite(event?.tps) && event.tps > 0) return 1000 / event.tps;
    if (Number.isFinite(event?.frameMs) && event.frameMs > 0) return event.frameMs;
    const timer = this.context?.game?.getGameTimer?.();
    if (Number.isFinite(timer?.frameTime) && timer.frameTime > 0) {
      return timer.frameTime;
    }
    return 60;
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
  }

  _getEventPriority(event, sfx) {
    if (Number.isFinite(sfx?.priority)) return sfx.priority;
    const priorityList = this.mapping.config?.limits?.prioritySfx || [];
    if (priorityList.includes(event?.sfxId)) return 2;
    return 1;
  }

  _getBpm() {
    const base = this.mapping.config?.timing?.bpmBase ?? 120;
    const speed = this.context?.game?.getGameTimer?.()?.speedFactor ?? 1;
    return Math.max(20, base * speed);
  }

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
  }

  /**
   * Cache arpeggiator state with a bounded map to avoid unbounded growth when
   * independent trigger keys fan out over long sessions.
   * @param {string} key
   * @param {object} state
   */
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
  }

  /**
   * Cache repeat history with bounded key cardinality to prevent long-session
   * growth when many trigger identities are observed.
   * @param {string} key
   * @param {number[]} history
   */
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
  }

  _getRepeatFactor(key, timeMs, repeatCfg, bpm) {
    if (repeatCfg?.enabled === false) return 0;
    const maxRepeats = Math.max(0, repeatCfg.maxRepeats ?? 0);
    const windowBeats = repeatCfg.windowBeats ?? repeatCfg.spacingTicks ?? 0;
    if (maxRepeats <= 0 || !Number.isFinite(timeMs) || windowBeats <= 0 || bpm <= 0) {
      return 0;
    }
    const windowMs = (60000 / bpm) * windowBeats;
    const history = this._repeatHistoryByKey.get(key) || [];
    const cutoff = timeMs - windowMs;
    const nextHistory = history.filter(entry => entry >= cutoff);
    nextHistory.push(timeMs);
    const maxEntries = Math.max(1, maxRepeats + 1);
    if (nextHistory.length > maxEntries) {
      nextHistory.splice(0, nextHistory.length - maxEntries);
    }
    this._storeRepeatHistory(key, nextHistory);
    const repeatCount = Math.max(0, nextHistory.length - 1);
    return Math.min(repeatCount / maxRepeats, 1);
  }

  _applyRepeatTarget(spec, activeNotes, repeatCfg, repeatFactor) {
    if (!spec || repeatFactor <= 0) return { spec, activeNotes };
    const hasAmount = Number.isFinite(repeatCfg.amount);
    if (!hasAmount) return { spec, activeNotes };
    const amount = repeatCfg.amount;
    if (!amount) return { spec, activeNotes };
    const delta = amount * repeatFactor;
    const noteRange = this.mapping.config?.noteRange || { min: 0, max: 127 };
    const positionCfg = this.mapping.config?.position || {};
    const clampNote = value => Math.max(noteRange.min ?? 0, Math.min(noteRange.max ?? 127, value));
    const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
    const target = repeatCfg.target || 'velocity';
    const updated = { ...spec };
    let notes = activeNotes;

    switch (target) {
    case 'velocity':
    case 'accent': {
      const velocity = updated.velocity ?? 64;
      updated.velocity = clampValue(Math.round(velocity * (1 + delta)), 1, 127);
      return { spec: updated, activeNotes: notes };
    }
    case 'duration': {
      const duration = updated.durationTicks ?? 1;
      updated.durationTicks = Math.max(1, Math.round(duration * (1 + delta)));
      return { spec: updated, activeNotes: notes };
    }
    case 'note': {
      const noteDelta = Math.round(delta * 12);
      notes = notes.map(note => clampNote(note + noteDelta));
      updated.note = notes[0];
      updated.notes = notes;
      return { spec: updated, activeNotes: notes };
    }
    case 'timbre': {
      if (!Number.isFinite(updated.timbre)) return { spec: updated, activeNotes: notes };
      const tMin = positionCfg.timbreRange?.min ?? 0;
      const tMax = positionCfg.timbreRange?.max ?? 127;
      const range = tMax - tMin;
      updated.timbre = clampValue(updated.timbre + delta * range, tMin, tMax);
      return { spec: updated, activeNotes: notes };
    }
    case 'pan': {
      if (!Number.isFinite(updated.pan)) return { spec: updated, activeNotes: notes };
      const pMin = positionCfg.panRange?.min ?? -127;
      const pMax = positionCfg.panRange?.max ?? 127;
      const range = pMax - pMin;
      updated.pan = clampValue(updated.pan + delta * range, pMin, pMax);
      return { spec: updated, activeNotes: notes };
    }
    case 'pitchBend': {
      if (!Number.isFinite(updated.pitchBend)) return { spec: updated, activeNotes: notes };
      updated.pitchBend = clampValue(updated.pitchBend + delta, -1, 1);
      return { spec: updated, activeNotes: notes };
    }
    case 'attack':
    case 'decay': {
      const velocity = updated.velocity ?? 64;
      updated.velocity = clampValue(Math.round(velocity * (1 + delta)), 1, 127);
      return { spec: updated, activeNotes: notes };
    }
    case 'sustain': {
      const duration = updated.durationTicks ?? 1;
      updated.durationTicks = Math.max(1, Math.round(duration * (1 + delta)));
      return { spec: updated, activeNotes: notes };
    }
    case 'release': {
      const releaseVelocity = updated.releaseVelocity ?? updated.velocity ?? 64;
      updated.releaseVelocity = clampValue(Math.round(releaseVelocity * (1 + delta)), 1, 127);
      return { spec: updated, activeNotes: notes };
    }
    default:
      return { spec: updated, activeNotes: notes };
    }
  }

  _planEntries(spec, sendTimeMs, noteCount = 1) {
    const durationMs = Number.isFinite(spec.durationTicks) ? Math.max(0, spec.durationTicks * this.scheduler.tickMs) : 0;
    const offTimeMs = sendTimeMs + durationMs;
    const offMessages = durationMs > 0 ? (1 + (this.mapping.config?.mpe?.enabled ? 1 : 0)) : 0;
    const estimate = this.scheduler.estimateMessages(spec);
    const onMessages = Math.max(estimate.messages - offMessages, 0);
    const onBytes = onMessages * 3;
    const offBytes = offMessages * 3;
    return {
      on: { timeMs: sendTimeMs, count: onMessages * noteCount, bytes: onBytes * noteCount },
      off: { timeMs: offTimeMs, count: offMessages * noteCount, bytes: offBytes * noteCount }
    };
  }

  _shouldSend(meta, spec, plan, now) {
    const limits = this.mapping.config?.limits || {};
    const maxPerSecond = Math.min(Math.max(limits.maxEventsPerSecond ?? MAX_MIDI_MESSAGES_PER_SECOND, 1), MAX_MIDI_MESSAGES_PER_SECOND);
    const hardMaxPerSecond = Math.min(
      Math.max(limits.hardMaxEventsPerSecond ?? maxPerSecond, 1),
      MAX_MIDI_MESSAGES_PER_SECOND
    );
    const snapshot = this.scheduler.getRateSnapshot(now);
    const maxBytes = limits.maxBytesPerSecond ?? snapshot.maxBytesPerSecond;
    let shareReport = null;
    const getShareReport = () => {
      if (!shareReport) {
        shareReport = this.scheduler.getUsageShare('next', now);
      }
      return shareReport;
    };
    const windowEnd = now + 1000;
    let nextCount = snapshot.next.count;
    let nextBytes = snapshot.next.bytes;
    if (plan.on.timeMs >= now && plan.on.timeMs < windowEnd) {
      nextCount += plan.on.count;
      nextBytes += plan.on.bytes;
    }
    if (plan.off.timeMs >= now && plan.off.timeMs < windowEnd) {
      nextCount += plan.off.count;
      nextBytes += plan.off.bytes;
    }
    if (nextCount <= maxPerSecond && nextBytes <= maxBytes) {
      return true;
    }
    if (nextBytes > maxBytes) {
      this._lastRateReport = {
        timeMs: now,
        reason: 'byte-limit',
        snapshot: getShareReport()
      };
      return false;
    }
    if (nextCount > hardMaxPerSecond) {
      this._lastRateReport = {
        timeMs: now,
        reason: 'count-limit',
        snapshot: getShareReport()
      };
      return false;
    }
    const plannedCount = nextCount - snapshot.next.count;
    const plannedBytes = nextBytes - snapshot.next.bytes;
    const priority = meta.priority ?? 1;
    const bySfx = snapshot.next.bySfx;
    let higherCount = 0;
    let higherBytes = 0;
    let sameGroupCount = 0;
    let sameGroupBytes = 0;
    const samePriority = [];
    for (const [sfxId, entry] of bySfx.entries()) {
      const entryPriority = entry.priority ?? 1;
      if (entryPriority > priority) {
        higherCount += entry.count;
        higherBytes += entry.bytes;
      } else if (entryPriority === priority) {
        samePriority.push({ sfxId, count: entry.count, bytes: entry.bytes, priority: entryPriority });
        sameGroupCount += entry.count;
        sameGroupBytes += entry.bytes;
      }
    }
    const available = Math.max(0, maxPerSecond - higherCount);
    const availableBytes = Math.max(0, maxBytes - higherBytes);
    if (available <= 0) {
      this._lastRateReport = {
        timeMs: now,
        reason: 'priority-saturated',
        snapshot: getShareReport()
      };
      return false;
    }
    if (availableBytes <= 0) {
      this._lastRateReport = {
        timeMs: now,
        reason: 'byte-limit',
        snapshot: getShareReport()
      };
      return false;
    }

    shareReport = getShareReport();
    const sameGroup = shareReport.filter(entry => entry.priority === priority);
    const current = sameGroup.find(entry => entry.sfxId === meta.sfxId);
    const groupSize = sameGroup.length + (current ? 0 : 1);
    const evenShare = 1 / groupSize;
    const shareRatio = (current?.percentCount ?? evenShare) / evenShare;
    const projectedGroupCount = sameGroupCount + plannedCount;
    const projectedGroupBytes = sameGroupBytes + plannedBytes;
    const overCount = projectedGroupCount > available
      ? projectedGroupCount / Math.max(available, 1)
      : 1;
    const overBytes = projectedGroupBytes > availableBytes
      ? projectedGroupBytes / Math.max(availableBytes, 1)
      : 1;
    const overageFactor = Math.max(1, overCount, overBytes);
    const budgetCount = available / Math.max(groupSize, 1);
    const budgetBytes = availableBytes / Math.max(groupSize, 1);
    const projectedCount = (current?.count ?? 0) + plannedCount;
    const projectedBytes = (current?.bytes ?? 0) + plannedBytes;
    const overBudget = (budgetCount > 0 && projectedCount > budgetCount) ||
      (budgetBytes > 0 && projectedBytes > budgetBytes);
    const bpm = this._getBpm();
    const beatMs = 60000 / bpm;
    const spacingMs = beatMs * Math.max(1, shareRatio, overageFactor) / Math.max(priority, 1);
    const lastAccepted = this._lastAcceptedBySfx.get(meta.sfxId) ?? -Infinity;
    const okSpacing = (spec.timeMs ?? now) - lastAccepted >= spacingMs;
    const limitReason = overBudget ? 'share-throttle' : 'count-limit';
    this._lastRateReport = {
      timeMs: now,
      reason: okSpacing ? limitReason : 'spacing',
      snapshot: shareReport
    };
    if (!okSpacing || overBudget) return false;
    return true;
  }

  getRateReport() {
    return this._lastRateReport;
  }

  getRateSnapshot() {
    return this.scheduler.getRateSnapshot();
  }

  getUsageShare(window = 'past') {
    return this.scheduler.getUsageShare(window);
  }

  _onEvent(event) {
    const app = this.context?.app || getAppContext();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      if (!event || event.sfxId == null) return;
      if (!this.mapping.config?.enabled) return;
      if (!this.scheduler.output) return;
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
      spec.reverse = !!event.reverse;
      if (tick != null && this._tickCounter.count >= maxPerTick) return;
      if (tick != null) {
        this._tickCounter.count += 1;
      }
      if (event.tick != null) {
        this._lastTickBySfx.set(event.sfxId, event.tick);
      }
      const priority = this._getEventPriority(event, sfx);
      const meta = { sfxId: event.sfxId, eventType: event.type, priority, triggerType: event.triggerType ?? null };
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
        const adjusted = { ...specWithTime, note };
        this.scheduler.sendNote(adjusted, meta);
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
  }

  dispose() {
    this.detach();
    this.scheduler.dispose();
  }
}

export { MidiEventRouter };
