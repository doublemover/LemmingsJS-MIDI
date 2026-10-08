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
          if (entry.timeMs >= cutoff) this._rateSent.push(entry);
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

  _sumRate(entries, startMs, endMs, detailed = true, includePendingOns = false) {
    let count = 0;
    let bytes = 0;
    const bySfx = detailed ? new Map() : null;
    const byTrack = detailed ? new Map() : null;
    const byOutput = detailed ? new Map() : null;
    const byLane = detailed ? new Map() : null;
    const addShare = (map, key, entry) => {
      const curr = map.get(key) || { count: 0, bytes: 0, priority: entry.priority ?? 1 };
      curr.count += entry.count;
      curr.bytes += entry.bytes;
      if (entry.priority != null) curr.priority = entry.priority;
      if (entry.voiceBudget != null) curr.voiceBudget = entry.voiceBudget;
      map.set(key, curr);
    };
    for (const entry of entries) {
      if (entry.timeMs < startMs || (entry.timeMs >= endMs && (!includePendingOns || entry.phase !== 'on'))) continue;
      count += entry.count;
      bytes += entry.bytes;
      if (detailed) {
        addShare(bySfx, entry.sfxId ?? 'unknown', entry);
        addShare(byTrack, entry.trackId ?? 'project', entry);
        addShare(byOutput, entry.outputId ?? 'project', entry);
        addShare(byLane, entry.laneIndex ?? 0, entry);
      }
    }
    return { count, bytes, bySfx, byTrack, byOutput, byLane };
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
      if (entry.timeMs < startMs || (entry.timeMs >= endMs && entry.phase === 'off')) continue;
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
      next: this._sumRate(this._ratePlanned, now, now + this._rateWindowMs, true, true),
      maxMessagesPerSecond: this._maxMessagesPerSecond,
      maxBytesPerSecond: this._maxBytesPerSecond
    };
    const proposed = this._sumPlan(plan, now);
    const combined = {
      count: snapshot.past.count + snapshot.next.count + proposed.count,
      bytes: snapshot.past.bytes + snapshot.next.bytes + proposed.bytes
    };
    const lane = this._evaluateLaneShare(meta, now, snapshot, proposed, softMaxMessages, maxBytes);
    const overMessages = combined.count > maxMessages;
    const overBytes = combined.bytes > maxBytes;
    const softOverMessages = combined.count > softMaxMessages;
    const result = {
      ok: !overMessages && !overBytes && lane.ok,
      softOk: !softOverMessages && !overBytes && lane.ok,
      reason: overBytes ? 'byte-limit' : (overMessages ? 'count-limit' : lane.reason),
      lane,
      maxMessagesPerSecond: maxMessages,
      softMaxMessagesPerSecond: softMaxMessages,
      maxBytesPerSecond: maxBytes,
      snapshot,
      proposed,
      combined
    };
    if (!result.ok || options.reserve === false) return result;
    return this.reserveEvaluation(result, plan, meta, now, true);
  },

  reserveEvaluation(evaluation, plan, meta = {}, now = this._nowMs(), alreadyPruned = false) {
    if (!evaluation?.ok) return evaluation || { ok: false, reason: 'count-limit' };
    if (evaluation.reservationId) return evaluation;
    const reservationId = ++this._reservationSeq;
    if ((meta.laneCount ?? 1) > 1) this._rateLaneLastServed.set(meta.laneIndex ?? 0, now);
    if (!alreadyPruned) this._pruneRateEntries(now);
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
        voiceBudget: meta.voiceBudget ?? null,
        laneIndex: meta.laneIndex ?? 0,
        laneCount: meta.laneCount ?? 1
      }, now, true);
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

  _evaluateLaneShare(meta, now, snapshot, proposed, maxMessages, maxBytes) {
    const laneCount = clamp(toPositiveInt(meta.laneCount, 1), 1, 1024);
    const laneIndex = clamp(Math.trunc(toFiniteNumber(meta.laneIndex, 0)), 0, laneCount - 1);
    if (laneCount <= 1) {
      this._rateLaneCount = 1;
      this._rateLaneStartMs = null;
      this._rateLaneActivity.clear();
      this._rateLaneLastServed.clear();
      return { ok: true, reason: null, laneIndex, laneCount, activeLanes: 1 };
    }
    if (this._rateLaneCount !== laneCount || this._rateLaneStartMs == null) {
      this._rateLaneCount = laneCount;
      this._rateLaneStartMs = now;
      this._rateLaneActivity.clear();
      this._rateLaneLastServed.clear();
    }
    this._rateLaneActivity.set(laneIndex, now);
    for (const [index, seenAt] of this._rateLaneActivity) {
      if (now - seenAt > this._rateWindowMs * 2) this._rateLaneActivity.delete(index);
    }
    // Protect every lane during the first burst; quiet lanes lend their share afterwards.
    const activeLanes = now - this._rateLaneStartMs < 120 ? laneCount : Math.max(1, this._rateLaneActivity.size);
    const used = [snapshot.past.byLane?.get(laneIndex), snapshot.next.byLane?.get(laneIndex)];
    const count = used.reduce((total, entry) => total + (entry?.count || 0), 0);
    const bytes = used.reduce((total, entry) => total + (entry?.bytes || 0), 0);
    const countShare = Math.max(proposed.count, maxMessages / activeLanes);
    const byteShare = Math.max(proposed.bytes, maxBytes / activeLanes);
    let leastServed = Infinity;
    const oversized = proposed.count > maxMessages / activeLanes || proposed.bytes > maxBytes / activeLanes;
    if (oversized) {
      if (activeLanes > this._rateLaneActivity.size) leastServed = -Infinity;
      for (const index of this._rateLaneActivity.keys()) {
        leastServed = Math.min(leastServed, this._rateLaneLastServed.get(index) ?? -Infinity);
      }
    }
    const inTurn = !oversized || (this._rateLaneLastServed.get(laneIndex) ?? -Infinity) <= leastServed;
    const ok = inTurn && count + proposed.count <= countShare && bytes + proposed.bytes <= byteShare;
    return { ok, reason: ok ? null : 'lane-share', laneIndex, laneCount, activeLanes, countShare, byteShare };
  },

  recordThrottle(reason, now = this._nowMs()) {
    this._throttleState.dropped += 1;
    this._throttleState.lastDropMs = now;
    this._throttleState.reason = reason;
  },

  getOutputPressure(now = this._nowMs()) {
    const snapshot = this.getRateSnapshot(now, false);
    return { throttled: now - this._throttleState.lastDropMs < 1000,
      dropped: this._throttleState.dropped, reason: this._throttleState.reason,
      messages: snapshot.past.count + snapshot.next.count,
      maxMessages: this._maxMessagesPerSecond, laneCount: this._rateLaneCount,
      pendingNotes: this._pendingNoteOns.size };
  },

  getRateSnapshot(now = this._nowMs(), detailed = true) {
    this._pruneRateEntries(now);
    const past = this._sumRate(this._rateSent, now - this._rateWindowMs, now, detailed);
    const next = this._sumRate(this._ratePlanned, now, now + this._rateWindowMs, detailed, true);
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
    const output = this._resolveOutput(spec.outputId);
    const channel = normalizeChannelNumber(spec.channel ?? this.config.defaultChannel, 1);
    const expression = this._expressionPlan(spec, output, channel, true);
    const offMessages = spec.durationTicks > 0 ? (this._isMpeNote(spec) ? 2 : 1) : 0;
    const messages = 1 + expression.messages + offMessages;
    return { messages, bytes: (1 + offMessages) * MIDI_MESSAGE_BYTES + expression.bytes };
  },

  _recordPlanned(entry, now = this._nowMs(), alreadyPruned = false) {
    if (!entry || !Number.isFinite(entry.timeMs)) return;
    const count = Math.trunc(toFiniteNumber(entry.count, 0));
    if (count <= 0) return;
    const bytes = Math.trunc(toFiniteNumber(entry.bytes, count * MIDI_MESSAGE_BYTES));
    if (bytes <= 0) return;
    if (entry.timeMs < now - this._rateWindowMs) return;
    const normalized = { ...entry, count, bytes };
    if (!alreadyPruned) this._pruneRateEntries(now);
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
    const snapshot = this.getRateSnapshot(now, false);
    const pastCount = toFiniteNumber(snapshot.past?.count, 0);
    const nextCount = toFiniteNumber(snapshot.next?.count, 0);
    const pastBytes = toFiniteNumber(snapshot.past?.bytes, 0);
    const nextBytes = toFiniteNumber(snapshot.next?.bytes, 0);
    const overMessageRate = pastCount > this._maxMessagesPerSecond || nextCount > this._maxMessagesPerSecond;
    const overByteRate = pastBytes > this._maxBytesPerSecond || nextBytes > this._maxBytesPerSecond;
    if (overMessageRate || overByteRate) {
      if (now - this._lastRateErrorMs > 1000) {
        this._lastRateErrorMs = now;
        this.recordThrottle(overByteRate ? 'byte-limit' : 'count-limit', now);
      }
    }
  },
};

export { midiSchedulerRateMethods };
