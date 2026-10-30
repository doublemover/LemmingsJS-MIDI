import { plain, identity, integer, boundedList, freeze, copy } from './PhysicalSchema.js';

export const RHYTHMIC_SOURCE_KINDS = Object.freeze(['CrowdArrival', 'WorkResponse', 'RicochetResponse', 'FlightArc']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const readNumber = (value, fallback, low, high, label) => { const number = value ?? fallback; if (!Number.isFinite(number) || number < low || number > high) throw new Error(`Invalid ${label}.`); return number; };
export function validateRhythmicResponse(value, sourceKind) {
  if (!plain(value)) throw new Error('A physical response requires typed mapping data.');
  if (value.type === 'crowdInterval' && sourceKind === 'CrowdArrival') {
    if (value.mode != null && value.mode !== 'literal-arrival' || !identity(value.pickupId) || !['arrival-time', 'euclidean', 'route-distance'].includes(value.metric ?? 'arrival-time') ||
        value.metric === 'route-distance' && !identity(value.routeId) || !['lane', 'birth-cohort', 'ensemble'].includes(value.groupBy ?? 'lane') || value.groupBy === 'ensemble' && !identity(value.ensembleId)) throw new Error('Invalid crowd pickup, metric or grouping.');
    return freeze({ type: value.type, pickupId: value.pickupId, metric: value.metric ?? 'arrival-time', routeId: value.routeId ?? null, groupBy: value.groupBy ?? 'lane', ensembleId: value.ensembleId ?? null,
      window: Math.round(readNumber(value.window, 16, 1, 64, 'interval window')), mode: 'literal-arrival',
      intervalToPitchCents: readNumber(value.intervalToPitchCents, 0, -1200, 1200, 'interval pitch slope'),
      intervalToGate: readNumber(value.intervalToGate, 0.5, 0, 4, 'interval gate ratio'), maximumGateTicks: readNumber(value.maximumGateTicks, 32, 0, 4096, 'maximum gate'),
      gapToAccent: readNumber(value.gapToAccent, 0, -1, 1, 'gap accent slope'), minimumIntervalTicks: readNumber(value.minimumIntervalTicks, 0, 0, 4096, 'density thinning interval') });
  }
  if (value.type === 'workCycle' && sourceKind === 'WorkResponse') {
    const actionKinds = boundedList(value.actionKinds ?? ['build', 'bash', 'dig', 'mine'], 4, kind => { if (!['build', 'bash', 'dig', 'mine'].includes(kind)) throw new Error('Invalid work action.'); return kind; }, 'work actions');
    const phaseTriggers = value.phaseTriggers == null ? null : boundedList(value.phaseTriggers, 32, phase => { if (!integer(phase, 31)) throw new Error('Invalid action phase.'); return phase; }, 'work phases');
    if (!['operation', 'action-phase', 'successful-mutation', 'scrape', 'cycle-completion'].includes(value.mode ?? 'operation')) throw new Error('Invalid work-cycle mode.');
    if (!['solid', 'appearance', 'either'].includes(value.workChangePolicy ?? 'either')) throw new Error('Invalid work-cycle change policy.');
    const cycleAccent = boundedList(value.cycleAccent ?? [1], 32, amount => readNumber(amount, 1, 0, 1, 'work-cycle accent'), 'cycle accents');
    if (!cycleAccent.length) throw new Error('Work-cycle accent cannot be empty.');
    const materialResponse = {};
    if (value.materialResponse != null && (!plain(value.materialResponse) || Object.keys(value.materialResponse).length > 32)) throw new Error('Invalid material articulation map.');
    for (const [key, articulation] of Object.entries(value.materialResponse || {})) { if (!identity(key) || !identity(articulation)) throw new Error('Invalid material articulation.'); materialResponse[key] = articulation; }
    return freeze({ type: value.type, actionKinds, phaseTriggers, mode: value.mode ?? 'operation', workChangePolicy: value.workChangePolicy ?? 'either', cycleAccent, materialResponse,
      includeZeroWork: value.includeZeroWork === true, includeObstruction: value.includeObstruction === true,
      fullIntensityCells: readNumber(value.fullIntensityCells, 32, 1, 65536, 'work normalization'),
      expressionDeadband: readNumber(value.expressionDeadband, 0.01, 0, 1, 'work expression deadband') });
  }
  if (value.type === 'ricochet' && sourceKind === 'RicochetResponse') {
    if (!['alternating', 'modulo', 'mirror', 'call-answer'].includes(value.mode ?? 'alternating') || !['walker', 'blocker', 'both'].includes(value.roles ?? 'both')) throw new Error('Invalid ricochet state machine or role.');
    const intervals = boundedList(value.intervals ?? [0, 700], 32, cents => readNumber(cents, 0, -12000, 12000, 'ricochet interval'), 'ricochet intervals');
    if (!intervals.length) throw new Error('Ricochet motif must contain an interval.');
    return freeze({ type: value.type, mode: value.mode ?? 'alternating', roles: value.roles ?? 'both', intervals,
      walkerMuted: value.walkerMuted === true, blockerMuted: value.blockerMuted === true,
      blockerGain: readNumber(value.blockerGain, 0.6, 0, 1, 'blocker response gain') });
  }
  if (value.type === 'flightArc' && sourceKind === 'FlightArc') {
    if (!['all', 'spawn-only', 'exclude-spawn'].includes(value.spawnPolicy ?? 'all') || !['vertical-contour', 'time-of-flight', 'landing-height'].includes(value.mode ?? 'vertical-contour')) throw new Error('Invalid flight source or contour mode.');
    const terminalGestures = {};
    if (value.landingGesture != null && !identity(value.landingGesture) || value.terminalGestures != null && (!plain(value.terminalGestures) || Object.keys(value.terminalGestures).length > 32)) throw new Error('Invalid flight articulation map.');
    for (const [reason, gesture] of Object.entries(value.terminalGestures || {})) { if (!identity(reason) || !identity(gesture)) throw new Error('Invalid flight terminal articulation.'); terminalGestures[reason] = gesture; }
    return freeze({ type: value.type, spawnPolicy: value.spawnPolicy ?? 'all', mode: value.mode ?? 'vertical-contour', sustain: value.sustain !== false,
      landingStrike: value.landingStrike !== false, terminalStrike: value.terminalStrike === true, landingGesture: value.landingGesture ?? null, terminalGestures,
      centsPerPixel: readNumber(value.centsPerPixel, -12, -1200, 1200, 'flight pitch slope'), centsPerTick: readNumber(value.centsPerTick, -6, -1200, 1200, 'flight time slope'),
      maximumBendCents: readNumber(value.maximumBendCents, 2400, 0, 12000, 'flight bend bound'), fullAccentPixels: readNumber(value.fullAccentPixels, 64, 1, 4096, 'landing accent distance'),
      updateEveryTicks: Math.round(readNumber(value.updateEveryTicks, 1, 1, 256, 'flight expression cadence')), deadbandCents: readNumber(value.deadbandCents, 1, 0, 1200, 'flight pitch deadband') });
  }
  throw new Error('Physical response type does not match its source kind.');
}
const derived = (fact, instrument, extra = {}) => ({ ...fact, kind: instrument.sourceKind, targetMappingId: instrument.id, derivedResponse: true,
  physicalCauseFact: fact, sourceEventIds: fact.sourceEventIds || (fact.eventId ? [fact.eventId] : []), observationId: `${fact.observationId || fact.eventId}:${instrument.id}`, ...extra });
export function createRhythmicResponses({ maxStates = 16384, maxFacts = 8192 } = {}) {
  const states = new Map(); let boundary = null, signatures = new Map(), configured = [], diagnostics = [], failure = null;
  const configure = instruments => {
    configured = instruments.filter(instrument => instrument.response);
    const next = new Map(configured.map(instrument => [instrument.id, JSON.stringify(instrument)]));
    for (const [key, state] of states) if (signatures.get(state.instrumentId) !== next.get(state.instrumentId)) states.delete(key);
    signatures = next;
  };
  const stateFor = (key, instrument, initial) => { let value = states.get(key); if (!value) { if (states.size >= maxStates) { failure = 'physical-response-state-capacity'; return null; } value = { instrumentId: instrument.id, ...initial }; states.set(key, value); } return value; };
  const expand = (batch, facts, environment) => {
    if (boundary !== `${batch.worldId}:${batch.generation}`) { states.clear(); boundary = `${batch.worldId}:${batch.generation}`; }
    failure = null; diagnostics = []; const output = [], actors = new Map((batch.snapshot?.actors || []).map(actor => [actor.actorId, actor]));
    const emit = fact => { if (output.length >= maxFacts) { failure = 'physical-response-output-capacity'; return; } output.push(freeze(fact)); };
    const groupedWork = new Map(), byKind = new Map();
    for (const instrument of configured) { const kind = instrument.response.type; if (!byKind.has(kind)) byKind.set(kind, []); byKind.get(kind).push(instrument); }
    const ordered = [...facts.filter(fact => fact.kind === 'PickupCrossing').sort((a, b) => (a.fraction || 0) - (b.fraction || 0) || a.gateId.localeCompare(b.gateId) || a.actorId - b.actorId), ...facts.filter(fact => fact.kind !== 'PickupCrossing')];
    for (const fact of ordered) {
      if (fact.kind === 'PickupCrossing' && fact.transition !== 'exit') for (const instrument of byKind.get('crowdInterval') || []) {
        const response = instrument.response; if (response.pickupId !== fact.gateId) continue;
        const actor = actors.get(fact.actorId), membership = environment.membership(response.ensembleId || instrument.ensembleId, fact.actorId);
        if (!actor || membership.status !== 'complete' || !membership.includes || response.groupBy === 'birth-cohort' && !actor.birthCohortId) { diagnostics.push({ instrumentId: instrument.id, status: 'unknown', reason: 'crowd-membership-unavailable' }); continue; }
        const group = response.groupBy === 'birth-cohort' ? actor.birthCohortId : response.groupBy === 'ensemble' ? response.ensembleId : fact.laneId;
        const state = stateFor(`${instrument.id}:arrival:${group}:${fact.direction}`, instrument, { kind: 'crowd', group, groupBy: response.groupBy, direction: fact.direction, lastArrival: null, lastActorId: null, lastGap: null, intervals: [], lastAccepted: null }); if (!state) continue;
        const time = batch.tick - 1 + (fact.fraction ?? 1), interval = state.lastArrival == null ? null : time - state.lastArrival;
        let gap = null, metricStatus = 'complete';
        if (response.metric === 'route-distance') { const current = environment.routeCoordinate(fact.actorId, response.routeId), previous = state.lastActorId == null ? null : environment.routeCoordinate(state.lastActorId, response.routeId);
          if (current?.status !== 'qualified' || state.lastActorId != null && (previous?.status !== 'qualified' || previous.branchId !== current.branchId || previous.direction !== current.direction)) metricStatus = 'unknown';
          else if (previous) gap = Math.abs(current.sPixels - previous.sPixels); }
        else if (response.metric === 'euclidean' && state.lastActorId != null) { const previous = actors.get(state.lastActorId); if (previous) gap = Math.hypot(actor.x - previous.x, actor.y - previous.y); else metricStatus = 'unknown'; }
        const derivative = gap == null || state.lastGap == null || !(interval > 0) ? null : (gap - state.lastGap) / interval;
        state.lastArrival = time; state.lastActorId = fact.actorId; state.lastGap = gap;
        if (interval != null) { state.intervals.push(interval); if (state.intervals.length > response.window) state.intervals.shift(); }
        const descriptor = { type: 'crowd-interval', group, metric: response.metric, metricStatus, intervalTicks: interval, gapPixels: gap, gapDerivativePixelsPerTick: derivative, literalArrivalTick: time,
          intervalMeanTicks: state.intervals.length ? state.intervals.reduce((a, b) => a + b, 0) / state.intervals.length : null };
        diagnostics.push({ instrumentId: instrument.id, ...descriptor });
        if (metricStatus !== 'complete') continue;
        if (state.lastAccepted != null && time - state.lastAccepted < response.minimumIntervalTicks) { diagnostics.push({ instrumentId: instrument.id, status: 'thinned', reason: 'authored-density-clamp', sourceEventIds: fact.sourceEventIds }); continue; }
        state.lastAccepted = time;
        emit(derived(fact, instrument, { occupancy: false, pitchCents: clamp(instrument.pitchCents + (interval || 0) * response.intervalToPitchCents, -24000, 24000),
          velocity01: clamp(instrument.velocity01 + (gap || 0) * response.gapToAccent, 0, 1), responseDescriptor: descriptor,
          gateTicks: interval == null ? null : Math.min(response.maximumGateTicks, interval * response.intervalToGate) }));
      }
      if (fact.kind === 'ContactResolved' && fact.causeKind === 'blocker') for (const instrument of byKind.get('ricochet') || []) {
        const response = instrument.response; if (!integer(fact.otherActorId) || !identity(fact.contactId)) continue;
        const state = stateFor(`${instrument.id}:blocker:${fact.otherActorId}`, instrument, { kind: 'ricochet', actorId: fact.otherActorId, count: 0, lastContactId: null }); if (!state || state.lastContactId === fact.contactId) continue;
        state.lastContactId = fact.contactId; const ordinal = state.count++, sign = fact.incomingDirection === 'left' ? -1 : 1;
        const interval = response.mode === 'mirror' ? sign * response.intervals[ordinal % response.intervals.length] : response.intervals[(response.mode === 'alternating' || response.mode === 'call-answer' ? ordinal % 2 : ordinal) % response.intervals.length];
        for (const role of ['walker', 'blocker']) {
          if (response.roles !== 'both' && response.roles !== role || response[role + 'Muted']) continue;
          emit(derived(fact, instrument, { actorId: role === 'walker' ? fact.actorId : fact.otherActorId, laneId: role === 'walker' ? fact.laneId : fact.otherLaneId ?? fact.laneId,
            observationId: `${fact.eventId}:${instrument.id}:${role}`, pitchCents: clamp(instrument.pitchCents + (role === 'blocker' ? -interval : interval), -24000, 24000),
            velocity01: instrument.velocity01 * (role === 'blocker' ? response.blockerGain : 1), responseDescriptor: { type: 'ricochet', contactId: fact.contactId, walkerId: fact.actorId,
              blockerId: fact.otherActorId, role, ordinal, intervalCents: interval, motifTag: `${instrument.id}:${ordinal % response.intervals.length}`, movementChanged: false } }));
        }
      }
      if (fact.kind === 'TerrainWorkCommitted') for (const instrument of byKind.get('workCycle') || []) {
        const response = instrument.response;
        if (response.mode === 'cycle-completion') continue;
        if (!response.actionKinds.includes(fact.operationKind) || response.phaseTriggers && !response.phaseTriggers.includes(fact.phase)) continue;
        const solid = fact.physicalPayload?.changedSolidCells || 0, appearance = fact.physicalPayload?.changedAppearanceCells || 0;
        const cells = response.workChangePolicy === 'solid' ? solid : response.workChangePolicy === 'appearance' ? appearance : Math.max(solid, appearance), obstruction = ['steel', 'obstructed', 'steel-rejected', 'protected'].includes(fact.outcome);
        if (response.mode === 'successful-mutation' && !cells || !cells && !(obstruction ? response.includeObstruction : response.includeZeroWork)) continue;
        const group = response.mode === 'action-phase' ? `${instrument.id}:${fact.actorId}:${fact.actionInstanceId}:${fact.cycleOrdinal}:${fact.phase}` : `${instrument.id}:${fact.eventId}`;
        if (groupedWork.has(group)) { const entry = groupedWork.get(group); entry.sourceEventIds.push(fact.eventId); entry.cells += cells; entry.operations++; continue; }
        groupedWork.set(group, { fact, instrument, cells, operations: 1, sourceEventIds: [fact.eventId] });
      }
      if (fact.kind === 'ActionCycleCompleted') for (const instrument of byKind.get('workCycle') || []) {
        const response = instrument.response, kind = { building: 'build', bashing: 'bash', digging: 'dig', mining: 'mine' }[fact.action];
        if (response.mode !== 'cycle-completion' || !response.actionKinds.includes(kind)) continue;
        emit(derived(fact, instrument, { responseDescriptor: { type: 'work-cycle-completion', cycleOrdinal: fact.cycleOrdinal, cycleLengthFrames: fact.cycleLengthFrames }, velocity01: instrument.velocity01 * response.cycleAccent[(fact.cycleOrdinal - 1) % response.cycleAccent.length] }));
      }
      if (['FlightArcStarted', 'FlightArcUpdated', 'FlightArcEnded'].includes(fact.kind)) for (const instrument of byKind.get('flightArc') || []) {
        const response = instrument.response;
        if (response.spawnPolicy === 'spawn-only' && fact.source !== 'spawn-fall' || response.spawnPolicy === 'exclude-spawn' && fact.source === 'spawn-fall') continue;
        const key = `${instrument.id}:flight:${fact.actorId}:${fact.arcId}`;
        let state = states.get(key);
        if (fact.kind === 'FlightArcStarted') state = stateFor(key, instrument, { kind: 'flight', actorId: fact.actorId, arcId: fact.arcId, lastUpdateTick: batch.tick, lastPitch: 0, sounding: response.sustain });
        if (!state) continue;
        const elapsedTicks = fact.startTick == null ? null : batch.tick - fact.startTick, displacement = fact.verticalDisplacementPixels || 0;
        const pitch = clamp(response.mode === 'time-of-flight' ? (elapsedTicks || 0) * response.centsPerTick : displacement * response.centsPerPixel, -response.maximumBendCents, response.maximumBendCents);
        const descriptor = { type: 'flight-arc', arcId: fact.arcId, source: fact.source, elapsedTicks, verticalDisplacementPixels: displacement, travelPixels: fact.travelPixels,
          peakY: fact.peakY, parachutePhase: fact.parachutePhase, contactAtEnd: fact.contactAtEnd ?? null, terminationReason: fact.terminationReason ?? null, intensityMeaning: 'game-derived-distance-proxy' };
        const base = { responseScope: `flight:${fact.arcId}`, lifetimeScope: 'actorJourney', responseDescriptor: descriptor };
        if (fact.kind === 'FlightArcStarted' && response.sustain) emit(derived(fact, instrument, { ...base, lifecycle: 'begin' }));
        if (fact.kind === 'FlightArcUpdated' && state.sounding && batch.tick - state.lastUpdateTick >= response.updateEveryTicks && Math.abs(pitch - state.lastPitch) >= response.deadbandCents) {
          emit(derived(fact, instrument, { ...base, lifecycle: 'update', expression: { pitchOffsetCents: pitch, pressure01: clamp(Math.abs(displacement) / response.fullAccentPixels, 0, 1) } })); state.lastUpdateTick = batch.tick; state.lastPitch = pitch;
        }
        if (fact.kind === 'FlightArcEnded') {
          if (state.sounding) emit(derived(fact, instrument, { ...base, lifecycle: 'end', reason: fact.terminationReason }));
          const gesture = fact.terminationReason === 'safe-landing' ? response.landingGesture : response.terminalGestures[fact.terminationReason];
          if (fact.terminationReason === 'safe-landing' ? response.landingStrike : response.terminalStrike) emit(derived(fact, instrument, { responseDescriptor: descriptor, ...(gesture ? { sampleGesture: gesture } : {}), observationId: `${fact.eventId}:${instrument.id}:landing`,
            pitchCents: clamp(instrument.pitchCents + (response.mode === 'landing-height' ? pitch : 0), -24000, 24000), velocity01: instrument.velocity01 * clamp(Math.abs(displacement) / response.fullAccentPixels, 0, 1) }));
          states.delete(key);
        }
      }
    }
    for (const entry of groupedWork.values()) {
      const { fact, instrument, cells, sourceEventIds, operations } = entry, response = instrument.response;
      const intensity = clamp(cells / response.fullIntensityCells, 0, 1), accent = response.cycleAccent[(fact.cycleOrdinal || 0) % response.cycleAccent.length];
      const key = `${instrument.id}:work:${fact.actorId}:${fact.actionInstanceId}`, state = stateFor(key, instrument, { kind: 'work', actorId: fact.actorId, actionInstanceId: fact.actionInstanceId, lastCycle: fact.cycleOrdinal, sounding: false, lastIntensity: null }); if (!state) continue;
      const lifecycle = response.mode === 'scrape' ? state.sounding ? 'update' : 'begin' : null;
      if (lifecycle === 'update' && Math.abs(intensity - state.lastIntensity) < response.expressionDeadband) continue;
      state.sounding ||= lifecycle === 'begin'; state.lastIntensity = intensity;
      const material = fact.warning || fact.materialTag || (fact.outcome === 'protected' ? fact.operationPhase : fact.outcome) || 'unclassified', sampleGesture = response.materialResponse[material] || response.materialResponse.unclassified;
      emit(derived(fact, instrument, { sourceEventIds, ...(sampleGesture ? { sampleGesture } : {}), velocity01: instrument.velocity01 * accent * (cells ? intensity : 0.25),
        ...(lifecycle ? { lifecycle, responseScope: `work:${fact.actionInstanceId}`, lifetimeScope: 'actionInstance', expression: lifecycle === 'update' ? { pressure01: intensity } : {} } : {}),
        responseDescriptor: { type: 'work-cycle', actionInstanceId: fact.actionInstanceId, phase: fact.phase, cycleOrdinal: fact.cycleOrdinal, operations, changedCells: cells,
          intensity01: intensity, intensityMeaning: 'normalized-changed-cell-count-not-energy', workChangePolicy: response.workChangePolicy, mode: response.mode, outcome: fact.outcome, warning: fact.warning ?? null } }));
    }
    for (const fact of facts) if (fact.kind === 'ActorTerminated' || fact.kind === 'ActionExited') for (const [key, state] of states) {
      if (state.actorId !== fact.actorId || fact.kind === 'ActionExited' && state.actionInstanceId !== fact.actionInstanceId) continue;
      if (state.sounding) { const instrument = configured.find(value => value.id === state.instrumentId); if (instrument) emit(derived(fact, instrument, { lifecycle: 'end', responseScope: state.kind === 'flight' ? `flight:${state.arcId}` : `work:${state.actionInstanceId}`, reason: fact.terminationReason || 'action-exited' })); }
      states.delete(key);
    }
    if (batch.snapshot) { const liveCohorts = new Set([...actors.values()].map(actor => actor.birthCohortId)); for (const [key, state] of states) if (state.kind === 'crowd' && state.groupBy === 'birth-cohort' && !liveCohorts.has(state.group)) states.delete(key); }
    if (batch.snapshot) for (const [key, state] of states) if (state.actorId != null && !actors.has(state.actorId) && !state.sounding) states.delete(key);
    return freeze({ facts: output, completeness: failure ? { status: 'incomplete', reason: failure } : { status: 'complete' } });
  };
  return { configure, expand, reset() { states.clear(); boundary = null; }, snapshot: () => freeze({ version: 1, boundary, signatures: [...signatures], states: [...states].map(([key, state]) => [key, copy(state)]) }),
    restore(value) { if (value?.version !== 1 || value.boundary != null && typeof value.boundary !== 'string' || JSON.stringify(value.signatures) !== JSON.stringify([...signatures]) || !Array.isArray(value.states) || value.states.length > maxStates) throw new Error('Invalid response checkpoint.'); const next = new Map(); for (const [key, state] of value.states) { if (typeof key !== 'string' || key.length > 1024 || next.has(key) || !signatures.has(state.instrumentId) || !['crowd', 'ricochet', 'work', 'flight'].includes(state.kind) || state.actorId != null && !integer(state.actorId) || JSON.stringify(state).length > 16384) throw new Error('Invalid response ownership.'); if (state.kind === 'crowd' && (!Array.isArray(state.intervals) || state.intervals.length > 64 || state.intervals.some(number => !Number.isFinite(number) || number < 0) || [state.lastArrival, state.lastAccepted, state.lastGap].some(number => number != null && (!Number.isFinite(number) || number < 0))) || state.kind === 'ricochet' && (!integer(state.count) || state.lastContactId != null && !identity(state.lastContactId)) || state.kind === 'work' && (typeof state.actionInstanceId !== 'string' || typeof state.sounding !== 'boolean' || state.lastIntensity != null && (!Number.isFinite(state.lastIntensity) || state.lastIntensity < 0 || state.lastIntensity > 1)) || state.kind === 'flight' && (!identity(state.arcId) || !integer(state.lastUpdateTick) || !Number.isFinite(state.lastPitch) || typeof state.sounding !== 'boolean')) throw new Error('Invalid response estimator state.'); next.set(key, copy(state)); } states.clear(); for (const [key, state] of next) states.set(key, state); boundary = value.boundary; },
    diagnostics: () => freeze({ stateCount: states.size, failure, descriptors: diagnostics.slice(-1024) }) };
}
