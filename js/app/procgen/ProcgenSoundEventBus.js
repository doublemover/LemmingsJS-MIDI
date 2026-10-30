import { normalizeLaneHeight } from './ProcgenLaneGeometry.js';
import { SoundEventBus } from '../../game/SoundEvents.js';
import { EventHandler } from '../../util/EventHandler.js';

const TERMINAL_TYPES = new Set(['lemming-exit', 'lemming-splat', 'lemming-explode', 'lemming-drown', 'lemming-fire', 'lemming-fell-off', 'ActorTerminated', 'ActionExited', 'ContactSpanEnded', 'FlightArcEnded']);
const validatePhysicalEventIdentity = value => {
  if (value?.version !== 1 || !Number.isSafeInteger(value.causalSequence) || value.causalSequence < 0 || value.causalSequence >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(value.legacySequence) || value.legacySequence < 0 || value.legacySequence >= Number.MAX_SAFE_INTEGER ||
      !['complete', 'legacy-unavailable'].includes(value.coverage)) throw new Error('Invalid physical event identity checkpoint.');
  return value;
};
const copyFact = source => {
  const seen = new Set(), extended = ['CommandApplied', 'CommandRejected', 'CommandWaiting', 'TerrainWorkCommitted'].includes(source?.kind), budget = { remaining: extended ? 4096 : 512, bytes: 0, maximumBytes: extended ? 131072 : 32768 };
  const account = bytes => { budget.bytes += bytes; if (budget.bytes > budget.maximumBytes) throw new Error('Physical fact byte budget exceeded.'); };
  const copy = (value, depth) => {
    if (--budget.remaining < 0 || depth > 8) throw new Error('Physical fact exceeds its data budget.');
    if (value == null || typeof value === 'boolean') { account(8); return value; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Physical fact contains a nonfinite number.');
      account(8); return value;
    }
    if (typeof value === 'string') {
      if (value.length > 4096) throw new Error('Physical fact contains an oversized string.');
      account(16 + value.length * 2); return value;
    }
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Physical fact contains unsupported data.');
    account(32); seen.add(value);
    let result;
    if (Array.isArray(value)) {
      if (value.length > 128) throw new Error('Physical fact contains an oversized array.');
      result = value.map(item => copy(item, depth + 1));
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Physical fact contains an unsupported object.');
      result = {};
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Physical fact contains an unsafe key.');
        if (item !== undefined) { account(key.length * 2 + 8); result[key] = copy(item, depth + 1); }
      }
    }
    seen.delete(value);
    return Object.freeze(result);
  };
  const value = copy(source, 0); return { value, bytes: budget.bytes + 256 };
};

// Musical subscribers are outside the physics transaction. A faulty output
// cannot interrupt another actor or hide the committed batch from its peers.
class IsolatedEventHandler extends EventHandler {
  constructor(onError, quarantine = false) { super(); this.onError = onError; this.quarantine = quarantine; this.quarantined = new Set(); }
  trigger(value) {
    if (this._snapshotDirty) { this._snapshot = Array.from(this.handlers); this._snapshotDirty = false; }
    for (const handler of this._snapshot) {
      if (this.quarantined.has(handler)) continue;
      try { handler(value); } catch (error) {
        if (this.quarantine) this.quarantined.add(handler);
        this.onError(error);
      }
    }
  }
  off(handler) { this.quarantined.delete(handler); super.off(handler); }
  dispose() { this.quarantined.clear(); super.dispose(); }
}

