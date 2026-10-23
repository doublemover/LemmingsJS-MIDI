import { normalizeLaneHeight } from './ProcgenLaneGeometry.js';
import { SoundEventBus } from '../../game/SoundEvents.js';
import { EventHandler } from '../../util/EventHandler.js';

const TERMINAL_TYPES = new Set(['lemming-exit', 'lemming-splat', 'lemming-explode', 'lemming-drown', 'lemming-fire', 'lemming-fell-off', 'ActorTerminated', 'ActionExited', 'ContactSpanEnded']);
const validatePhysicalEventIdentity = value => {
  if (value?.version !== 1 || !Number.isSafeInteger(value.causalSequence) || value.causalSequence < 0 ||
      !Number.isSafeInteger(value.legacySequence) || value.legacySequence < 0 ||
      !['complete', 'legacy-unavailable'].includes(value.coverage)) throw new Error('Invalid physical event identity checkpoint.');
  return value;
};
const copyFact = source => {
  const seen = new Set(), budget = { remaining: 512 };
  const copy = (value, depth) => {
    if (--budget.remaining < 0 || depth > 4) throw new Error('Physical fact exceeds its data budget.');
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Physical fact contains a nonfinite number.');
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > 4096) throw new Error('Physical fact contains an oversized string.');
      return value;
    }
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Physical fact contains unsupported data.');
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      if (value.length > 128) throw new Error('Physical fact contains an oversized array.');
      result = value.map(item => copy(item, depth + 1));
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Physical fact contains an unsupported object.');
      result = {};
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Physical fact contains an unsafe key.');
        if (item !== undefined) result[key] = copy(item, depth + 1);
      }
    }
    seen.delete(value);
    return Object.freeze(result);
  };
  return copy(source, 0);
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
    this._causalSequence = 0; this._maxFacts = 4096; this._maxTerminalFacts = 256;
    this.identityCoverage = 'complete';
  }
  beginTick({ worldId, generation, tick, terrainRevisionBefore, sourceTimeMs = null, tickDurationMs = null, ordinal = 0 }) {
    if (this._tick) throw new Error('A physical tick is already being collected.');
    this._sealed = [];
    this._tick = { worldId, generation, tick, terrainRevisionBefore, sourceTimeMs, tickDurationMs,
      facts: [], terminalFacts: [], dropped: 0, ordinal };
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
      const causalSequence = ++this._causalSequence;
      let copied;
      try { copied = copyFact(event); } catch { current.dropped++; return null; }
      const fact = { ...copied, causalSequence,
          ...(this._interventionCommandId && !copied.commandId ? { commandId: this._interventionCommandId } : {}) }, entry = { fact, legacy };
      if (current.facts.length < this._maxFacts) current.facts.push(entry);
      else if ((TERMINAL_TYPES.has(fact.kind) || TERMINAL_TYPES.has(fact.type)) && current.terminalFacts.length < this._maxTerminalFacts) current.terminalFacts.push(entry);
      else current.dropped++;
      return fact;
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
    const sealedFacts = Object.freeze(identified.map(fact => Object.freeze(fact.kind === 'CommandApplied' || fact.kind === 'CommandRejected'
      ? { ...fact, physicalEventIds: Object.freeze(identified.filter(other => other !== fact && other.commandId === fact.commandId).map(other => other.eventId)) }
      : fact)));
    const batch = Object.freeze({ version: 1, worldId: current.worldId, generation: current.generation,
      tick: current.tick, batchId, physicsOrderVersion: 1,
      sourceTimeMs: current.sourceTimeMs, tickDurationMs: current.tickDurationMs,
      firstSequence: sealedFacts[0]?.causalSequence ?? null, lastSequence: sealedFacts.at(-1)?.causalSequence ?? null,
      terrainRevisionBefore: current.terrainRevisionBefore, terrainRevisionAfter, snapshotRevision: snapshot?.revision ?? null,
      facts: sealedFacts, snapshot, terminalGenerationTransition: transitionTo == null ? null : Object.freeze({ from: current.generation, to: transitionTo }),
      completeness: current.dropped ? Object.freeze({ status: 'incomplete', dropped: current.dropped }) : Object.freeze({ status: 'complete', dropped: 0 }) });
    this._sealed.push({ batch, legacyFacts: sealedFacts.filter((_, index) => facts[index].legacy) });
    return batch;
  }
  sealGeneration(snapshot, terrainRevisionAfter, nextGeneration) {
    const current = this._tick;
    if (!current) return;
    this._seal(snapshot, terrainRevisionAfter, nextGeneration);
    this._tick = { worldId: current.worldId, generation: nextGeneration, tick: current.tick,
      terrainRevisionBefore: terrainRevisionAfter, sourceTimeMs: current.sourceTimeMs,
      tickDurationMs: current.tickDurationMs, facts: [], terminalFacts: [], dropped: 0, ordinal: current.ordinal + 1 };
  }
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
