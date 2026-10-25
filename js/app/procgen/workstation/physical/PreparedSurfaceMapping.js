import { cloneData, freezeData, canonicalDataText } from '../../../../core/CanonicalData.js';
import { validatePreparedSurfaceMap, validateMappedBodyPreparation, projectPreparedSurfacePoint } from '../../../../midi/content/PreparedSurface.js';

const id = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9._:-]{0,47}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const EMPTY = Object.freeze([]), MAX_HELD = 32, MAX_COMMANDS = 1024;
export function validatePreparedSurfaceDefinitions(raw = []) {
  const values = JSON.parse(canonicalDataText(raw, { maxBytes: 65536, maxNodes: 2048 }).text);
  if (!Array.isArray(values) || values.length > 4) throw new TypeError('Prepare at most four explicitly mapped surfaces.');
  const seen = new Set();
  for (const surface of values) {
    if (!keys(surface, ['schema', 'id', 'revision', 'surfaceMap', 'preparations', 'heldContactPolicy', 'unknownPolicy']) || surface.schema !== 'lemmings-prepared-surface/v1' || !id(surface.id) || seen.has(surface.id) || !integer(surface.revision) ||
        surface.heldContactPolicy !== 'keep-old-tail' || surface.unknownPolicy !== 'release' || !Array.isArray(surface.preparations) || !surface.preparations.length || surface.preparations.length > 4) throw new TypeError('Invalid prepared surface identity or held-contact policy.');
    seen.add(surface.id); surface.surfaceMap = validatePreparedSurfaceMap(surface.surfaceMap); const slots = new Set();
    for (const preparation of surface.preparations) {
      if (!keys(preparation, ['id', 'kind', 'sourceLanes', 'actions', 'beginPolicy', 'radius01', 'amount01', 'lossMaskId']) || !id(preparation.id) || slots.has(preparation.id) || !['touch', 'pickup-left', 'pickup-right', 'mode-loss'].includes(preparation.kind) ||
          !['observed-span-begin', 'current-observed-contact'].includes(preparation.beginPolicy) || !Array.isArray(preparation.sourceLanes) || !preparation.sourceLanes.length || preparation.sourceLanes.length > 32 ||
          preparation.sourceLanes.some(value => !integer(value) || value >= 1024) || new Set(preparation.sourceLanes).size !== preparation.sourceLanes.length ||
          !Array.isArray(preparation.actions) || !preparation.actions.length || preparation.actions.length > 8 || preparation.actions.some(value => typeof value !== 'string' || !value || value.length > 64) || new Set(preparation.actions).size !== preparation.actions.length) throw new TypeError('Invalid bounded contact preparation mapping.');
      if (preparation.kind === 'touch' ? preparation.lossMaskId != null || !Number.isFinite(preparation.radius01) || preparation.radius01 < 0.08 || preparation.radius01 > 0.18 || !Number.isFinite(preparation.amount01) || preparation.amount01 < 0 || preparation.amount01 > 1 : preparation.kind === 'mode-loss' ? !id(preparation.lossMaskId) || preparation.radius01 != null || !Number.isFinite(preparation.amount01) || preparation.amount01 < 0 || preparation.amount01 > 1 : preparation.radius01 != null || preparation.amount01 != null || preparation.lossMaskId != null) throw new TypeError('Touch consumes spatial positive loss; mode-loss consumes an authored mask; pickup consumes observation coordinates only.');
      slots.add(preparation.id); preparation.sourceLanes.sort((a, b) => a - b); preparation.actions.sort();
    }
  }
  return freezeData(values);
}
export function createPreparedSurfaceMapping() {
  let definitions = EMPTY, configuration = '[]', last = { worldId: null, generation: null, tick: -1, sequence: -1 }, declined = 0, capped = 0;
  const held = new Map(), surfaceKeys = new Map();
  const prepareConfiguration = values => {
    const next = validatePreparedSurfaceDefinitions(values), nextKeys = new Map(next.map(surface => [surface.id, canonicalDataText(surface).text]));
    for (const surface of next) { const prior = definitions.find(value => value.id === surface.id); if (prior?.revision === surface.revision && surfaceKeys.get(surface.id) !== nextKeys.get(surface.id)) throw new Error('Prepared surface changed without a new content revision.'); }
    return { next, nextKeys };
  };
  const configure = values => {
    const { next, nextKeys } = prepareConfiguration(values);
    definitions = next; configuration = canonicalDataText(definitions).text; surfaceKeys.clear(); for (const [id, value] of nextKeys) surfaceKeys.set(id, value);
  };
  const keyFor = (surface, preparation, fact) => JSON.stringify([surface.id, preparation.id, fact.spanId]);
  const commandFor = (batch, record, fact, operation, scoreTimeFor, reason = null) => {
    const surface = record.surface, preparation = record.preparation, map = surface.surfaceMap, ending = operation === 'end';
    const eventIds = fact?.eventId ? [fact.eventId] : record.sourceEventIds;
    return validateMappedBodyPreparation({ schema: 'lemmings-mapped-body-preparation/v1', commandId: batch.batchId + ':' + surface.id + ':' + preparation.id + ':' + record.contactSpanId + ':' + operation + ':r' + surface.revision + ':' + (fact?.causalSequence ?? 'boundary'),
      batchId: batch.batchId, stage: 'physical-mapping-output-not-audio-admission', operation, kind: preparation.kind, surfaceId: surface.id, mapId: map.id, mapRevision: map.revision,
      mappingId: surface.id + '.' + preparation.id, mappingRevision: surface.revision, preparationSlot: preparation.id, beginPolicy: preparation.beginPolicy, contactSpanId: record.contactSpanId, actorId: record.actorId,
      worldId: record.worldId, generation: record.generation, sourceTick: batch.tick, sourceSequence: fact?.causalSequence ?? (reason === 'mapping-changed' || reason === 'execution-ended' ? batch.facts[0]?.causalSequence : batch.facts.at(-1)?.causalSequence) ?? Math.max(0, last.sequence),
      sourceEventIds: eventIds, sourceKind: fact?.kind || (reason === 'mapping-changed' ? 'mapping-changed' : 'coverage-ended'), sourceEditRevision: map.sourceEditRevision, boundTopologyRevision: map.boundTopologyRevision,
      position: ending ? null : { ...fact.anchor }, radius01: ending || preparation.kind !== 'touch' ? null : preparation.radius01, amount01: ending || !['touch', 'mode-loss'].includes(preparation.kind) ? null : preparation.amount01,
      ...(preparation.kind === 'mode-loss' ? { lossMaskId: preparation.lossMaskId } : {}),
      scoreTime: scoreTimeFor(batch, fact), reason });
  };
  const consume = (batch, { allowNew = true, scoreTimeFor } = {}) => {
    if (typeof scoreTimeFor !== 'function') throw new TypeError('Prepared mapping uses the existing semantic score timeline.');
    if (!definitions.length && !held.size) return Object.freeze({ commands: EMPTY, completeness: 'complete' });
    const output = [], observed = new Set(); let failed = false;
    const end = (key, record, fact, reason) => { output.push(commandFor(batch, record, fact, 'end', scoreTimeFor, reason)); held.delete(key); };
    if (held.size && (last.worldId !== batch.worldId || last.generation !== batch.generation || !allowNew || batch.completeness.status !== 'complete')) {
      for (const [key, record] of held) end(key, record, null, !allowNew || batch.completeness.status !== 'complete' ? 'unknown-source-coverage' : 'execution-ended');
    }
    for (const [key, record] of held) if (surfaceKeys.get(record.surface.id) !== record.surfaceKey) end(key, record, null, 'mapping-changed');
    if (allowNew && batch.completeness.status === 'complete') for (const fact of batch.facts) {
      if ((fact.kind === 'ContactSpanEnded' || fact.kind === 'ActorTerminated') && fact.worldId === batch.worldId && fact.generation === batch.generation) {
        for (const [key, record] of held) if (record.actorId === fact.actorId && (fact.kind === 'ActorTerminated' || record.contactSpanId === fact.spanId)) end(key, record, fact, fact.reason || fact.terminationReason || 'contact-ended');
        continue;
      }
      if (!['ContactSpanBegan', 'ContactSpanUpdated'].includes(fact.kind)) continue;
      for (const surface of definitions) for (const preparation of surface.preparations) {
        const key = keyFor(surface, preparation, fact), record = held.get(key);
        const qualifies = fact.worldId === batch.worldId && fact.generation === batch.generation && typeof fact.spanId === 'string' && fact.spanId.length <= 512 && fact.spanId.length > 0 &&
          typeof fact.eventId === 'string' && fact.eventId.length > 0 && fact.eventId.length <= 512 && integer(fact.actorId) && fact.observedTick === batch.tick && fact.physicalPayload?.evidence === 'completed-support-cell' && fact.causeKind === 'support' &&
          fact.surfaceRevision === surface.surfaceMap.boundTopologyRevision && preparation.sourceLanes.includes(fact.laneId) && preparation.actions.includes(fact.action);
        let point = false; if (qualifies) { try { projectPreparedSurfacePoint(surface.surfaceMap, fact.anchor); point = true; } catch {} }
        if (!qualifies || !point || record && record.actorId !== fact.actorId) { if (record) end(key, record, fact, 'unknown-or-foreign-contact'); declined++; continue; }
        if (!record && fact.kind !== 'ContactSpanBegan' && preparation.beginPolicy !== 'current-observed-contact') continue;
        if (!record && held.size >= MAX_HELD || output.length >= MAX_COMMANDS - MAX_HELD) { failed = true; capped++; break; }
        const next = record || { surface, surfaceKey: surfaceKeys.get(surface.id), preparation, contactSpanId: fact.spanId, actorId: fact.actorId, worldId: batch.worldId, generation: batch.generation };
        output.push(commandFor(batch, next, fact, record ? 'update' : 'begin', scoreTimeFor));
        next.position = { ...fact.anchor }; next.sourceEventIds = [fact.eventId]; next.observedTick = batch.tick; next.sourceSequence = fact.causalSequence; held.set(key, next); observed.add(key);
      }
      if (failed) break;
    }
    for (const [key, record] of held) if (failed || !observed.has(key)) end(key, record, null, failed ? 'preparation-mapping-budget' : 'contact-continuity-unknown');
    last = { worldId: batch.worldId, generation: batch.generation, tick: batch.tick, sequence: batch.facts.at(-1)?.causalSequence ?? last.sequence };
    return freezeData({ commands: output, completeness: failed ? 'capped-release' : 'complete' });
  };
  const snapshot = () => freezeData({ version: 1, configuration, cursor: { ...last }, held: [...held].map(([key, value]) => ({ key, ...value })), declined, capped });
  const restore = raw => {
    const p = cloneData(raw, { maxBytes: 2 * 1048576, maxNodes: 32768 });
    if (!p || p.version !== 1 || p.configuration !== configuration || !p.cursor || (p.cursor.tick === -1 ? p.cursor.worldId !== null || p.cursor.generation !== null || p.cursor.sequence !== -1 : typeof p.cursor.worldId !== 'string' || !p.cursor.worldId || p.cursor.worldId.length > 512 || !integer(p.cursor.generation)) || !integer(p.cursor.tick + 1) || !integer(p.cursor.sequence + 1) || !Array.isArray(p.held) || p.held.length > MAX_HELD || !integer(p.declined) || !integer(p.capped)) throw new Error('Incompatible prepared surface mapping checkpoint.');
    const next = new Map();
    for (const record of p.held) {
      const surface = definitions.find(surface => surface.id === record.surface?.id), preparation = surface?.preparations.find(preparation => preparation.id === record.preparation?.id);
      if (!surface || !preparation || record.surfaceKey !== surfaceKeys.get(surface.id) || canonicalDataText(record.preparation).text !== canonicalDataText(preparation).text || record.key !== keyFor(surface, preparation, { spanId: record.contactSpanId }) || next.has(record.key) ||
          !integer(record.actorId) || record.worldId !== p.cursor.worldId || record.generation !== p.cursor.generation || record.observedTick !== p.cursor.tick || !integer(record.sourceSequence) || record.sourceSequence > p.cursor.sequence ||
          !Array.isArray(record.sourceEventIds) || !record.sourceEventIds.length || record.sourceEventIds.length > 128 || record.sourceEventIds.some(id => typeof id !== 'string' || !id || id.length > 512)) throw new Error('Invalid held prepared-contact continuation.');
      projectPreparedSurfacePoint(surface.surfaceMap, record.position); next.set(record.key, { ...record, surface, preparation });
    }
    held.clear(); for (const [key, record] of next) held.set(key, record); last = { ...p.cursor }; declined = p.declined; capped = p.capped;
  };
  return Object.freeze({ configure, validateConfiguration: values => prepareConfiguration(values).next, consume, snapshot, restore, reset(frontier = null) { held.clear(); last = frontier ? { ...frontier } : { worldId: null, generation: null, tick: -1, sequence: -1 }; },
    diagnostics: () => Object.freeze({ surfaces: definitions.length, heldPreparations: held.size, declined, capped, maximumHeld: MAX_HELD, maximumCommandsPerBatch: MAX_COMMANDS, semanticOnsets: 0 }) });
}