// Shared actions report actual world coordinates; an event emitted during a
// boundary-crossing action must already identify its destination stripe.
class ProcgenSoundEventBus extends SoundEventBus {
  constructor(timer, laneCount, laneHeight = 96) {
    super(timer);
    this.laneCount = laneCount; this.laneHeight = normalizeLaneHeight(laneHeight);
    this.deliveryErrors = 0; this.lastDeliveryError = null;
    const onError = error => { this.deliveryErrors++; this.lastDeliveryError = String(error?.message || error); };
    this.onEvent = new IsolatedEventHandler(onError);
    this.onBatch = new IsolatedEventHandler(onError, true);
    this._tick = null; this._sealed = [];
    this._causalSequence = 0; this._maxFacts = 4096; this._maxTerminalFacts = 256; this._maxFactBytes = 8 * 1048576; this._maxTerminalFactBytes = 524288; this._lastFactBudget = null;
    this.identityCoverage = 'complete';
  }
  beginTick({ worldId, generation, tick, terrainRevisionBefore, sourceTimeMs = null, tickDurationMs = null, ordinal = 0 }) {
    if (this._tick) throw new Error('A physical tick is already being collected.');
    this._sealed = [];
    this._tick = { worldId, generation, tick, terrainRevisionBefore, sourceTimeMs, tickDurationMs,
      facts: [], terminalFacts: [], factBytes: 0, terminalBytes: 0, dropped: 0, ordinal };
  }
  emit(event) {
    if (event && event.laneIndex == null && Number.isFinite(event.y)) {
      event = { ...event, laneIndex: Math.max(0, Math.min(this.laneCount - 1, Math.floor(event.y / this.laneHeight))) };
    }
    if (this._tick) return this._stage(event, true);
    return super.emit(event);
  }
  emitPhysicalFact(event) {
    if (!this._tick || !this.onBatch.handlers.size) return null;
    return this._stage(event, false);
  }
  _stage(event, legacy) {
    if (this._tick) {
      const current = this._tick;
      if (!Number.isSafeInteger(this._causalSequence + 1)) throw new RangeError('Physical event sequence exhausted.');
      const causalSequence = ++this._causalSequence;
      let copied;
      try { copied = copyFact(event); } catch { current.dropped++; return null; }
      const fact = { ...copied.value, causalSequence, eventId: `${this.pendingBatchIdentity()}:${causalSequence}`,
          ...(this._interventionCommandId && !copied.value.commandId ? { commandId: this._interventionCommandId } : {}) }, entry = { fact, legacy };
      if (current.facts.length < this._maxFacts && current.factBytes + copied.bytes <= this._maxFactBytes) { current.facts.push(entry); current.factBytes += copied.bytes; }
      else if ((TERMINAL_TYPES.has(fact.kind) || TERMINAL_TYPES.has(fact.type)) && current.terminalFacts.length < this._maxTerminalFacts && current.terminalBytes + copied.bytes <= this._maxTerminalFactBytes) { current.terminalFacts.push(entry); current.terminalBytes += copied.bytes; }
      else { current.dropped++; return null; }
      return Object.freeze(fact);
    }
    return null;
  }
  _seal(snapshot, terrainRevisionAfter, transitionTo = null) {
    const current = this._tick;
    if (!current) throw new Error('No physical tick is being collected.');
    if (!this.onBatch.handlers.size && !current.facts.length && !current.terminalFacts.length) return null;
    const facts = [...current.facts, ...current.terminalFacts].sort((a, b) => a.fact.causalSequence - b.fact.causalSequence);
    const batchId = `${current.worldId}:${current.generation}:${current.tick}:${current.ordinal}`;
    const identified = facts.map(({ fact }) => ({ ...fact, worldId: current.worldId,
      generation: current.generation, batchId, eventId: `${batchId}:${fact.causalSequence}`,
      simTick: current.tick, subTick: 0, precision: fact.precision || 'tick' }));
    // A motion's earlier support query is only a candidate. Join it to the
    // completed terrain observation after every actor has had a chance to edit
    // support. This is discrete endpoint evidence, never swept contact.
    const contacts = new Map();
    for (const fact of identified) if (['ContactSpanBegan', 'ContactSpanUpdated'].includes(fact.kind)) contacts.set(fact.spanId, fact);
    for (const fact of identified) if (fact.kind === 'MotionCommitted' && fact.contactSpanId) {
      const contact = contacts.get(fact.contactSpanId);
      const qualified = contact && contact.actorId === fact.actorId && contact.actionInstanceId === fact.actionInstanceId && contact.observedTick === current.tick;
      fact.physicalPayload = Object.freeze({ ...fact.physicalPayload, contactObserved: !!qualified,
        contactEvidence: qualified ? 'consecutive-support-endpoints-and-completed-terrain' : 'unknown',
        contactSurfaceRevision: qualified ? contact.surfaceRevision : null, contactObservedTick: qualified ? contact.observedTick : null });
      if (!qualified) fact.contactSpanId = null;
    }
    const byCommand = new Map();
    for (const fact of identified) if (fact.commandId && !['CommandApplied', 'CommandRejected', 'CommandWaiting'].includes(fact.kind)) {
      if (!byCommand.has(fact.commandId)) byCommand.set(fact.commandId, []); byCommand.get(fact.commandId).push(fact.eventId);
    }
    const sealedFacts = Object.freeze(identified.map(fact => Object.freeze(fact.kind === 'CommandApplied' || fact.kind === 'CommandRejected'
      ? { ...fact, physicalEventIds: Object.freeze(byCommand.get(fact.commandId) || []) }
      : fact)));
    const batch = Object.freeze({ version: 1, worldId: current.worldId, generation: current.generation,
      tick: current.tick, batchId, physicsOrderVersion: 1,
      sourceTimeMs: current.sourceTimeMs, tickDurationMs: current.tickDurationMs,
      firstSequence: sealedFacts[0]?.causalSequence ?? null, lastSequence: sealedFacts.at(-1)?.causalSequence ?? null,
      terrainRevisionBefore: current.terrainRevisionBefore, terrainRevisionAfter, snapshotRevision: snapshot?.revision ?? null,
      facts: sealedFacts, snapshot, terminalGenerationTransition: transitionTo == null ? null : Object.freeze({ from: current.generation, to: transitionTo }),
      completeness: current.dropped ? Object.freeze({ status: 'incomplete', dropped: current.dropped }) : Object.freeze({ status: 'complete', dropped: 0 }) });
    this._lastFactBudget = Object.freeze({ factBytes: current.factBytes, terminalBytes: current.terminalBytes, maximumFactBytes: this._maxFactBytes, maximumTerminalBytes: this._maxTerminalFactBytes, dropped: current.dropped, accounting: 'bounded-copy-estimate' });
    this._sealed.push({ batch, legacyFacts: sealedFacts.filter((_, index) => facts[index].legacy) });
    return batch;
  }
  sealGeneration(snapshot, terrainRevisionAfter, nextGeneration) {
    const current = this._tick;
    if (!current) return;
    this._seal(snapshot, terrainRevisionAfter, nextGeneration);
    this._tick = { worldId: current.worldId, generation: nextGeneration, tick: current.tick,
      terrainRevisionBefore: terrainRevisionAfter, sourceTimeMs: current.sourceTimeMs,
      tickDurationMs: current.tickDurationMs, facts: [], terminalFacts: [], factBytes: 0, terminalBytes: 0, dropped: 0, ordinal: current.ordinal + 1 };
  }
  factBudget() { return this._lastFactBudget; }
  pendingBatchIdentity() { const tick = this._tick; return tick ? `${tick.worldId}:${tick.generation}:${tick.tick}:${tick.ordinal}` : null; }
  commitTick(snapshot, terrainRevisionAfter) {
    this._seal(snapshot, terrainRevisionAfter);
    const sealed = this._sealed;
    this._tick = null; this._sealed = [];
    for (const { batch, legacyFacts } of sealed) {
      this.onBatch.trigger(batch);
      for (const fact of legacyFacts) super.emit(fact);
    }
    return sealed.map(entry => entry.batch);
  }
  abortTick() { this._tick = null; this._sealed = []; }
  snapshotIdentity() {
    if (this._tick) throw new Error('Cannot checkpoint an uncommitted physical tick.');
    return Object.freeze({ version: 1, causalSequence: this._causalSequence, legacySequence: this._sequence, coverage: this.identityCoverage });
  }
  restoreIdentity(value) {
    if (this._tick) throw new Error('Cannot replace an uncommitted physical identity.');
    const next = value == null ? { causalSequence: 0, legacySequence: 0, coverage: 'legacy-unavailable' } : validatePhysicalEventIdentity(value);
    this._causalSequence = next.causalSequence; this._sequence = next.legacySequence; this.identityCoverage = next.coverage;
    this._queue.length = 0;
  }
  dispose() { this.abortTick(); this.onBatch.dispose(); super.dispose(); }
}
export { ProcgenSoundEventBus, validatePhysicalEventIdentity };
