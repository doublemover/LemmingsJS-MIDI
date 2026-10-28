import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

let nextOwner = 0;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
const label = value => typeof value === 'string' ? value.slice(0, 160) : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const freeze = Object.freeze;
const copyReceipt = receipt => freeze({ intentId: id(receipt.intentId), batchId: id(receipt.batchId), generation: integer(receipt.generation),
  sinkId: id(receipt.sinkId), executionEpoch: id(receipt.executionEpoch), status: label(receipt.status), stage: label(receipt.stage), reason: label(receipt.reason),
  targetFrame: integer(receipt.targetFrame), targetTimeDomain: label(receipt.targetTimeDomain), outputId: id(receipt.outputId), outputRequested: receipt.outputRequested !== false });

export function createLaneDisplayEvidence({ resourceBudget = null, maximumLanes = 9 } = {}) {
  if (!Number.isInteger(maximumLanes) || maximumLanes < 1 || maximumLanes > 16) throw new RangeError('Invalid lane display bound.');
  const records = new Map(), owner = 'lane-display-evidence-' + (++nextOwner);
  let interested = new Set(), source = null, reservation = null, disposed = false, unavailable = null, revision = 0, latestTick = null, omitted = 0;
  const ensure = () => {
    if (reservation) return true;
    if (unavailable) return false;
    try { reservation = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'lane-display-evidence', category: 'checkpoint',
      bytes: maximumLanes * 131072, maxBytes: maximumLanes * 131072 }); return true; }
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
    },
    observe({ sourceKey, batch, intents = [], receipts = [], lanes = [] }) {
      if (disposed || !id(sourceKey) || !id(batch?.batchId) || integer(batch?.generation) === null || integer(batch?.tick) === null || !Array.isArray(batch?.facts) || !Array.isArray(intents) || !Array.isArray(receipts)) return false;
      if (source !== sourceKey) { source = sourceKey; records.clear(); omitted = 0; }
      latestTick = batch.tick;
      if (!interested.size || !ensure()) return false;
      const facts = new Map(), grouped = new Map(), byIntent = new Map(); let lost = Math.max(0, batch.facts.length - 512) + Math.max(0, intents.length - 512) + Math.max(0, receipts.length - 512);
      for (let index = 0; index < Math.min(512, batch.facts.length); index++) { const fact = batch.facts[index]; if (id(fact?.eventId)) facts.set(fact.eventId, fact); }
      for (let index = 0; index < Math.min(512, receipts.length); index++) { const receipt = receipts[index]; if (!id(receipt?.intentId)) continue; if (!byIntent.has(receipt.intentId)) byIntent.set(receipt.intentId, []); byIntent.get(receipt.intentId).push(receipt); }
      for (let index = 0; index < Math.min(512, intents.length); index++) {
        const intent = intents[index], laneId = typeof intent?.laneId === 'number' ? lanes[intent.laneId]?.id : intent?.laneId;
        if (!interested.has(laneId)) continue;
        if (!id(intent.intentId) || intent.batchId !== batch.batchId || intent.generation !== batch.generation || !Array.isArray(intent.sourceEventIds)) { lost++; continue; }
        if (!grouped.has(laneId)) grouped.set(laneId, []);
        const group = grouped.get(laneId);
        if (group.length >= 4) { lost++; continue; }
        const sources = [], sourceIds = intent.sourceEventIds.slice(0, 4).filter(value => id(value));
        for (const eventId of sourceIds) {
          const fact = facts.get(eventId); sources.push(freeze({ eventId, recorded: !!fact, kind: label(fact?.kind), action: label(fact?.action),
            actorId: typeof fact?.actorId === 'number' ? integer(fact.actorId) : id(fact?.actorId), sequence: integer(fact?.causalSequence) }));
        }
        const record = freeze({ intentId: intent.intentId, batchId: batch.batchId, generation: batch.generation, tick: batch.tick,
          actorId: typeof intent.actorId === 'number' ? integer(intent.actorId) : id(intent.actorId), voiceId: id(intent.voiceId), mappingId: id(intent.mappingId),
          graphRevision: integer(intent.graphRevision), kind: label(intent.kind), sourceKind: label(intent.physicalSourceKind), action: label(intent.physicalAction),
          pitchCents: Number.isFinite(intent.pitch?.cents) ? intent.pitch.cents : null, velocity01: Number.isFinite(intent.velocity01) ? intent.velocity01 : null,
          sources: freeze(sources), omittedSources: intent.sourceEventIds.length - sources.length, receipts: freeze([]), omittedReceipts: 0 });
        group.push(attach(record, byIntent.get(intent.intentId) || []));
      }
      omitted += lost; revision++;
      for (const [laneId, events] of grouped) records.set(laneId, freeze({ laneId, revision, sourceTick: batch.tick, events: freeze(events),
        completeness: batch.completeness?.status === 'complete' && !lost && events.every(event => !event.omittedSources && !event.omittedReceipts && event.sources.every(value => value.recorded)) ? 'complete' : 'partial',
        sourceDropped: integer(batch.completeness?.dropped), omitted: lost }));
      return grouped.size > 0;
    },
    receipt(sourceKey, receipt) {
      if (disposed || sourceKey !== source || !id(receipt?.intentId) || !id(receipt.executionEpoch)) return false;
      let changed = false;
      for (const [laneId, record] of records) {
        const eligible = event => receiptFor(event, receipt) && event.receipts.some(value => value.executionEpoch === receipt.executionEpoch && value.sinkId === receipt.sinkId);
        if (!record.events.some(eligible)) continue;
        records.set(laneId, freeze({ ...record, revision: ++revision, events: freeze(record.events.map(event => eligible(event) ? attach(event, [receipt]) : event)) })); changed = true;
      }
      return changed;
    },
    read(laneId, sourceKey) {
      const record = !disposed && source === sourceKey && records.get(laneId);
      return freeze({ available: !disposed && !unavailable, reason: disposed ? 'Display retired' : unavailable, revision, latestTick: source === sourceKey ? latestTick : null,
        omitted: source === sourceKey ? omitted : 0, record: record || null });
    },
    diagnostics: () => freeze({ lanes: records.size, interested: interested.size, maximumLanes, omitted, disposed, reservation: reservation?.receipt() || null }),
    dispose() {
      if (disposed) { const receipt = reservation?.receipt(); if (receipt && receipt.state !== 'released') throw new Error('Display evidence retirement remains unconfirmed.'); return receipt; }
      disposed = true; interested.clear(); records.clear(); return reservation?.release() || null;
    }
  });
}
