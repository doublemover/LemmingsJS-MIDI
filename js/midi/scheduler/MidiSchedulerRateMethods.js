import { getAppContext } from '../../core/dependencies.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../../util/performanceInstrumentation.js';
import {
  MAX_RATE_ENTRIES,
  MIDI_BYTES_PER_SECOND,
  MIDI_MESSAGE_BYTES,
  clamp,
  normalizeChannelNumber,
  toFiniteNumber,
  toPositiveInt
} from './MidiSchedulerShared.js';

const midiSchedulerRateMethods = {
  _pruneRateEntries(now) {
    const cutoff = now - this._rateWindowMs;
    if (this._rateSent.length) {
      let write = 0;
      for (let read = 0; read < this._rateSent.length; read += 1) {
        const entry = this._rateSent[read];
        if (entry.timeMs < cutoff) continue;
        this._rateSent[write] = entry;
        write += 1;
      }
      this._rateSent.length = write;
    }
    if (this._ratePlanned.length) {
      let write = 0;
      for (let read = 0; read < this._ratePlanned.length; read += 1) {
        const entry = this._ratePlanned[read];
        if (entry.timeMs < now) {
          this._rateSent.push(entry);
        } else {
          this._ratePlanned[write] = entry;
          write += 1;
        }
      }
      this._ratePlanned.length = write;
    }
    this._trimRateEntries();
  },

  _trimRateEntries() {
    if (this._rateSent.length > MAX_RATE_ENTRIES) {
      this._rateSent.splice(0, this._rateSent.length - MAX_RATE_ENTRIES);
    }
    if (this._ratePlanned.length > MAX_RATE_ENTRIES) {
      this._ratePlanned.splice(0, this._ratePlanned.length - MAX_RATE_ENTRIES);
    }
  },

  _sumRate(entries, startMs, endMs) {
    let count = 0;
    let bytes = 0;
    const bySfx = new Map();
    const byTrack = new Map();
    const byOutput = new Map();
    const addShare = (map, key, entry) => {
      const curr = map.get(key) || { count: 0, bytes: 0, priority: entry.priority ?? 1 };
      curr.count += entry.count;
      curr.bytes += entry.bytes;
      if (entry.priority != null) curr.priority = entry.priority;
      if (entry.voiceBudget != null) curr.voiceBudget = entry.voiceBudget;
      map.set(key, curr);
    };
    for (const entry of entries) {
      if (entry.timeMs < startMs || entry.timeMs >= endMs) continue;
      count += entry.count;
      bytes += entry.bytes;
      addShare(bySfx, entry.sfxId ?? 'unknown', entry);
      addShare(byTrack, entry.trackId ?? 'project', entry);
      addShare(byOutput, entry.outputId ?? 'project', entry);
    }
    return { count, bytes, bySfx, byTrack, byOutput };
  },

  _planEntries(plan) {
    if (!plan || typeof plan !== 'object') return [];
    if (Array.isArray(plan.entries)) return plan.entries;
    const entries = [];
    if (plan.on) entries.push({ ...plan.on, phase: 'on' });
    if (plan.off) entries.push({ ...plan.off, phase: 'off' });
    return entries;
  },

  _sumPlan(plan, now) {
    let count = 0;
    let bytes = 0;
    const startMs = now - this._rateWindowMs;
    const endMs = now + this._rateWindowMs;
    for (const entry of this._planEntries(plan)) {
      if (!Number.isFinite(entry?.timeMs)) continue;
      if (entry.timeMs < startMs || entry.timeMs >= endMs) continue;
      const entryCount = Math.trunc(toFiniteNumber(entry.count, 0));
      if (entryCount <= 0) continue;
      const entryBytes = Math.trunc(toFiniteNumber(entry.bytes, entryCount * MIDI_MESSAGE_BYTES));
      if (entryBytes <= 0) continue;
      count += entryCount;
      bytes += entryBytes;
    }
    return { count, bytes };
  },

  getPlanBudget(plan, now = this._nowMs()) {
    const snapshot = this.getRateSnapshot(now);
    const proposed = this._sumPlan(plan, now);
    return {
      snapshot,
      proposed,
      combined: {
        count: snapshot.past.count + snapshot.next.count + proposed.count,
        bytes: snapshot.past.bytes + snapshot.next.bytes + proposed.bytes
      }
    };
  },

  canSchedule(plan, now = this._nowMs(), options = {}) {
    return this.evaluateAndReserve(plan, {}, now, {
      ...options,
      reserve: false
    });
  },

  evaluateAndReserve(plan, meta = {}, now = this._nowMs(), options = {}) {
    const maxMessages = Math.min(
      Math.max(options.maxMessagesPerSecond ?? this._maxMessagesPerSecond, 1),
      1000
    );
    const softMaxMessages = Math.min(
      Math.max(options.softMaxMessagesPerSecond ?? maxMessages, 1),
      maxMessages
    );
    const maxBytes = Math.max(1, options.maxBytesPerSecond ?? this._maxBytesPerSecond);
    this._pruneRateEntries(now);
    const snapshot = {
      now,
      past: this._sumRate(this._rateSent, now - this._rateWindowMs, now),
      next: this._sumRate(this._ratePlanned, now, now + this._rateWindowMs),
      maxMessagesPerSecond: this._maxMessagesPerSecond,
      maxBytesPerSecond: this._maxBytesPerSecond
    };
    const proposed = this._sumPlan(plan, now);
    const combined = {
      count: snapshot.past.count + snapshot.next.count + proposed.count,
      bytes: snapshot.past.bytes + snapshot.next.bytes + proposed.bytes
    };
    const overMessages = combined.count > maxMessages;
    const overBytes = combined.bytes > maxBytes;
    const softOverMessages = combined.count > softMaxMessages;
    const result = {
      ok: !overMessages && !overBytes,
      softOk: !softOverMessages && !overBytes,
      reason: overBytes ? 'byte-limit' : (overMessages ? 'count-limit' : null),
      maxMessagesPerSecond: maxMessages,
      softMaxMessagesPerSecond: softMaxMessages,
      maxBytesPerSecond: maxBytes,
      snapshot,
      proposed,
      combined
    };
    if (!result.ok || options.reserve === false) return result;
    return this.reserveEvaluation(result, plan, meta, now);
  },

  reserveEvaluation(evaluation, plan, meta = {}, now = this._nowMs()) {
    if (!evaluation?.ok) return evaluation || { ok: false, reason: 'count-limit' };
    if (evaluation.reservationId) return evaluation;
    const reservationId = ++this._reservationSeq;
    this._pruneRateEntries(now);
    for (const entry of this._planEntries(plan)) {
      const count = Math.trunc(toFiniteNumber(entry.count, 0));
      if (count <= 0) continue;
      const bytes = Math.trunc(toFiniteNumber(entry.bytes, count * MIDI_MESSAGE_BYTES));
      if (bytes <= 0) continue;
      this._recordPlanned({
        timeMs: entry.timeMs,
        count,
        bytes,
        phase: entry.phase ?? null,
        reservationId,
        sfxId: meta.sfxId ?? null,
        priority: meta.priority ?? 1,
        triggerType: meta.triggerType ?? null,
        trackId: meta.trackId ?? null,
        outputId: meta.outputId ?? null,
        voiceBudget: meta.voiceBudget ?? null
      }, now);
    }
    return {
      ...evaluation,
      ok: true,
      reservationId
    };
  },

  reserve(plan, meta = {}, now = this._nowMs(), options = {}) {
    return this.evaluateAndReserve(plan, meta, now, {
      ...options,
      reserve: true
    });
  },

  getRateSnapshot(now = this._nowMs()) {
    this._pruneRateEntries(now);
    const past = this._sumRate(this._rateSent, now - this._rateWindowMs, now);
    const next = this._sumRate(this._ratePlanned, now, now + this._rateWindowMs);
    return {
      now,
      past,
      next,
      maxMessagesPerSecond: this._maxMessagesPerSecond,
      maxBytesPerSecond: this._maxBytesPerSecond
    };
  },

  getUsageShare(window = 'past', now = this._nowMs()) {
    const snapshot = this.getRateSnapshot(now);
    const data = window === 'next' ? snapshot.next : snapshot.past;
    const total = data.count || 0;
    const totalBytes = data.bytes || 0;
    const shares = [];
    for (const [sfxId, entry] of data.bySfx.entries()) {
      shares.push({
        sfxId,
        count: entry.count,
        bytes: entry.bytes,
        priority: entry.priority ?? 1,
        percentCount: total ? entry.count / total : 0,
        percentBytes: totalBytes ? entry.bytes / totalBytes : 0
      });
    }
    shares.sort((a, b) => b.count - a.count);
    return shares;
  },

  estimateMessages(spec) {
    if (!spec || !Number.isFinite(spec.note)) return { messages: 0, bytes: 0 };
    let messages = 1;
    if (this.config.mpe?.enabled) {
      messages += 1;
    } else if (spec.pitchBend != null && Number.isFinite(spec.pitchBend) && spec.pitchBend !== 0) {
      messages += 1;
    }
    if (spec.timbre != null && Number.isFinite(spec.timbre)) messages += 1;
    if (spec.pan != null && Number.isFinite(spec.pan)) messages += 1;
    if (spec.durationTicks && spec.durationTicks > 0) {
      messages += 1;
      if (this.config.mpe?.enabled) messages += 1;
    }
    return { messages, bytes: messages * MIDI_MESSAGE_BYTES };
  },

  _recordPlanned(entry, now = this._nowMs()) {
    if (!entry || !Number.isFinite(entry.timeMs)) return;
    const count = Math.trunc(toFiniteNumber(entry.count, 0));
    if (count <= 0) return;
    const bytes = Math.trunc(toFiniteNumber(entry.bytes, count * MIDI_MESSAGE_BYTES));
    if (bytes <= 0) return;
    const normalized = { ...entry, count, bytes };
    this._pruneRateEntries(now);
    if (normalized.timeMs < now) {
      this._rateSent.push(normalized);
    } else {
      this._ratePlanned.push(normalized);
    }
    this._trimRateEntries();
  },

  _recordSent(entry, now = this._nowMs()) {
    if (!entry || !Number.isFinite(entry.timeMs)) return;
    const count = Math.trunc(toFiniteNumber(entry.count, 0));
    if (count <= 0) return;
    const bytes = Math.trunc(toFiniteNumber(entry.bytes, count * MIDI_MESSAGE_BYTES));
    if (bytes <= 0) return;
    this._pruneRateEntries(now);
    this._rateSent.push({ ...entry, count, bytes });
    this._trimRateEntries();
  },

  _removePlannedRateEntries(token, phase = null) {
    if (token == null || !this._ratePlanned.length) return;
    let write = 0;
    for (let read = 0; read < this._ratePlanned.length; read += 1) {
      const entry = this._ratePlanned[read];
      const remove = entry?.token === token && (phase == null || entry.phase === phase);
      if (remove) continue;
      this._ratePlanned[write] = entry;
      write += 1;
    }
    this._ratePlanned.length = write;
  },

  _checkByteRate(now = this._nowMs()) {
    const snapshot = this.getRateSnapshot(now);
    const pastCount = toFiniteNumber(snapshot.past?.count, 0);
    const nextCount = toFiniteNumber(snapshot.next?.count, 0);
    const pastBytes = toFiniteNumber(snapshot.past?.bytes, 0);
    const nextBytes = toFiniteNumber(snapshot.next?.bytes, 0);
    const overMessageRate = pastCount > this._maxMessagesPerSecond || nextCount > this._maxMessagesPerSecond;
    const overByteRate = pastBytes > this._maxBytesPerSecond || nextBytes > this._maxBytesPerSecond;
    if (overMessageRate || overByteRate) {
      if (now - this._lastRateErrorMs > 1000) {
        this._lastRateErrorMs = now;
        const limits = [];
        if (overMessageRate) limits.push(`${this._maxMessagesPerSecond.toFixed(0)} messages/sec`);
        if (overByteRate) limits.push(`${this._maxBytesPerSecond.toFixed(0)} bytes/sec`);
        console.error(`MIDI throughput exceeded ${limits.join(' and ')}`);
      }
    }
  },
};

export { midiSchedulerRateMethods };
