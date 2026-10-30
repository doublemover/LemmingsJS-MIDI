import { plain, integer, freeze, copy } from './PhysicalSchema.js';

const MODES = ['individual', 'centroidChord', 'densityCloud', 'representativeStrikes'];
const KEYS = ['neighborhood', 'action', 'cohort', 'lane', 'mapping', 'role'];
const LIMITS = Object.freeze({ sources: 4096, groups: 512, buckets: 4096, window: 600, bytes: 8 * 1024 * 1024, intentBytes: 32768, ownerBytes: 524288, setSample: 8 });
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = values => { let h = 2166136261; for (const value of values) for (const c of `${value}\0`) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); };
const named = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const finite = value => Number.isFinite(value) && Math.abs(value) <= 24000;
export const validateSwarmReducer = value => {
  if (value == null) return null;
  if (!plain(value) || value.version !== 1 || !MODES.includes(value.representation) || !integer(value.windowInSimTime ?? 54, LIMITS.window) || (value.windowInSimTime ?? 54) < 1 || !Array.isArray(value.groupBy) || !value.groupBy.length || value.groupBy.length > KEYS.length || new Set(value.groupBy).size !== value.groupBy.length || value.groupBy.some(key => !KEYS.includes(key)) || !integer(value.maxVoices ?? 64, 512) || (value.maxVoices ?? 64) < 1 || (value.deterministicTieBreak ?? 'stable-identity') !== 'stable-identity') throw new Error('Invalid semantic swarm policy.');
  if (!Number.isFinite(value.neighborhoodSize ?? 64) || (value.neighborhoodSize ?? 64) < 1 || (value.neighborhoodSize ?? 64) > 4096 || !integer(value.chordVoices ?? 3, 8) || (value.chordVoices ?? 3) < 1 || !Array.isArray(value.priorityRules ?? []) || (value.priorityRules?.length || 0) > 32) throw new Error('Invalid swarm geometry or salience capacity.');
  const rules = (value.priorityRules || []).map(rule => {
    if (!plain(rule) || !plain(rule.match) || !Object.keys(rule.match).length || Object.entries(rule.match).some(([key, val]) => !['sourceKind', 'role', 'mappingId', 'action', 'laneId'].includes(key) || !(typeof val === 'string' && val.length <= 128 || key === 'laneId' && integer(val, 1023))) || !integer(rule.priority, 1000)) throw new Error('Invalid authored swarm salience.');
    return { match: { ...rule.match }, priority: rule.priority };
  });
  return freeze({ version: 1, representation: value.representation, groupBy: [...value.groupBy], windowInSimTime: value.windowInSimTime ?? 54, maxVoices: value.maxVoices ?? 64, neighborhoodSize: value.neighborhoodSize ?? 64, chordVoices: value.chordVoices ?? 3, priorityRules: rules, deterministicTieBreak: 'stable-identity' });
};
const validIntent = value => plain(value) && value.version === 1 && ['begin', 'update', 'end'].includes(value.kind) && named(value.voiceId) && named(value.intentId) && named(value.route) && Array.isArray(value.sourceEventIds) && value.sourceEventIds.length <= 256 && value.sourceEventIds.every(named) && finite(value.pitch?.cents) && (value.expression?.pitchOffsetCents == null || finite(value.expression.pitchOffsetCents) && finite(value.pitch.cents + value.expression.pitchOffsetCents)) && Number.isFinite(value.velocity01) && value.velocity01 >= 0 && value.velocity01 <= 1 && plain(value.scoreTime) && integer(value.scoreTime.simTick);
const setReference = (kind, values) => { const all = [...new Set(values.filter(value => value != null))].sort((a, b) => compare(String(a), String(b))); return { kind, count: all.length, fingerprint: `fnv1a32:${hash(all)}`, sample: all.slice(0, LIMITS.setSample), coverage: all.length <= LIMITS.setSample ? 'complete' : 'sampled-raw-journal-required' }; };
const stamp = (batch, source) => ({ ...source, simTick: batch.tick, subTick: 0, sourceTimeMs: batch.sourceTimeMs ?? null, precision: 'tick' });

