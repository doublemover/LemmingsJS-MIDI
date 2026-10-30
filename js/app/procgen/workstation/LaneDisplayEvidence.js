import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { procgenLaneIndex } from './ProcgenProjectIndex.js';
import { copyCausalIntentLineage } from './CausalIntentLineage.js';

let nextOwner = 0;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
const label = value => typeof value === 'string' ? value.slice(0, 160) : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const freeze = Object.freeze;
const copyReceipt = receipt => freeze({ intentId: id(receipt.intentId), batchId: id(receipt.batchId), generation: integer(receipt.generation),
  sinkId: id(receipt.sinkId), executionEpoch: id(receipt.executionEpoch), status: label(receipt.status), stage: label(receipt.stage), reason: label(receipt.reason || receipt.terminal?.reason),
  targetFrame: integer(receipt.targetFrame), targetTimeDomain: label(receipt.targetTimeDomain), outputId: id(receipt.outputId), terminalState: label(receipt.terminal?.state), outputRequested: receipt.outputRequested !== false,
  appliedFrame: integer(receipt.appliedFrame), applicationEvidence: label(receipt.applicationEvidence), sampleRate: integer(receipt.sampleRate), bodyInstanceId: id(receipt.bodyInstanceId),
  graphDefinitionHash: id(receipt.graphDefinitionHash), nodeId: id(receipt.nodeId), owner: id(receipt.owner), ownerGeneration: integer(receipt.ownerGeneration), ownerRouteRevision: integer(receipt.ownerRouteRevision) });
const factPoint = fact => {
  for (const [key, evidence] of [['anchor', 'observed-contact-anchor'], ['positionAfter', 'observed-endpoint'], ['positionBefore', 'observed-startpoint']]) {
    const value = fact?.[key]; if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return freeze({ x: value.x, y: value.y, evidence });
  }
  return null;
};

