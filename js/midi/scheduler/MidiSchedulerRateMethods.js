import { getAppContext } from '../../core/dependencies.js';
import { midiTransportBudget } from './MidiTransportBudget.js';
import { futureMidiRatePeak } from './FutureMidiRateWindow.js';
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
    if (this._rateSent.length && (this._rateHistoryArray !== this._rateSent || this._rateHistoryLength !== this._rateSent.length ||
        this._rateHistoryOldest < cutoff)) {
      let write = 0, oldest = Infinity;
      for (let read = 0; read < this._rateSent.length; read += 1) {
        const entry = this._rateSent[read];
        if (entry.timeMs < cutoff) continue;
        this._rateSent[write] = entry;
        oldest = Math.min(oldest, entry.timeMs);
        write += 1;
      }
      this._rateSent.length = write;
      this._rateHistoryOldest = oldest;
    } else if (!this._rateSent.length) this._rateHistoryOldest = Infinity;
    if (this._ratePlanned.length) {
      let write = 0;
      for (let read = 0; read < this._ratePlanned.length; read += 1) {
        const entry = this._ratePlanned[read];
        // Time passing is not evidence that a device accepted the message.
        // Owned reservations stay planned until dispatch or cancellation.
        if (entry.timeMs < cutoff && entry.reservationId == null && entry.token == null) continue;
        this._ratePlanned[write] = entry;
        write += 1;
      }
      this._ratePlanned.length = write;
    }
    this._trimRateEntries();
    this._rateHistoryArray = this._rateSent; this._rateHistoryLength = this._rateSent.length;
    if (this._rateSent.length <= MAX_RATE_ENTRIES) this._rateHistorySaturated = false;
  },

  _trimRateEntries() {
    if (this._rateSent.length > MAX_RATE_ENTRIES) {
      const summaries = new Map(), prefix = Math.ceil(MAX_RATE_ENTRIES / 2);
      for (let index = 0; index < prefix; index++) {
        const entry = this._rateSent[index], key = `${entry.budgetScope || ''}:${entry.outputId || ''}`;
        let summary = summaries.get(key);
        if (!summary) { summary = { ...entry, count: 0, bytes: 0, sfxId: null, trackId: null, laneIndex: 'unknown',
          token: null, reservationId: null, phase: 'aggregate', aggregated: true }; summaries.set(key, summary); }
        summary.count += entry.count; summary.bytes += entry.bytes; summary.timeMs = Math.max(summary.timeMs, entry.timeMs);
      }
      if (summaries.size < prefix) {
        this._rateSent.splice(0, prefix, ...summaries.values());
        this._rateHistoryAggregations = (this._rateHistoryAggregations || 0) + 1;
      } else {
        // Unbounded endpoint churn cannot retain unbounded identities. Keep the
        // full cost as a conservative charge to every route until it expires.
        const aggregate = { ...this._rateSent[0], count: 0, bytes: 0, timeMs: -Infinity, outputId: null, budgetScope: '*',
          sfxId: null, trackId: null, laneIndex: 'unknown', token: null, reservationId: null,
          phase: 'aggregate', aggregated: true, conservativeAllScopes: true };
        for (let index = 0; index < prefix; index++) {
          const entry = this._rateSent[index]; aggregate.count += entry.count; aggregate.bytes += entry.bytes;
          aggregate.timeMs = Math.max(aggregate.timeMs, entry.timeMs);
        }
        this._rateSent.splice(0, prefix, aggregate);
        this._rateHistoryAggregations = (this._rateHistoryAggregations || 0) + 1;
      }
    }
  },

  _sumRate(entries, startMs, endMs, detailed = true, includePendingOns = false, outputId = undefined) {
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
      if (!entry.conservativeAllScopes && outputId !== undefined && (outputId !== null && typeof outputId === 'object' ? entry.budgetScope !== outputId.scope : entry.outputId !== outputId)) continue;
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

  _outputRateLimits(outputId, options = {}) {
    const profile = this.getTransportBudget(outputId, options);
    return { maxMessages: profile.maxMessagesPerSecond, maxBytes: profile.maxBytesPerSecond };
  },

  getTransportBudget(outputId = null, options = {}) {
    const output = this._resolveOutput(outputId);
    return midiTransportBudget(output || { id: outputId }, this.config.limits, options);
  },

  _rateScopeForOutput(outputId) {
    if (outputId === undefined) return undefined;
    const profile = this.getTransportBudget(outputId);
    return profile.linkId ? { scope: profile.scope } : outputId;
  },

  evaluateAndReserve(plan, meta = {}, now = this._nowMs(), options = {}) {
    const outputId = this._resolveOutputId(meta.outputId);
    const profile = this.getTransportBudget(outputId, options);
    const rateScope = outputId == null ? undefined : outputId;
    const { maxMessages, maxBytes } = this._outputRateLimits(outputId, options);
    const softMaxMessages = this._resolveOutput(outputId)?.supportsIndependentNoteGates ? maxMessages : Math.min(
      Math.max(options.softMaxMessagesPerSecond ?? maxMessages, 1),
      maxMessages
    );
    this._pruneRateEntries(now);
    const snapshot = {
      now,
      past: this._sumRate(this._rateSent, now - this._rateWindowMs, now + 0.001, true, false, rateScope),
      next: this._sumRate(this._ratePlanned, -Infinity, now + this._rateWindowMs, true, true, rateScope),
      maxMessagesPerSecond: maxMessages,
      maxBytesPerSecond: maxBytes,
      outputId
    };
    const proposed = this._sumPlan(plan, now);
    const combined = {
      count: snapshot.past.count + snapshot.next.count + proposed.count,
      bytes: snapshot.past.bytes + snapshot.next.bytes + proposed.bytes
    };
    const sharedLink = profile.linkId ? {
      linkId: profile.linkId,
      past: this._sumRate(this._rateSent, now - this._rateWindowMs, now + 0.001, false, false, { scope: profile.scope }),
      next: this._sumRate(this._ratePlanned, -Infinity, now + this._rateWindowMs, false, true, { scope: profile.scope }),
      maxMessagesPerSecond: profile.linkMaxMessagesPerSecond, maxBytesPerSecond: profile.linkMaxBytesPerSecond
    } : null;
    if (sharedLink) sharedLink.combined = { count: sharedLink.past.count + sharedLink.next.count + proposed.count,
      bytes: sharedLink.past.bytes + sharedLink.next.bytes + proposed.bytes };
    const lane = this._evaluateLaneShare({ ...meta, outputId }, now, snapshot, proposed, softMaxMessages, maxBytes);
    const overMessages = combined.count > (profile.endpointMaxMessagesPerSecond ?? maxMessages) ||
      !!sharedLink && sharedLink.combined.count > sharedLink.maxMessagesPerSecond;
    const overBytes = combined.bytes > (profile.endpointMaxBytesPerSecond ?? maxBytes) ||
      !!sharedLink && sharedLink.combined.bytes > sharedLink.maxBytesPerSecond;
    const softOverMessages = combined.count > softMaxMessages;
    const result = {
      ok: !overMessages && !overBytes && lane.ok,
      softOk: !softOverMessages && !overMessages && !overBytes && lane.ok,
      reason: overBytes ? 'byte-limit' : (overMessages ? 'count-limit' : lane.reason),
      lane,
      maxMessagesPerSecond: maxMessages,
      softMaxMessagesPerSecond: softMaxMessages,
      maxBytesPerSecond: maxBytes,
      snapshot,
      proposed,
      combined,
      route: Object.freeze({ outputId, connectionEpoch: this._outputLeases.get(this._resolveOutput(outputId))?.connectionEpoch ?? null,
        routeRevision: this._outputLeases.get(this._resolveOutput(outputId))?.routeRevision ?? null })
    };
    result.sharedLink = sharedLink;
    if (this._rateHistorySaturated) { result.ok = false; result.softOk = false; result.reason = 'history-cap'; }
    const pendingCount = this._ratePlanned.reduce((sum, entry) => entry.outputId === outputId ? sum + entry.count : sum, 0);
    const entries = this._planEntries(plan);
    if (entries.length > MAX_RATE_ENTRIES) return { ...result, ok: false, softOk: false, reason: 'reservation-cap' };
    if (profile.protocol === 'midi1' && (entries.some(entry => entry.timeMs >= now + this._rateWindowMs) ||
        this._ratePlanned.some(entry => entry.timeMs >= now + this._rateWindowMs))) {
      const future = [...this._rateSent, ...this._ratePlanned, ...entries.map(entry => ({ ...entry, outputId, budgetScope: profile.scope }))];
      const endpoint = futureMidiRatePeak(future, { now, windowMs: this._rateWindowMs, scope: rateScope });
      const link = profile.linkId ? futureMidiRatePeak(future, { now, windowMs: this._rateWindowMs, scope: { scope: profile.scope } }) : null;
      result.futureWindows = { endpoint, link };
      const futureBytesExceeded = endpoint.peakBytes > (profile.endpointMaxBytesPerSecond ?? maxBytes) || link && link.peakBytes > profile.linkMaxBytesPerSecond;
      const futureCountExceeded = endpoint.peakMessages > (profile.endpointMaxMessagesPerSecond ?? maxMessages) || link && link.peakMessages > profile.linkMaxMessagesPerSecond;
      if (futureBytesExceeded || futureCountExceeded) {
        result.ok = false; result.softOk = false; result.reason = futureBytesExceeded ? 'byte-limit' : 'count-limit';
      }
    }
    const plannedCount = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.count) || 0), 0);
    const policyFailure = profile.requestedProtocol && profile.requestedProtocol !== 'midi1' ? 'protocol-budget-unsupported'
      : entries.some(entry => Number.isFinite(entry.timeMs) && entry.timeMs - now > profile.queueHorizonMs) ? 'queue-horizon'
        : pendingCount + plannedCount > profile.maxPending ? 'pending-cap' : null;
    if (policyFailure) { result.ok = false; result.softOk = false; result.reason = policyFailure; }
    if (!result.ok || options.reserve === false) return result;
    return this.reserveEvaluation(result, plan, meta, now, true);
  },

  reserveEvaluation(evaluation, plan, meta = {}, now = this._nowMs(), alreadyPruned = false) {
    if (!evaluation?.ok) return evaluation || { ok: false, reason: 'count-limit' };
    if (evaluation.reservationId) return this._ratePlanned.some(entry => entry.reservationId === evaluation.reservationId)
      ? evaluation : { ...evaluation, ok: false, reason: 'closed-reservation' };
    if (!alreadyPruned) {
      const outputId = this._resolveOutputId(meta.outputId), lease = this._outputLeases.get(this._resolveOutput(outputId));
      if (evaluation.route && (evaluation.route.outputId !== outputId || evaluation.route.connectionEpoch !== (lease?.connectionEpoch ?? null) ||
          evaluation.route.routeRevision !== (lease?.routeRevision ?? null))) return { ...evaluation, ok: false, reason: 'stale-route-evaluation' };
      evaluation = this.evaluateAndReserve(plan, meta, now, { reserve: false,
        maxMessagesPerSecond: evaluation.maxMessagesPerSecond, maxBytesPerSecond: evaluation.maxBytesPerSecond,
        softMaxMessagesPerSecond: evaluation.softMaxMessagesPerSecond });
      if (!evaluation.ok) return evaluation;
      alreadyPruned = true;
    }
    if (this._ratePlanned.length + this._planEntries(plan).length > MAX_RATE_ENTRIES) return { ...evaluation, ok: false, reason: 'reservation-cap' };
    const reservationId = ++this._reservationSeq;
    if ((meta.laneCount ?? 1) > 1) this._laneBudgetState(meta.outputId)._rateLaneLastServed.set(meta.laneIndex ?? 0, now);
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
        outputId: this._resolveOutputId(meta.outputId),
        connectionEpoch: this._outputLeases.get(this._resolveOutput(meta.outputId))?.connectionEpoch ?? null,
        routeRevision: this._outputLeases.get(this._resolveOutput(meta.outputId))?.routeRevision ?? null,
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

  inspectReservation(reservationId) {
    const entries = this._ratePlanned.filter(entry => entry.reservationId === reservationId), phases = Object.create(null);
    for (const entry of entries) {
      const phase = entry.phase || 'unknown';
      phases[phase] ||= { count: 0, bytes: 0 }; phases[phase].count += entry.count; phases[phase].bytes += entry.bytes;
    }
    return Object.freeze({ reservationId, state: entries.length ? 'pending' : 'not-pending', pendingEntries: entries.length,
      outputId: entries[0]?.outputId ?? null, connectionEpoch: entries[0]?.connectionEpoch ?? null,
      routeRevision: entries[0]?.routeRevision ?? null, boundTokens: Object.freeze([...new Set(entries.map(entry => entry.token).filter(token => token != null))]),
      phases: Object.freeze(Object.fromEntries(Object.entries(phases).map(([phase, value]) => [phase, Object.freeze(value)]))) });
  },

  _reservationIssue(reason, reservationId, outputId) {
    this.lastReservationIssue = Object.freeze({ reason, reservationId, outputId, timestamp: this._nowMs() });
    return false;
  },

  _laneBudgetState(outputId) {
    const id = this._resolveOutputId(outputId);
    if (id == null) return this;
    let state = this._rateLanesByOutput.get(id);
    if (!state) {
      if (this._rateLanesByOutput.size >= 128) this._rateLanesByOutput.delete(this._rateLanesByOutput.keys().next().value);
      state = { _rateLaneCount: 1, _rateLaneStartMs: null, _rateLaneActivity: new Map(), _rateLaneLastServed: new Map() };
      this._rateLanesByOutput.set(id, state);
    }
    return state;
  },

  _evaluateLaneShare(meta, now, snapshot, proposed, maxMessages, maxBytes) {
    const state = this._laneBudgetState(meta.outputId);
    const laneCount = clamp(toPositiveInt(meta.laneCount, 1), 1, 1024);
    const laneIndex = clamp(Math.trunc(toFiniteNumber(meta.laneIndex, 0)), 0, laneCount - 1);
    if (laneCount <= 1) {
      state._rateLaneCount = 1;
      state._rateLaneStartMs = null;
      state._rateLaneActivity.clear();
      state._rateLaneLastServed.clear();
      return { ok: true, reason: null, laneIndex, laneCount, activeLanes: 1 };
    }
    if (state._rateLaneCount !== laneCount || state._rateLaneStartMs == null) {
      state._rateLaneCount = laneCount;
      state._rateLaneStartMs = now;
      state._rateLaneActivity.clear();
      state._rateLaneLastServed.clear();
    }
    state._rateLaneActivity.set(laneIndex, now);
    for (const [index, seenAt] of state._rateLaneActivity) {
      if (now - seenAt > this._rateWindowMs * 2) state._rateLaneActivity.delete(index);
    }
    // Protect every lane during the first burst; quiet lanes lend their share afterwards.
    const activeLanes = now - state._rateLaneStartMs < 120 ? laneCount : Math.max(1, state._rateLaneActivity.size);
    const used = [snapshot.past.byLane?.get(laneIndex), snapshot.next.byLane?.get(laneIndex)];
    const count = used.reduce((total, entry) => total + (entry?.count || 0), 0);
    const bytes = used.reduce((total, entry) => total + (entry?.bytes || 0), 0);
    const countShare = Math.max(proposed.count, maxMessages / activeLanes);
    const byteShare = Math.max(proposed.bytes, maxBytes / activeLanes);
    let leastServed = Infinity;
    const oversized = proposed.count > maxMessages / activeLanes || proposed.bytes > maxBytes / activeLanes;
    if (oversized) {
      if (activeLanes > state._rateLaneActivity.size) leastServed = -Infinity;
      for (const index of state._rateLaneActivity.keys()) {
        leastServed = Math.min(leastServed, state._rateLaneLastServed.get(index) ?? -Infinity);
      }
    }
    const inTurn = !oversized || (state._rateLaneLastServed.get(laneIndex) ?? -Infinity) <= leastServed;
    const ok = inTurn && count + proposed.count <= countShare && bytes + proposed.bytes <= byteShare;
    return { ok, reason: ok ? null : 'lane-share', laneIndex, laneCount, activeLanes, countShare, byteShare };
  },

  recordThrottle(reason, now = this._nowMs(), meta = {}) {
    this._observe('drop', { ...meta, type: 'output', reason });
    this._throttleState.dropped += 1;
    this._throttleState.lastDropMs = now;
    this._throttleState.reason = reason;
    const id = this._resolveOutputId(meta?.outputId);
    if (id != null) {
      let state = this._throttleByOutput.get(id);
      if (!state) { state = { dropped: 0, lastDropMs: -Infinity, reason: null }; this._throttleByOutput.set(id, state); }
      state.dropped++; state.lastDropMs = now; state.reason = reason;
    }
  },

  getOutputPressure(now = this._nowMs(), outputId = undefined) {
    const snapshot = this.getRateSnapshot(now, false, outputId);
    const state = outputId === undefined ? this._throttleState : this._throttleByOutput.get(this._resolveOutputId(outputId)) || { dropped: 0, lastDropMs: -Infinity, reason: null };
    const pending = outputId === undefined ? [...this._pendingNoteOns.values()] : [...this._pendingNoteOns.values()].filter(entry => entry.output === this._resolveOutput(outputId));
    return { throttled: now - state.lastDropMs < 1000,
      dropped: state.dropped, reason: state.reason,
      messages: snapshot.past.count + snapshot.next.count,
      bytes: snapshot.past.bytes + snapshot.next.bytes, maxBytes: snapshot.maxBytesPerSecond,
      budgetProfile: outputId === undefined ? null : this.getTransportBudget(outputId),
      sharedLink: snapshot.sharedLink,
      historyAggregations: this._rateHistoryAggregations || 0,
      historyDetail: this._rateHistoryAggregations ? 'conservative-endpoint-totals' : 'messages',
      lastReservationIssue: this.lastReservationIssue || null,
      maxMessages: snapshot.maxMessagesPerSecond, laneCount: outputId === undefined ? this._rateLaneCount : this._laneBudgetState(outputId)._rateLaneCount,
      pendingNotes: pending.length, oldestDeadline: pending.length ? Math.min(...pending.map(entry => entry.timeMs)) : null };
  },

  getRateSnapshot(now = this._nowMs(), detailed = true, outputId = undefined) {
    this._pruneRateEntries(now);
    const scope = outputId;
    const past = this._sumRate(this._rateSent, now - this._rateWindowMs, now + 0.001, detailed, false, scope);
    const next = this._sumRate(this._ratePlanned, -Infinity, now + this._rateWindowMs, detailed, true, scope);
    const limits = outputId === undefined ? { maxMessages: this._maxMessagesPerSecond, maxBytes: this._maxBytesPerSecond } : this._outputRateLimits(outputId);
    return {
      now,
      past,
      next,
      maxMessagesPerSecond: limits.maxMessages,
      maxBytesPerSecond: limits.maxBytes,
      sharedLink: (() => {
        const profile = outputId === undefined ? null : this.getTransportBudget(outputId);
        return profile?.linkId ? { linkId: profile.linkId,
          past: this._sumRate(this._rateSent, now - this._rateWindowMs, now + 0.001, detailed, false, { scope: profile.scope }),
          next: this._sumRate(this._ratePlanned, -Infinity, now + this._rateWindowMs, detailed, true, { scope: profile.scope }),
          maxMessagesPerSecond: profile.linkMaxMessagesPerSecond, maxBytesPerSecond: profile.linkMaxBytesPerSecond } : null;
      })()
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
    const normalized = { ...entry, count, bytes, budgetScope: this.getTransportBudget(entry.outputId).scope };
    if (!alreadyPruned) this._pruneRateEntries(now);
    this._ratePlanned.push(normalized);
    this._trimRateEntries();
  },

  _releaseReservation(reservationId, unclaimedOnly = false) {
    if (reservationId == null) return 0;
    let write = 0, removed = 0;
    for (const entry of this._ratePlanned) {
      if (entry.reservationId === reservationId && (!unclaimedOnly || entry.token == null)) { removed++; continue; }
      this._ratePlanned[write++] = entry;
    }
    this._ratePlanned.length = write;
    return removed;
  },

  _claimReservation(reservationId, token, partsRemaining = 1, outputId = undefined) {
    if (reservationId == null || token == null) return false;
    if (outputId !== undefined) {
      const lease = this._outputLeases.get(this._resolveOutput(outputId));
      const entries = this._ratePlanned.filter(entry => entry.reservationId === reservationId && entry.token == null);
      if (!entries.length || entries.some(entry => entry.outputId !== outputId ||
          entry.connectionEpoch != null && entry.connectionEpoch !== lease?.connectionEpoch ||
          entry.routeRevision != null && entry.routeRevision !== lease?.routeRevision)) return false;
    }
    let claimed = false;
    for (let index = this._ratePlanned.length - 1; index >= 0; index--) {
      const entry = this._ratePlanned[index];
      if (entry.reservationId !== reservationId || entry.token != null) continue;
      const count = Math.ceil(entry.count / Math.max(1, partsRemaining));
      const bytes = Math.ceil(entry.bytes / Math.max(1, partsRemaining));
      if (count <= 0 || bytes <= 0) continue;
      const owned = { ...entry, token, count, bytes };
      entry.count -= count; entry.bytes -= bytes;
      if (entry.count <= 0 || entry.bytes <= 0) this._ratePlanned.splice(index, 1, owned);
      else this._ratePlanned.splice(index + 1, 0, owned);
      claimed = true;
    }
    return claimed;
  },

  _releaseReservationPart(reservationId, partsRemaining = 1) {
    if (reservationId == null) return 0;
    let removed = 0;
    for (let index = this._ratePlanned.length - 1; index >= 0; index--) {
      const entry = this._ratePlanned[index];
      if (entry.reservationId !== reservationId || entry.token != null) continue;
      entry.count -= Math.ceil(entry.count / Math.max(1, partsRemaining));
      entry.bytes -= Math.ceil(entry.bytes / Math.max(1, partsRemaining));
      if (entry.count <= 0 || entry.bytes <= 0) this._ratePlanned.splice(index, 1);
      removed++;
    }
    return removed;
  },

  _commitReservationMessage(reservationId, phase, bytes, meta = {}, sentAt = this._nowMs()) {
    return this._commitReservationCost(reservationId, phase, 1, bytes, meta, sentAt);
  },

  _commitReservationCost(reservationId, phase, count, bytes, meta = {}, sentAt = this._nowMs()) {
    const index = this._ratePlanned.findIndex(entry => entry.reservationId === reservationId && entry.token == null && entry.phase === phase);
    if (index < 0) return false;
    const entry = this._ratePlanned[index];
    const outputId = this._resolveOutputId(meta.outputId ?? entry.outputId), lease = this._outputLeases.get(this._resolveOutput(outputId));
    if (entry.outputId !== outputId) return this._reservationIssue('wrong-endpoint', reservationId, outputId);
    if (entry.connectionEpoch != null && entry.connectionEpoch !== lease?.connectionEpoch ||
        entry.routeRevision != null && entry.routeRevision !== lease?.routeRevision) return this._reservationIssue('stale-route', reservationId, outputId);
    if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(bytes) || bytes <= 0) return this._reservationIssue('invalid-cost', reservationId, outputId);
    if (count > entry.count || bytes > entry.bytes) return this._reservationIssue('cost-exceeded', reservationId, outputId);
    entry.count -= count; entry.bytes -= bytes;
    if (entry.count <= 0 || entry.bytes <= 0) this._ratePlanned.splice(index, 1);
    this._recordSent({ timeMs: sentAt, count, bytes, phase, reservationId,
      outputId, trackId: meta.trackId ?? entry.trackId,
      laneIndex: meta.laneIndex ?? entry.laneIndex, laneCount: meta.laneCount ?? entry.laneCount,
      sfxId: meta.sfxId ?? entry.sfxId, priority: meta.priority ?? entry.priority }, sentAt);
    return true;
  },

  _recordSent(entry, now = this._nowMs()) {
    if (!entry || !Number.isFinite(entry.timeMs)) return;
    const count = Math.trunc(toFiniteNumber(entry.count, 0));
    if (count <= 0) return;
    const bytes = Math.trunc(toFiniteNumber(entry.bytes, count * MIDI_MESSAGE_BYTES));
    if (bytes <= 0) return;
    this._pruneRateEntries(now);
    this._rateSent.push({ ...entry, count, bytes, budgetScope: this.getTransportBudget(entry.outputId).scope });
    this._rateHistoryOldest = Math.min(this._rateHistoryOldest ?? Infinity, entry.timeMs);
    this._trimRateEntries();
    this._rateHistoryLength = this._rateSent.length;
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

  _checkByteRate(now = this._nowMs(), outputId = undefined) {
    const snapshot = this.getRateSnapshot(now, false, outputId);
    const pastCount = toFiniteNumber(snapshot.past?.count, 0);
    const nextCount = toFiniteNumber(snapshot.next?.count, 0);
    const pastBytes = toFiniteNumber(snapshot.past?.bytes, 0);
    const nextBytes = toFiniteNumber(snapshot.next?.bytes, 0);
    const maxMessages = toFiniteNumber(snapshot.maxMessagesPerSecond, this._maxMessagesPerSecond);
    const maxBytes = toFiniteNumber(snapshot.maxBytesPerSecond, this._maxBytesPerSecond);
    const overMessageRate = pastCount > maxMessages || nextCount > maxMessages;
    const overByteRate = pastBytes > maxBytes || nextBytes > maxBytes;
    if (overMessageRate || overByteRate) {
      if (now - this._lastRateErrorMs > 1000) {
        this._lastRateErrorMs = now;
        this.recordThrottle(overByteRate ? 'byte-limit' : 'count-limit', now);
      }
    }
  },
};

export { midiSchedulerRateMethods };
