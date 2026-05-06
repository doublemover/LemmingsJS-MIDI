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

const midiEventRouterPlanningMethods = {
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
  },

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
  },

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
  },

  _shouldSend(meta, spec, plan, now) {
    const limits = this.mapping.config?.limits || {};
    const maxPerSecond = Math.min(Math.max(limits.maxEventsPerSecond ?? MAX_MIDI_MESSAGES_PER_SECOND, 1), MAX_MIDI_MESSAGES_PER_SECOND);
    const hardMaxPerSecond = Math.min(
      Math.max(limits.hardMaxEventsPerSecond ?? maxPerSecond, 1),
      MAX_MIDI_MESSAGES_PER_SECOND
    );
    const snapshotForMax = typeof this.scheduler.evaluateAndReserve === 'function'
      ? null
      : this.scheduler.getRateSnapshot(now);
    const maxBytes = limits.maxBytesPerSecond ??
        this.scheduler._maxBytesPerSecond ??
        snapshotForMax?.maxBytesPerSecond ??
        3906;
    const evaluation = typeof this.scheduler.evaluateAndReserve === 'function'
      ? this.scheduler.evaluateAndReserve(plan, meta, now, {
        softMaxMessagesPerSecond: maxPerSecond,
        maxMessagesPerSecond: hardMaxPerSecond,
        maxBytesPerSecond: maxBytes,
        reserve: false
      })
      : (() => {
        const budget = this.scheduler.getPlanBudget(plan, now);
        const check = this.scheduler.canSchedule(plan, now, {
          maxMessagesPerSecond: hardMaxPerSecond,
          maxBytesPerSecond: maxBytes
        });
        return {
          ...check,
          softOk: budget.combined.count <= maxPerSecond && budget.combined.bytes <= maxBytes,
          snapshot: budget.snapshot,
          proposed: budget.proposed,
          combined: budget.combined
        };
      })();
    const reservePlan = () => typeof this.scheduler.reserveEvaluation === 'function'
      ? this.scheduler.reserveEvaluation(evaluation, plan, meta, now)
      : this.scheduler.reserve(plan, meta, now, {
        maxMessagesPerSecond: hardMaxPerSecond,
        maxBytesPerSecond: maxBytes
      });
    const snapshot = evaluation.snapshot;
    let shareReport = null;
    const combinedBySfx = () => {
      const bySfx = new Map();
      const addEntries = (entries) => {
        for (const [sfxId, entry] of entries.entries()) {
          const curr = bySfx.get(sfxId) || { count: 0, bytes: 0, priority: entry.priority ?? 1 };
          curr.count += entry.count;
          curr.bytes += entry.bytes;
          if (entry.priority != null) curr.priority = entry.priority;
          bySfx.set(sfxId, curr);
        }
      };
      addEntries(snapshot.past.bySfx);
      addEntries(snapshot.next.bySfx);
      return bySfx;
    };
    const getShareReport = () => {
      if (!shareReport) {
        const bySfx = combinedBySfx();
        const total = snapshot.past.count + snapshot.next.count;
        const totalBytes = snapshot.past.bytes + snapshot.next.bytes;
        shareReport = [];
        for (const [sfxId, entry] of bySfx.entries()) {
          shareReport.push({
            sfxId,
            count: entry.count,
            bytes: entry.bytes,
            priority: entry.priority ?? 1,
            percentCount: total ? entry.count / total : 0,
            percentBytes: totalBytes ? entry.bytes / totalBytes : 0
          });
        }
        shareReport.sort((a, b) => b.count - a.count);
      }
      return shareReport;
    };
    const nextCount = evaluation.combined.count;
    const nextBytes = evaluation.combined.bytes;
    if (evaluation.softOk) {
      const reservation = reservePlan();
      if (!reservation.ok) {
        this._lastRateReport = {
          timeMs: now,
          reason: reservation.reason,
          snapshot: getShareReport()
        };
        return false;
      }
      meta.rateReserved = true;
      meta.reservationId = reservation.reservationId;
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
    if (!evaluation.ok || nextCount > hardMaxPerSecond) {
      this._lastRateReport = {
        timeMs: now,
        reason: evaluation.reason || 'count-limit',
        snapshot: getShareReport()
      };
      return false;
    }
    const plannedCount = evaluation.proposed.count;
    const plannedBytes = evaluation.proposed.bytes;
    const priority = meta.priority ?? 1;
    const bySfx = combinedBySfx();
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
    const reservation = reservePlan();
    if (!reservation.ok) {
      this._lastRateReport = {
        timeMs: now,
        reason: reservation.reason,
        snapshot: getShareReport()
      };
      return false;
    }
    meta.rateReserved = true;
    meta.reservationId = reservation.reservationId;
    return true;
  },

  getRateReport() {
    return this._lastRateReport;
  },

  getRateSnapshot() {
    return this.scheduler.getRateSnapshot();
  },

  getUsageShare(window = 'past') {
    return this.scheduler.getUsageShare(window);
  },
};

export { midiEventRouterPlanningMethods };