export const createSwarmReducer = () => {
  let config = null, applied = 'null', serial = 0, cursor = { worldId: null, generation: null, tick: -1, batchId: null }, summary = null;
  let held = new Map(), audible = new Map(), groups = new Map(), heldBytes = 0;
  const configure = value => { config = validateSwarmReducer(value); };
  const sourcePriority = record => (config?.priorityRules || []).reduce((priority, rule) => Object.entries(rule.match).every(([key, value]) => (key === 'sourceKind' ? record.intent.physicalSourceKind : key === 'action' ? record.action : record.intent[key]) === value) ? Math.max(priority, rule.priority) : priority, 0);
  const sourceOrder = (a, b) => sourcePriority(b) - sourcePriority(a) || compare(String(a.intent.actorId), String(b.intent.actorId)) || compare(a.intent.voiceId, b.intent.voiceId);
  const groupKey = record => JSON.stringify([record.intent.route, ...(config?.groupBy || ['mapping']).map(key => key === 'neighborhood' ? [Math.floor(record.x / config.neighborhoodSize), Math.floor(record.y / config.neighborhoodSize)] : key === 'action' ? record.action : key === 'cohort' ? record.cohort : key === 'lane' ? record.intent.laneId : key === 'mapping' ? record.intent.mappingId : record.intent.role)]);
  const snapshot = () => freeze(copy({ version: 1, config, applied, serial, cursor, held: [...held], audible: [...audible], groups: [...groups] }));
  const reduce = (batch, intents) => {
    if (!Array.isArray(intents) || intents.length > 16384 || !named(batch?.batchId) || !integer(batch.tick) || !integer(batch.generation) || !named(batch.worldId) || (batch.snapshot?.actors?.length || 0) > 16384) throw new Error('Invalid swarm source boundary.');
    if (cursor.batchId === batch.batchId && cursor.worldId === batch.worldId) return freeze({ intents: [], summary });
    if (cursor.worldId === batch.worldId && cursor.generation === batch.generation && batch.tick <= cursor.tick) throw new Error('Stale swarm boundary.');
    for (const intent of intents) if (!validIntent(intent)) throw new Error('Malformed semantic swarm intent.');
    const output = [], ended = new Map(), updates = new Map(), fresh = new Set(), temporary = [], reasons = new Set();
    let requested = 0, lifecycleEnds = 0, unretained = 0, temporaryBytes = 0;
    const changed = applied !== JSON.stringify(config), epochChanged = cursor.worldId != null && (cursor.worldId !== batch.worldId || cursor.generation !== batch.generation);
    const end = (record, reason, raw = null) => output.push(freeze({ ...record.intent, ...(raw || {}), voiceId: record.intent.voiceId, onsetId: record.intent.voiceId, intentId: `${batch.batchId}:swarm:${record.intent.voiceId}:end`, batchId: batch.batchId, kind: 'end', scoreTime: raw?.scoreTime || stamp(batch, record.intent.scoreTime), terminationReason: reason, swarm: record.intent.swarm }));
    if (epochChanged) { for (const record of audible.values()) end(record, 'generation-change'); held.clear(); audible.clear(); groups.clear(); heldBytes = 0; }
    for (const intent of intents) {
      if (intent.kind === 'end') { ended.set(intent.voiceId, intent); lifecycleEnds++; }
      if (intent.kind === 'update') updates.set(intent.voiceId, intent);
    }
    for (const id of ended.keys()) { const old = held.get(id); if (old) heldBytes -= old.bytes; held.delete(id); }
    for (const [id, update] of updates) {
      const old = held.get(id); if (!old) continue;
      const next = { ...old, intent: { ...old.intent, expression: { ...old.intent.expression, ...update.expression }, laneId: update.laneId ?? old.intent.laneId }, update };
      next.bytes = bytes({ ...next, bytes: 0 });
      if (next.bytes > LIMITS.intentBytes || heldBytes - old.bytes + next.bytes > LIMITS.bytes / 2) { reasons.add('held-expression-capacity'); held.delete(id); heldBytes -= old.bytes; continue; }
      held.set(id, next); heldBytes += next.bytes - old.bytes;
    }
    const actors = new Map((batch.snapshot?.actors || []).map(actor => [actor.actorId ?? actor.id, actor]));
    const begins = intents.filter(intent => intent.kind === 'begin').sort((a, b) => compare(a.voiceId, b.voiceId));
    for (const intent of begins) {
      requested++; if (fresh.has(intent.voiceId) || held.has(intent.voiceId)) { reasons.add('duplicate-source-voice'); continue; } fresh.add(intent.voiceId);
      if (requested > LIMITS.sources) { reasons.add('source-capacity'); unretained++; continue; }
      const actor = actors.get(intent.actorId), record = { intent, action: actor?.action ?? intent.physicalAction ?? null, cohort: actor?.birthCohortId ?? actor?.cohortId ?? null, x: Number.isFinite(actor?.x) ? actor.x : 0, y: Number.isFinite(actor?.y) ? actor.y : 0, bytes: 0 };
      record.bytes = bytes(record);
      if (record.bytes > LIMITS.intentBytes) { reasons.add('source-byte-capacity'); unretained++; continue; }
      if (ended.has(intent.voiceId)) { if (temporaryBytes + record.bytes > LIMITS.bytes / 2) { reasons.add('transient-byte-capacity'); unretained++; continue; } temporaryBytes += record.bytes; temporary.push(record); }
      else if (held.size >= LIMITS.sources || heldBytes + record.bytes > LIMITS.bytes / 2) { reasons.add('held-capacity'); if (temporaryBytes + record.bytes <= LIMITS.bytes / 2) { temporaryBytes += record.bytes; temporary.push({ ...record, forcedStrike: true }); } unretained++; }
      else { held.set(intent.voiceId, record); heldBytes += record.bytes; }
    }
    if (!config && (heldBytes > LIMITS.bytes / 4 || held.size > 512)) reasons.add('disabled-owner-capacity');
    if (!config && !changed && !reasons.size && [...audible.values()].every(record => record.intent.voiceId === record.members[0])) {
      for (const id of ended.keys()) audible.delete(`individual:${id}`);
      for (const record of held.values()) if (fresh.has(record.intent.voiceId)) audible.set(`individual:${record.intent.voiceId}`, { intent: record.intent, members: [record.intent.voiceId], key: 'disabled' });
      summary = freeze({ mode: 'disabled', requestedEventCount: requested, representedEventCount: requested, audibleVoices: audible.size, lifecycleEnds, rawSourceCoverage: batch.completeness?.status || 'unknown', rawFactsModified: false });
      applied = JSON.stringify(config); cursor = { worldId: batch.worldId, generation: batch.generation, tick: batch.tick, batchId: batch.batchId }; const released = new Set(output.filter(intent => intent.kind === 'end').map(intent => intent.voiceId)); return freeze({ intents: [...output, ...intents.filter(intent => intent.kind !== 'end' || !released.has(intent.voiceId))], summary });
    }
    for (const [key, state] of groups) { state.window = state.window.filter(bucket => batch.tick - bucket.tick < (config?.windowInSimTime || 1)); if (!state.window.length) groups.delete(key); }
    const candidates = new Map(), raw = [...held.values(), ...temporary].sort(sourceOrder);
    for (const record of raw) {
      const key = config ? groupKey(record) : 'disabled'; let group = candidates.get(key);
      if (!group) { group = { key, members: [], priority: 0, fresh: false }; candidates.set(key, group); }
      group.members.push(record); group.priority = Math.max(group.priority, sourcePriority(record)); group.fresh ||= fresh.has(record.intent.voiceId);
    }
    let bucketCount = [...groups.values()].reduce((sum, value) => sum + value.window.length, 0);
    if (candidates.size > LIMITS.groups) reasons.add('group-capacity');
    for (const group of candidates.values()) if (group.fresh && candidates.size <= LIMITS.groups) {
      const members = group.members.filter(record => fresh.has(record.intent.voiceId)); let state = groups.get(group.key);
      if (!state) { if (groups.size >= LIMITS.groups) { reasons.add('window-group-capacity'); break; } state = { lastServed: -1, window: [] }; groups.set(group.key, state); }
      if (bucketCount >= LIMITS.buckets) { reasons.add('window-bucket-capacity'); break; }
      const pitches = members.map(record => record.intent.pitch.cents); state.window.push({ tick: batch.tick, count: members.length, sum: pitches.reduce((a, b) => a + b, 0), min: Math.min(...pitches), max: Math.max(...pitches) }); bucketCount++;
    }
    const mode = reasons.size ? 'representativeStrikes' : config?.representation || 'individual', budget = config?.maxVoices || 512;
    if (mode === 'individual') for (const group of candidates.values()) group.members = group.members.filter(record => changed || fresh.has(record.intent.voiceId) || audible.has(`individual:${record.intent.voiceId}`));
    const fallbackRanks = new Map(), bands = new Map();
    for (const group of candidates.values()) { if (!bands.has(group.priority)) bands.set(group.priority, []); bands.get(group.priority).push(group.key); }
    let higher = 0; for (const priority of [...bands.keys()].sort((a, b) => b - a)) { const keys = bands.get(priority).sort(compare), stride = Math.max(1, budget - higher), offset = (batch.tick % keys.length) * stride % keys.length; for (let index = 0; index < keys.length; index++) fallbackRanks.set(keys[index], (index - offset + keys.length) % keys.length); higher += keys.length; }
    const oldKeys = new Set([...audible.values()].map(record => record.key));
    const eligible = [...candidates.values()].filter(group => group.members.length && (changed || group.fresh || oldKeys.has(group.key))).sort((a, b) => b.priority - a.priority || (reasons.size ? fallbackRanks.get(a.key) - fallbackRanks.get(b.key) : 0) || (groups.get(a.key)?.lastServed ?? -1) - (groups.get(b.key)?.lastServed ?? -1) || compare(a.key, b.key));
    const desired = [], selectedSources = new Set();
    const slotsFor = group => mode === 'individual' ? group.members.length : mode === 'centroidChord' ? Math.min(config.chordVoices, new Set(group.members.map(record => record.intent.pitch.cents)).size) : 1;
    for (let slot = 0; desired.length < budget && slot < LIMITS.sources; slot++) {
      let any = false;
      for (const group of eligible) {
        if (desired.length >= budget) break; if (slot >= slotsFor(group)) continue;
        const members = mode === 'individual' ? [group.members[slot]] : group.members, representative = members[0], rawId = representative.intent.voiceId;
        if (mode === 'individual' && !changed && !fresh.has(rawId) && !audible.has(`individual:${rawId}`)) continue;
        any = true;
        const live = members.filter(record => held.has(record.intent.voiceId)), key = mode === 'individual' ? `individual:${rawId}` : `${mode}:${group.key}:${slot}`;
        desired.push({ key, group, members, representative, slot, live });
      }
      if (!any) break;
    }
    const desiredKeys = new Set(desired.filter(item => item.live.length).map(item => item.key));
    for (const [key, record] of audible) if (changed || !desiredKeys.has(key)) { const rawEnd = record.members.length === 1 ? ended.get(record.members[0]) : null; end(record, changed ? 'swarm-representation-handover' : rawEnd?.terminationReason || 'swarm-source-ended-or-represented-out', rawEnd); audible.delete(key); }
    let audibleBytes = [...audible.values()].reduce((sum, value) => sum + bytes(value), 0);
    for (const item of desired) {
      const { key, group, members, representative, slot, live } = item, old = audible.get(key), state = groups.get(group.key), pitches = members.map(record => record.intent.pitch.cents + (record.intent.expression?.pitchOffsetCents || 0)), min = Math.min(...pitches), max = Math.max(...pitches), mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
      const cents = mode === 'individual' || mode === 'representativeStrikes' ? pitches[0] : mode === 'densityCloud' || slot === 0 ? mean : slot === 1 ? min : slot === 2 ? max : min + (max - min) * (slot - 2) / Math.max(1, config.chordVoices - 2);
      const rootSet = setReference('physical-event-set', members.flatMap(record => record.intent.sourceEventIds)), actorSet = setReference('actor-set', members.map(record => record.intent.actorId)), cohortSet = setReference('cohort-set', members.map(record => record.cohort)), window = state?.window || [], sourceTicks = members.map(record => record.intent.scoreTime.simTick);
      const metadata = { version: 1, requestedRepresentation: config?.representation || 'individual', representation: mode, exactIndividualReplay: mode === 'individual' && !changed && !reasons.size, groupKey: group.key, sourceCount: members.length, actorSet, cohortSet, sourceSet: rootSet, coveredTimeSpan: { firstTick: Math.min(...sourceTicks), lastTick: Math.max(...sourceTicks) }, preservedExtrema: { pitchMin: min, pitchMax: max, velocityMin: Math.min(...members.map(record => record.intent.velocity01)), velocityMax: Math.max(...members.map(record => record.intent.velocity01)) }, window: { firstTick: window[0]?.tick ?? batch.tick, lastTick: window.at(-1)?.tick ?? batch.tick, count: window.reduce((sum, value) => sum + value.count, 0) }, lostDetail: mode === 'individual' ? changed && !fresh.has(representative.intent.voiceId) ? ['recognition-time-held-voice-handover'] : [] : ['individual-onset-and-voice-identity', 'individual-timbre-and-expression', 'individual-pitch-distribution'], fallbackReasons: [...reasons].sort(), handover: changed && members.some(record => !fresh.has(record.intent.voiceId)), rawJournalRequired: true };
      if (state) state.lastServed = batch.tick;
      if (old) {
        for (const record of members) if (fresh.has(record.intent.voiceId)) selectedSources.add(record.intent.voiceId);
        old.members = live.map(record => record.intent.voiceId);
        const actual = members.some(record => fresh.has(record.intent.voiceId) || updates.has(record.intent.voiceId)) || old.members.length !== old.sourceCount;
        if (actual) {
          const update = mode === 'individual' ? updates.get(representative.intent.voiceId) : null;
          const intent = freeze({ ...old.intent, ...(update || {}), performanceCause: update?.performanceCause, sourceEventIds: mode === 'individual' ? update?.sourceEventIds || old.intent.sourceEventIds : rootSet.sample, intentId: `${batch.batchId}:swarm:${old.intent.voiceId}:update`, voiceId: old.intent.voiceId, onsetId: old.intent.voiceId, batchId: batch.batchId, kind: 'update', scoreTime: stamp(batch, old.intent.scoreTime), expression: { ...(update?.expression || {}), ...(mode !== 'individual' ? { pitchOffsetCents: cents - old.intent.pitch.cents, pressure01: Math.min(1, Math.log2(members.length + 1) / 8) } : {}) }, swarm: metadata }); output.push(intent); old.sourceCount = old.members.length;
        }
        continue;
      }
      if (!changed && !group.fresh) continue;
      if (!Number.isSafeInteger(serial + 1)) throw new Error('Swarm ownership identity exhausted.'); serial++;
      const voiceId = mode === 'individual' && !changed ? representative.intent.voiceId : `swarm:${batch.generation}:${serial}`, intent = freeze({ ...representative.intent, voiceId, onsetId: voiceId, intentId: `${batch.batchId}:${voiceId}:swarm-begin`, batchId: batch.batchId, kind: 'begin', scoreTime: metadata.handover || mode !== 'individual' ? stamp(batch, representative.intent.scoreTime) : representative.intent.scoreTime, sourceEventIds: mode === 'individual' ? representative.intent.sourceEventIds : rootSet.sample, pitch: { ...representative.intent.pitch, cents }, expression: mode === 'individual' ? { ...representative.intent.expression, pitchOffsetCents: 0 } : {}, velocity01: mode === 'densityCloud' ? Math.min(1, representative.intent.velocity01 * (1 + Math.log2(members.length) / 8)) : representative.intent.velocity01, swarm: metadata });
      const record = { intent, members: live.map(record => record.intent.voiceId), sourceCount: live.length, key: group.key };
      const size = bytes(record); if (size > LIMITS.ownerBytes || live.length && audibleBytes + size > LIMITS.bytes / 4) {
        reasons.add('audible-owner-byte-capacity');
        const fallback = freeze({ ...representative.intent, voiceId, onsetId: voiceId, intentId: `${batch.batchId}:${voiceId}:swarm-capacity-strike`, batchId: batch.batchId, kind: 'begin', scoreTime: metadata.handover ? stamp(batch, representative.intent.scoreTime) : representative.intent.scoreTime, swarm: { version: 1, representation: 'representativeStrikes', requestedRepresentation: config?.representation || 'individual', sourceCount: members.length, representedSourceCount: 1, sourceSet: rootSet, coveredTimeSpan: metadata.coveredTimeSpan, preservedExtrema: metadata.preservedExtrema, handover: metadata.handover, exactIndividualReplay: false, fallbackReasons: ['audible-owner-byte-capacity'], lostDetail: ['held-lifetime-reduced-to-bounded-strike', 'individual-voices'], rawJournalRequired: true } });
        output.push(fallback); end({ intent: fallback }, 'one-shot'); if (fresh.has(representative.intent.voiceId)) selectedSources.add(representative.intent.voiceId); continue;
      }
      for (const member of members) if (fresh.has(member.intent.voiceId)) selectedSources.add(member.intent.voiceId);
      output.push(intent); if (live.length) { audible.set(key, record); audibleBytes += size; } else end(record, 'one-shot');
    }
    summary = freeze({ mode, requestedRepresentation: config?.representation || 'disabled', requestedEventCount: requested, representedEventCount: selectedSources.size, intentionallyUnrepresentedEvents: Math.max(0, requested - selectedSources.size), emittedVoices: output.filter(intent => intent.kind === 'begin').length, audibleVoices: audible.size, lifecycleEnds, sourceCapacityLosses: unretained, groupCount: candidates.size, retainedGroups: groups.size, retainedBuckets: bucketCount, heldSources: held.size, ownedSourceBytes: heldBytes, fallbackReasons: [...reasons].sort(), fallbackRepresentations: reasons.size ? ['representativeStrikes'] : [], rawSourceCoverage: batch.completeness?.status || 'unknown', rawFactsModified: false, interpretation: mode === 'individual' ? 'selected-individuals' : 'semantic-aggregate-not-exact-replay' });
    applied = JSON.stringify(config); cursor = { worldId: batch.worldId, generation: batch.generation, tick: batch.tick, batchId: batch.batchId };
    return freeze({ intents: output, summary });
  };
  const restore = value => {
    if (!plain(value) || value.version !== 1 || JSON.stringify(validateSwarmReducer(value.config)) !== JSON.stringify(config) || typeof value.applied !== 'string' || value.applied.length > 32768 || !integer(value.serial) || !plain(value.cursor) || !Number.isSafeInteger(value.cursor.tick) || value.cursor.tick < -1 || value.cursor.worldId != null && !named(value.cursor.worldId) || value.cursor.generation != null && !integer(value.cursor.generation) || value.cursor.batchId != null && !named(value.cursor.batchId) || !Array.isArray(value.held) || value.held.length > LIMITS.sources || !Array.isArray(value.audible) || value.audible.length > 512 || !Array.isArray(value.groups) || value.groups.length > LIMITS.groups || bytes(value) > LIMITS.bytes) throw new Error('Invalid swarm continuation.');
    try { validateSwarmReducer(JSON.parse(value.applied)); } catch { throw new Error('Invalid pending swarm policy boundary.'); }
    const nextHeld = new Map(), nextAudible = new Map(), nextGroups = new Map(), audibleIds = new Set(); let owned = 0, buckets = 0;
    for (const [id, record] of value.held) {
      if (!named(id) || nextHeld.has(id) || !plain(record) || !validIntent(record.intent) || record.intent.kind !== 'begin' || record.intent.worldId !== value.cursor.worldId || record.intent.generation !== value.cursor.generation || record.intent.scoreTime.simTick > value.cursor.tick || record.intent.voiceId !== id || !Number.isFinite(record.x) || !Number.isFinite(record.y)) throw new Error('Invalid swarm held source.');
      const next = copy(record); next.bytes = bytes({ ...next, bytes: 0 }); if (next.bytes > LIMITS.intentBytes) throw new Error('Swarm source byte capacity.'); owned += next.bytes; nextHeld.set(id, next);
    }
    for (const [id, record] of value.audible) {
      if (typeof id !== 'string' || id.length > 2048 || nextAudible.has(id) || !plain(record) || !validIntent(record.intent) || record.intent.kind !== 'begin' || record.intent.worldId !== value.cursor.worldId || record.intent.generation !== value.cursor.generation || record.intent.scoreTime.simTick > value.cursor.tick || audibleIds.has(record.intent.voiceId) || bytes(record) > LIMITS.ownerBytes || !Array.isArray(record.members) || !record.members.length || record.members.length > LIMITS.sources || new Set(record.members).size !== record.members.length || record.members.some(id => !nextHeld.has(id)) || typeof record.key !== 'string' || record.key.length > 1024) throw new Error('Invalid swarm audible ownership.'); audibleIds.add(record.intent.voiceId); nextAudible.set(id, copy(record));
    }
    for (const [key, state] of value.groups) {
      if (typeof key !== 'string' || key.length > 1024 || nextGroups.has(key) || !plain(state) || !Number.isSafeInteger(state.lastServed) || state.lastServed > value.cursor.tick || state.lastServed < -1 || !Array.isArray(state.window) || state.window.length > LIMITS.window || state.window.some((bucket, i) => !plain(bucket) || !integer(bucket.tick) || bucket.tick > value.cursor.tick || value.cursor.tick - bucket.tick >= LIMITS.window || i > 0 && bucket.tick <= state.window[i - 1].tick || !integer(bucket.count, LIMITS.sources) || !Number.isFinite(bucket.sum) || !finite(bucket.min) || !finite(bucket.max) || bucket.min > bucket.max)) throw new Error('Invalid swarm rolling window.'); buckets += state.window.length; nextGroups.set(key, copy(state));
    }
    if ([...nextAudible.values()].reduce((sum, record) => sum + bytes(record), 0) > LIMITS.bytes / 4 || owned > LIMITS.bytes / 2 || buckets > LIMITS.buckets) throw new Error('Swarm continuation capacity exceeded.');
    held = nextHeld; audible = nextAudible; groups = nextGroups; heldBytes = owned; applied = value.applied; serial = value.serial; cursor = copy(value.cursor); summary = null;
  };
  return { configure, reduce, snapshot, restore, diagnostics: () => summary || freeze({ mode: config?.representation || 'disabled', heldSources: held.size, audibleVoices: audible.size, retainedGroups: groups.size, ownedSourceBytes: heldBytes }) };
};
export const SWARM_REDUCER_LIMITS = LIMITS;
