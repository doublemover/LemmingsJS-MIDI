import { normalizeLaneHeight } from './ProcgenLaneGeometry.js';
import { SoundEventBus } from '../../game/SoundEvents.js';
import { EventHandler } from '../../util/EventHandler.js';

const TERMINAL_TYPES = new Set(['lemming-exit', 'lemming-splat', 'lemming-explode', 'lemming-drown', 'lemming-fire', 'lemming-fell-off']);
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
  constructor(onError) { super(); this.onError = onError; }
  trigger(value) {
    if (this._snapshotDirty) { this._snapshot = Array.from(this.handlers); this._snapshotDirty = false; }
    for (const handler of this._snapshot) {
      try { handler(value); } catch (error) { this.onError(error); }
    }
  }
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
    this.onBatch = new IsolatedEventHandler(onError);
    this._tick = null; this._sealed = [];
    this._causalSequence = 0; this._maxFacts = 4096; this._maxTerminalFacts = 256;
  }
  beginTick({ worldId, generation, tick, terrainRevisionBefore }) {
    if (this._tick) throw new Error('A physical tick is already being collected.');
    this._sealed = [];
    this._tick = { worldId, generation, tick, terrainRevisionBefore, facts: [], terminalFacts: [], dropped: 0, ordinal: 0 };
  }
  emit(event) {
    if (event && event.laneIndex == null && Number.isFinite(event.y)) {
      event = { ...event, laneIndex: Math.max(0, Math.min(this.laneCount - 1, Math.floor(event.y / this.laneHeight))) };
    }
    if (this._tick) {
      const current = this._tick;
      const causalSequence = ++this._causalSequence;
      let copied;
      try { copied = copyFact(event); } catch { current.dropped++; return null; }
      const fact = { ...copied, causalSequence };
      if (current.facts.length < this._maxFacts) current.facts.push(fact);
      else if (TERMINAL_TYPES.has(fact.type) && current.terminalFacts.length < this._maxTerminalFacts) current.terminalFacts.push(fact);
      else current.dropped++;
      return fact;
    }
    return super.emit(event);
  }
  _seal(snapshot, terrainRevisionAfter, transitionTo = null) {
    const current = this._tick;
    if (!current) throw new Error('No physical tick is being collected.');
    if (!this.onBatch.handlers.size && !current.facts.length && !current.terminalFacts.length) return null;
    const facts = [...current.facts, ...current.terminalFacts].sort((a, b) => a.causalSequence - b.causalSequence);
    const batchId = `${current.worldId}:${current.generation}:${current.tick}:${current.ordinal}`;
    const sealedFacts = Object.freeze(facts.map(fact => Object.freeze({ ...fact, worldId: current.worldId,
      generation: current.generation, batchId, eventId: `${batchId}:${fact.causalSequence}`,
      simTick: current.tick, subTick: 0, precision: 'tick' })));
    const batch = Object.freeze({ version: 1, worldId: current.worldId, generation: current.generation,
      tick: current.tick, batchId, physicsOrderVersion: 1,
      firstSequence: sealedFacts[0]?.causalSequence ?? null, lastSequence: sealedFacts.at(-1)?.causalSequence ?? null,
      terrainRevisionBefore: current.terrainRevisionBefore, terrainRevisionAfter, snapshotRevision: snapshot?.revision ?? null,
      facts: sealedFacts, snapshot, terminalGenerationTransition: transitionTo == null ? null : Object.freeze({ from: current.generation, to: transitionTo }),
      completeness: current.dropped ? Object.freeze({ status: 'incomplete', dropped: current.dropped }) : Object.freeze({ status: 'complete', dropped: 0 }) });
    this._sealed.push(batch);
    return batch;
  }
  sealGeneration(snapshot, terrainRevisionAfter, nextGeneration) {
    const current = this._tick;
    if (!current) return;
    this._seal(snapshot, terrainRevisionAfter, nextGeneration);
    this._tick = { worldId: current.worldId, generation: nextGeneration, tick: current.tick,
      terrainRevisionBefore: terrainRevisionAfter, facts: [], terminalFacts: [], dropped: 0, ordinal: current.ordinal + 1 };
  }
  commitTick(snapshot, terrainRevisionAfter) {
    this._seal(snapshot, terrainRevisionAfter);
    const batches = this._sealed;
    this._tick = null; this._sealed = [];
    for (const batch of batches) {
      this.onBatch.trigger(batch);
      for (const fact of batch.facts) super.emit(fact);
    }
    return batches;
  }
  abortTick() { this._tick = null; this._sealed = []; }
  dispose() { this.abortTick(); this.onBatch.dispose(); super.dispose(); }
}
export { ProcgenSoundEventBus };