export function createLaneDisplayEvidence({ resourceBudget = null, maximumLanes = 9, maximumHistory = 64, historyTicks = 120 } = {}) {
  if (!Number.isInteger(maximumLanes) || maximumLanes < 1 || maximumLanes > 16) throw new RangeError('Invalid lane display bound.');
  if (!Number.isInteger(maximumHistory) || maximumHistory < 1 || maximumHistory > 128 || !Number.isInteger(historyTicks) || historyTicks < 1 || historyTicks > 6000) throw new RangeError('Invalid causal history bound.');
  const records = new Map(), history = new Map(), owner = 'lane-display-evidence-' + (++nextOwner), storageBytes = maximumLanes * 131072 + maximumHistory * 32768;
  let interested = new Set(), source = null, reservation = null, disposed = false, unavailable = null, revision = 0, latestTick = null, omitted = 0, historyOmitted = 0, historyExpired = 0;
  const ensure = () => {
    if (reservation) return true;
    if (unavailable) return false;
    try { reservation = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'lane-display-evidence', category: 'checkpoint',
      bytes: storageBytes, maxBytes: storageBytes }); return true; }
    catch { unavailable = 'Display evidence storage unavailable'; return false; }
  };
  const receiptFor = (record, receipt) => receipt.intentId === record.intentId && receipt.batchId === record.batchId && receipt.generation === record.generation && id(receipt.executionEpoch);
  const attach = (record, receipts) => {
    const next = [...record.receipts]; let losses = record.omittedReceipts;
    for (const receipt of receipts) {
      if (!receiptFor(record, receipt)) continue;
      const copied = copyReceipt(receipt), index = next.findIndex(value => value.sinkId === copied.sinkId && value.stage === copied.stage && value.executionEpoch === copied.executionEpoch);
      if (index >= 0) next[index] = copied;
      else if (next.length < 4) next.push(copied);
      else losses++;
    }
    return freeze({ ...record, receipts: freeze(next), omittedReceipts: losses });
  };
  return freeze({
    setLanes(laneIds) {
      if (disposed) return;
      if (!Array.isArray(laneIds) || laneIds.length > maximumLanes || laneIds.some(value => !id(value))) throw new RangeError('Invalid visible lane display identities.');
      interested = new Set(laneIds); for (const key of records.keys()) if (!interested.has(key)) records.delete(key);
      for (const [key, event] of history) if (!interested.has(event.laneId)) history.delete(key);
    },
    observe({ sourceKey, batch, intents = [], receipts = [], provenances = [], provenanceDropped = 0, lanes = [] }) {
      if (disposed || !id(sourceKey) || !id(batch?.batchId) || integer(batch?.generation) === null || integer(batch?.tick) === null || !Array.isArray(batch?.facts) || !Array.isArray(intents) || !Array.isArray(receipts) || !Array.isArray(provenances)) return false;
      if (source !== sourceKey) { source = sourceKey; records.clear(); history.clear(); omitted = 0; historyOmitted = 0; historyExpired = 0; latestTick = null; }
      if (latestTick !== null && batch.tick < latestTick) return false;
      latestTick = batch.tick;
      for (const [key, event] of history) if (latestTick - event.tick > historyTicks) { history.delete(key); historyExpired++; }
      if (!interested.size || !ensure()) return false;
      const facts = new Map(), grouped = new Map(), byIntent = new Map(), provenanceByIntent = new Map(); let lost = Math.max(0, batch.facts.length - 512) + Math.max(0, intents.length - 512) + Math.max(0, receipts.length - 512) + Math.max(0, provenances.length - 512) + (integer(provenanceDropped) ?? 0);
      for (let index = 0; index < Math.min(512, batch.facts.length); index++) { const fact = batch.facts[index]; if (id(fact?.eventId)) facts.set(fact.eventId, fact); }
      for (let index = 0; index < Math.min(512, receipts.length); index++) { const receipt = receipts[index]; if (!id(receipt?.intentId)) continue; if (!byIntent.has(receipt.intentId)) byIntent.set(receipt.intentId, []); byIntent.get(receipt.intentId).push(receipt); }
      for (let index = 0; index < Math.min(512, provenances.length); index++) {
        const value = provenances[index]; if (value?.version !== 1 || !id(value.intentId)) continue;
        const previous = provenanceByIntent.get(value.intentId);
        if (provenanceByIntent.has(value.intentId) && (!previous || ['batchId', 'generation', 'mappingId', 'graphRevision', 'mappingRevision', 'evidence'].some(key => previous[key] !== value[key]))) provenanceByIntent.set(value.intentId, null);
        else provenanceByIntent.set(value.intentId, value);
      }
      for (let index = 0; index < Math.min(512, intents.length); index++) {
        const intent = intents[index], laneId = typeof intent?.laneId === 'number' ? lanes[intent.laneId]?.id : intent?.laneId;
        if (!interested.has(laneId)) continue;
        if (!id(intent.intentId) || intent.batchId !== batch.batchId || intent.generation !== batch.generation || !Array.isArray(intent.sourceEventIds)) { lost++; continue; }
        if (!grouped.has(laneId)) grouped.set(laneId, []);
        const group = grouped.get(laneId);
        if (group.length >= 4) { lost++; continue; }
        const sources = [], sourceIds = intent.sourceEventIds.slice(0, 4).filter(value => id(value));
        const observed = provenanceByIntent.get(intent.intentId), provenance = observed?.batchId === batch.batchId && observed?.generation === batch.generation && observed?.mappingId === intent.mappingId && observed?.evidence === 'canonical-intent-construction' && integer(observed?.graphRevision) !== null &&
          (observed.mappingRevision == null || integer(observed.mappingRevision) !== null && observed.mappingRevision <= observed.graphRevision) ? observed : null;
        for (const eventId of sourceIds) {
          const fact = facts.get(eventId); sources.push(freeze({ eventId, recorded: !!fact, tick: fact ? batch.tick : null, kind: label(fact?.kind), action: label(fact?.action || fact?.operationKind),
            actorId: typeof fact?.actorId === 'number' ? integer(fact.actorId) : id(fact?.actorId), actorState: 'past-reference', terminationTick: null, sequence: integer(fact?.causalSequence), laneIndex: integer(fact?.laneId), point: factPoint(fact) }));
        }
        const record = freeze({ intentId: intent.intentId, sourceKey, worldId: id(batch.worldId), laneId, laneIndex: integer(typeof intent.laneId === 'number' ? intent.laneId : procgenLaneIndex(lanes).get(laneId)), batchId: batch.batchId, generation: batch.generation, tick: batch.tick, actorState: 'past-reference', terminationTick: null,
          actorId: typeof intent.actorId === 'number' ? integer(intent.actorId) : id(intent.actorId), voiceId: id(intent.voiceId), mappingId: id(intent.mappingId), ...copyCausalIntentLineage(intent, batch),
          graphRevision: integer(intent.graphRevision) ?? integer(provenance?.graphRevision), mappingRevision: integer(provenance?.mappingRevision), mappingEvidence: provenance ? 'canonical-intent-construction' : 'unrecorded', kind: label(intent.kind), sourceKind: label(intent.physicalSourceKind), action: label(intent.physicalAction),
          pitchCents: Number.isFinite(intent.pitch?.cents) ? intent.pitch.cents : null, velocity01: Number.isFinite(intent.velocity01) ? intent.velocity01 : null,
          sources: freeze(sources), omittedSources: intent.sourceEventIds.length - sources.length, receipts: freeze([]), omittedReceipts: 0 });
        group.push(attach(record, byIntent.get(intent.intentId) || []));
      }
      omitted += lost; revision++;
      for (const [laneId, events] of grouped) records.set(laneId, freeze({ laneId, revision, sourceTick: batch.tick, events: freeze(events),
        completeness: batch.completeness?.status === 'complete' && !lost && events.every(event => !event.omittedSources && !event.omittedReceipts && event.sources.every(value => value.recorded)) ? 'complete' : 'partial',
        sourceDropped: integer(batch.completeness?.dropped), omitted: lost }));
      for (const events of grouped.values()) for (const event of events) {
        history.delete(event.intentId);
        if (history.size >= maximumHistory) { history.delete(history.keys().next().value); historyOmitted++; }
        history.set(event.intentId, event);
      }
      const terminated = new Set(); for (const fact of facts.values()) if (fact.kind === 'ActorTerminated' && fact.actorId != null) terminated.add(fact.actorId);
      if (terminated.size) {
        const tombstones = new Map(), terminal = event => {
          const ownerEnded = terminated.has(event.actorId) && event.actorState !== 'terminated', sourceEnded = event.sources.some(source => source.recorded && terminated.has(source.actorId) && source.actorState !== 'terminated');
          if (!ownerEnded && !sourceEnded) return event;
          if (!tombstones.has(event.intentId)) tombstones.set(event.intentId, freeze({ ...event, actorState: ownerEnded ? 'terminated' : event.actorState, terminationTick: ownerEnded ? batch.tick : event.terminationTick,
            sources: freeze(event.sources.map(source => source.recorded && terminated.has(source.actorId) && source.actorState !== 'terminated' ? freeze({ ...source, actorState: 'terminated', terminationTick: batch.tick }) : source)) })); return tombstones.get(event.intentId);
        };
        for (const [key, event] of history) history.set(key, terminal(event));
        for (const [key, value] of records) records.set(key, freeze({ ...value, events: freeze(value.events.map(terminal)) }));
      }
      return grouped.size > 0;
    },
    receipt(sourceKey, receipt) {
      if (disposed || sourceKey !== source || !id(receipt?.intentId) || !id(receipt.executionEpoch)) return false;
      let changed = false; const replacements = new Map();
      const eligible = event => receiptFor(event, receipt) && event.receipts.some(value => value.executionEpoch === receipt.executionEpoch && value.sinkId === receipt.sinkId);
      const updated = event => { if (!eligible(event)) return event; if (!replacements.has(event.intentId)) replacements.set(event.intentId, attach(event, [receipt])); return replacements.get(event.intentId); };
      for (const [laneId, record] of records) {
        if (!record.events.some(eligible)) continue;
        const events = record.events.map(updated);
        records.set(laneId, freeze({ ...record, revision: ++revision, events: freeze(events), completeness: events.some(event => event.omittedReceipts) ? 'partial' : record.completeness })); changed = true;
      }
      for (const [key, event] of history) if (eligible(event)) { history.set(key, updated(event)); changed = true; }
      if (changed) revision++;
      return changed;
    },
    read(laneId, sourceKey) {
      const record = !disposed && source === sourceKey && records.get(laneId);
      return freeze({ available: !disposed && !unavailable, reason: disposed ? 'Display retired' : unavailable, revision, latestTick: source === sourceKey ? latestTick : null,
        omitted: source === sourceKey ? omitted : 0, record: record || null,
        history: freeze(!disposed && source === sourceKey ? [...history.values()].filter(event => event.laneId === laneId) : []),
        historyOmitted: source === sourceKey ? historyOmitted : 0, historyExpired: source === sourceKey ? historyExpired : 0, historyTicks });
    },
    diagnostics: () => freeze({ lanes: records.size, interested: interested.size, maximumLanes, history: history.size, maximumHistory, historyTicks, historyOmitted, historyExpired, omitted, disposed, reservation: reservation?.receipt() || null }),
    dispose() {
      if (disposed) { const receipt = reservation?.receipt(); if (receipt && receipt.state !== 'released') throw new Error('Display evidence retirement remains unconfirmed.'); return receipt; }
      disposed = true; interested.clear(); records.clear(); history.clear(); return reservation?.release() || null;
    }
  });
}
