import { plain, integer, freeze, copy, boundedList } from './PhysicalSchema.js';

const names = new Set(['walking', 'falling', 'floating', 'climbing', 'hoisting', 'jumping', 'building', 'bashing', 'digging', 'mining', 'blocking', 'shrug', 'ohno', 'exploding', 'drowning', 'frying', 'splatting', 'exiting']);
const aliases = new Map([['walk', 'walking'], ['hoist', 'hoisting'], ['jump', 'jumping'], ['shrugging', 'shrug'], ['oh-no', 'ohno'], ['splatter', 'splatting']]);
export const actionVoiceName = action => aliases.get(action) || action;
const numeric = (value, fallback, minimum, maximum) => { const number = value ?? fallback; if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error('Invalid action voice quantity.'); return number; };
export function validateActionVoicePolicy(value) {
  if (!plain(value)) throw new Error('Invalid action voice policy.');
  const matchActions = boundedList(value.matchActions, 16, action => { const name = actionVoiceName(action); if (!names.has(name)) throw new Error('Unknown physical action voice source.'); return name; }, 'action voice matches');
  if (!matchActions.length || new Set(matchActions).size !== matchActions.length || !['enter', 'motion', 'contact'].includes(value.beginCondition ?? 'enter') ||
      !['release', 'legato', 'crossfade'].includes(value.transitionPolicy ?? 'release') || !['restart', 'legato'].includes(value.sameActionReentry ?? 'restart')) throw new Error('Invalid action voice transition contract.');
  const expressionMappings = boundedList(value.expressionMappings ?? [], 8, mapping => {
    if (!plain(mapping) || !['displacementPixels', 'actionPhase', 'heightPixels'].includes(mapping.source) || !['pitchOffsetCents', 'pressure01', 'pan01'].includes(mapping.target)) throw new Error('Invalid action expression mapping.');
    const range = mapping.target === 'pitchOffsetCents' ? [-12000, 12000] : mapping.target === 'pan01' ? [-1, 1] : [0, 1];
    return { source: mapping.source, target: mapping.target, scale: numeric(mapping.scale, 1, -12000, 12000), offset: numeric(mapping.offset, 0, range[0], range[1]), minimum: numeric(mapping.minimum, range[0], range[0], range[1]), maximum: numeric(mapping.maximum, range[1], range[0], range[1]) };
  }, 'action expression mappings');
  if (new Set(expressionMappings.map(mapping => mapping.target)).size !== expressionMappings.length || expressionMappings.some(mapping => mapping.minimum > mapping.maximum)) throw new Error('Action expression targets need one explicit bounded owner.');
  return freeze({ matchActions, beginCondition: value.beginCondition ?? 'enter', transitionPolicy: value.transitionPolicy ?? 'release', sameActionReentry: value.sameActionReentry ?? 'restart',
    maximumHoldTicks: Math.round(numeric(value.maximumHoldTicks, 36000, 1, 1000000)), crossfadeSeconds: numeric(value.crossfadeSeconds, 0.08, 0, 4),
    updateEveryTicks: Math.round(numeric(value.updateEveryTicks, 1, 1, 256)), expressionDeadband: numeric(value.expressionDeadband, 0.001, 0, 1200), expressionMappings });
}
export function validateVoiceTransferPolicy(value = {}) {
  if (!plain(value) || !['carry', 'revoice', 'releaseAndAttack', 'silentHandoff'].includes(value.policy ?? 'carry')) throw new Error('Invalid actor voice transfer policy.');
  return freeze({ policy: value.policy ?? 'carry', crossfadeSeconds: numeric(value.crossfadeSeconds, 0.08, 0, 4), destinationUnavailable: 'silence', physicalCrossing: 'one-completed-destination' });
}
export function createActionVoiceAdmission({ maxPending = 512 } = {}) {
  let definitions = [], signatures = new Map(), boundary = null; const pending = new Map();
  const configure = instruments => {
    definitions = instruments.filter(instrument => instrument.actionVoicePolicy);
    const next = new Map(definitions.map(instrument => [instrument.id, JSON.stringify(instrument.actionVoicePolicy)]));
    for (const [key, record] of pending) if (signatures.get(record.instrumentId) !== next.get(record.instrumentId)) pending.delete(key); signatures = next;
  };
  const prepare = batch => {
    if (boundary !== `${batch.worldId}:${batch.generation}`) { pending.clear(); boundary = `${batch.worldId}:${batch.generation}`; }
    const facts = []; let failure = null;
    for (const fact of batch.facts) {
      if (fact.kind === 'ActorTerminated' || fact.kind === 'ActionExited') for (const [key, record] of pending) if (record.actorId === fact.actorId && (fact.kind === 'ActorTerminated' || record.actionInstanceId === fact.actionInstanceId)) pending.delete(key);
      if (fact.kind === 'ActionEntered') for (const instrument of definitions) {
        const policy = instrument.actionVoicePolicy, key = `${instrument.id}/${fact.actorId}`;
        if (!policy.matchActions.includes(actionVoiceName(fact.action)) || policy.beginCondition === 'enter') { pending.delete(key); continue; }
        if (!pending.has(key) && pending.size >= maxPending) { failure = 'pending-action-voice-capacity'; continue; }
        pending.set(key, { instrumentId: instrument.id, actorId: fact.actorId, actionInstanceId: fact.actionInstanceId, action: actionVoiceName(fact.action),
          sourceEventId: fact.eventId, beginCondition: policy.beginCondition, admittedTick: batch.tick, maximumHoldTicks: policy.maximumHoldTicks });
      }
      if (fact.kind === 'MotionCommitted' || fact.kind === 'ContactResolved' || fact.kind === 'ContactSpanBegan') for (const [key, record] of pending) {
        if (record.actorId !== fact.actorId || fact.actionInstanceId != null && record.actionInstanceId !== fact.actionInstanceId ||
            record.beginCondition === 'motion' && fact.kind !== 'MotionCommitted' || record.beginCondition === 'contact' && fact.kind === 'MotionCommitted') continue;
        facts.push(freeze({ ...fact, kind: 'ActionEntered', action: record.action, actionInstanceId: record.actionInstanceId,
          policyAdmission: true, targetMappingId: record.instrumentId, sourceEventIds: [record.sourceEventId, fact.eventId], observationId: `${fact.eventId}:action-admission:${record.instrumentId}` })); pending.delete(key);
      }
    }
    for (const [key, record] of pending) if (batch.tick - record.admittedTick >= record.maximumHoldTicks) pending.delete(key);
    return freeze({ facts, completeness: failure ? { status: 'incomplete', reason: failure } : { status: 'complete' } });
  };
  return { configure, prepare, reset() { pending.clear(); boundary = null; }, snapshot: () => freeze({ version: 1, boundary, signatures: [...signatures], pending: [...pending].map(([key, value]) => [key, copy(value)]) }),
    restore(value) { if (value?.version !== 1 || value.boundary != null && typeof value.boundary !== 'string' || JSON.stringify(value.signatures) !== JSON.stringify([...signatures]) || !Array.isArray(value.pending) || value.pending.length > maxPending) throw new Error('Invalid action voice admission checkpoint.'); const next = new Map(); for (const [key, record] of value.pending) { if (key !== `${record.instrumentId}/${record.actorId}` || !signatures.has(record.instrumentId) || next.has(key) || !integer(record.actorId) || !integer(record.admittedTick) || !integer(record.maximumHoldTicks, 1000000) || !names.has(record.action) || typeof record.actionInstanceId !== 'string' || typeof record.sourceEventId !== 'string' || !['motion', 'contact'].includes(record.beginCondition)) throw new Error('Invalid pending action owner.'); next.set(key, copy(record)); } pending.clear(); for (const [key, record] of next) pending.set(key, record); boundary = value.boundary; },
    diagnostics: () => ({ pending: pending.size }) };
}
export function actionExpression(policy, fact) {
  const values = { displacementPixels: fact.physicalPayload?.displacementPixels, actionPhase: fact.actionPhase, heightPixels: fact.positionAfter?.y }, expression = {};
  for (const mapping of policy.expressionMappings) if (Number.isFinite(values[mapping.source])) expression[mapping.target] = Math.max(mapping.minimum, Math.min(mapping.maximum, values[mapping.source] * mapping.scale + mapping.offset));
  return expression;
}
