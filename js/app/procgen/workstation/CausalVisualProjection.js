import { procgenWorldToScreen } from '../ProcgenPresentationSnapshot.js';
import { explainCausalIntentLineage, causalSourceSuppression } from './CausalIntentLineage.js';

const freeze = Object.freeze;
export const isCausalMidiRelease = receipt => receipt.status === 'accepted' && receipt.terminalState === 'release-submitted' && receipt.targetTimeDomain === 'performance-microseconds';
export const isCausalBodyApplication = receipt => receipt.status === 'accepted' && receipt.stage === 'body-strike-applied' && receipt.targetTimeDomain === 'audio-sample-frames' &&
  receipt.applicationEvidence === 'processor-frame-acknowledged' && Number.isSafeInteger(receipt.appliedFrame) && receipt.appliedFrame >= 0 && receipt.appliedFrame === receipt.targetFrame &&
  Number.isSafeInteger(receipt.sampleRate) && receipt.sampleRate > 0 && /^[a-f0-9]{64}$/.test(receipt.bodyInstanceId || '') && /^[a-f0-9]{64}$/.test(receipt.graphDefinitionHash || '') &&
  typeof receipt.executionEpoch === 'string' && receipt.executionEpoch.length > 0 && typeof receipt.owner === 'string' && receipt.owner.length > 0 && typeof receipt.nodeId === 'string' && receipt.nodeId.length > 0 &&
  Number.isSafeInteger(receipt.ownerGeneration) && receipt.ownerGeneration >= 0 && Number.isSafeInteger(receipt.ownerRouteRevision) && receipt.ownerRouteRevision >= 0;
export const causalIntentOutcome = event => {
  const sinks = new Map();
  for (const receipt of event.receipts || []) { const key = JSON.stringify([receipt.sinkId ?? null, receipt.executionEpoch ?? null]); if (!sinks.has(key)) sinks.set(key, []); sinks.get(key).push(receipt); }
  const outcomes = new Set([...sinks.values()].map(receipts => {
    if (receipts.some(value => value.terminalState === 'cancelled')) return 'cancelled';
    if (receipts.some(value => value.status === 'rejected')) return 'rejected';
    if (receipts.some(value => value.status === 'degraded')) return 'degraded';
    if (receipts.some(isCausalBodyApplication)) return 'processor-applied';
    if (receipts.some(isCausalMidiRelease)) return 'api-release-submitted';
    if (receipts.some(value => value.status === 'accepted' && value.stage === 'submitted' && value.targetTimeDomain === 'performance-microseconds')) return 'api-submitted';
    if (receipts.some(value => value.status === 'accepted' && ['queued', 'scheduled'].includes(value.stage) && value.outputRequested)) return 'scheduled';
    return 'unconfirmed';
  }));
  if (outcomes.size > 1 && [...outcomes].every(value => value === 'rejected' || value === 'cancelled')) return 'rejected';
  return outcomes.size > 1 ? 'mixed' : outcomes.values().next().value || (event.kind === 'end' ? 'release-requested' : 'unconfirmed');
};
export const causalActionGlyph = source => {
  const kind = String(source.kind || '').toLowerCase(), action = String(source.action || '').toLowerCase();
  if (/cross|transfer|gate/.test(kind)) return '↦';
  if (/land|contactspan/.test(kind)) return '▽';
  if (/flight/.test(kind)) return '⌁';
  return /build/.test(action) ? '▱' : /bash|mine|dig/.test(action) || /terrainwork/.test(kind) ? '▰' : '◇';
};

export function projectCausalHistory({ displays = [], presentation = null, maximumMarks = 24, cellSize = 48 } = {}) {
  if (!Number.isInteger(maximumMarks) || maximumMarks < 1 || maximumMarks > 64 || !Number.isFinite(cellSize) || cellSize < 44) throw new RangeError('Invalid causal mark bounds.');
  const causes = new Map(), intentsSeen = new Set(), summary = { unlocated: 0, unrooted: 0, outside: 0, pending: 0, sourceMismatch: 0, conflicts: 0, omitted: 0, historyOmitted: 0, expired: 0 };
  let inspected = 0;
  for (const display of displays.slice(0, 9)) {
    summary.omitted = Math.max(summary.omitted, display.evidence?.omitted || 0); summary.historyOmitted = Math.max(summary.historyOmitted, display.evidence?.historyOmitted || 0); summary.expired = Math.max(summary.expired, display.evidence?.historyExpired || 0);
    for (const event of display.evidence?.history || []) {
      if (intentsSeen.has(event.intentId)) continue; intentsSeen.add(event.intentId);
      if (++inspected > 128) { summary.omitted++; continue; }
      const references = event.sources.length ? event.sources.slice(0, 4) : [{ intentOnly: true, eventId: null, recorded: false, tick: null, actorId: null, actorState: 'unrecorded', laneIndex: null, point: null }];
      for (const source of references) {
        const binding = event.sourceKey ?? [event.worldId, event.generation], key = JSON.stringify(source.intentOnly ? [binding, 'intent-only', event.intentId] : [binding, source.eventId]);
        const actorState = source.actorState || (source.recorded && source.actorId != null && source.actorId === event.actorId ? event.actorState : 'past-reference');
        let cause = causes.get(key);
        if (!cause) {
          if (causes.size >= 128) { summary.omitted++; continue; }
          cause = { key, referenceKind: source.intentOnly ? 'intent-only' : 'physical-source', sourceKey: event.sourceKey ?? null, eventId: source.eventId, worldId: event.worldId, generation: event.generation, tick: source.tick, laneIndex: source.recorded ? source.laneIndex ?? null : null,
            actorId: source.recorded ? source.actorId ?? null : null, actorState, action: source.action || null, kind: source.kind || null,
            point: source.recorded ? source.point : null, recorded: source.recorded, identityConflict: false, intents: [], mixes: [] };
          causes.set(key, cause);
          if (source.intentOnly) summary.unrooted++;
        } else if (!cause.recorded && source.recorded) {
          cause.recorded = true; cause.point = source.point; cause.tick = source.tick; cause.kind = source.kind; cause.action = source.action; cause.laneIndex = source.laneIndex ?? null; cause.actorId = source.actorId ?? null; cause.actorState = actorState;
        } else if (cause.recorded && source.recorded && !cause.identityConflict && (cause.tick !== source.tick || cause.actorId !== (source.actorId ?? null) || cause.laneIndex != null && source.laneIndex != null && cause.laneIndex !== source.laneIndex || cause.point && source.point && (cause.point.x !== source.point.x || cause.point.y !== source.point.y))) {
          cause.identityConflict = true; cause.point = null; cause.actorId = null; cause.laneIndex = null; cause.actorState = 'conflicting-reference';
        }
        if (!cause.identityConflict && actorState === 'terminated') cause.actorState = 'terminated';
        if (cause.intents.length < 16) { cause.intents.push(event); cause.mixes.push(freeze({ laneId: event.laneId, muted: typeof display.mix?.mute === 'boolean' ? display.mix.mute : null, soloSuppressed: typeof display.mix?.soloSuppressed === 'boolean' ? display.mix.soloSuppressed : null, revision: Number.isSafeInteger(display.mix?.revision) ? display.mix.revision : null })); } else summary.omitted++;
      }
    }
  }
  const bundles = new Map(), frozenCauses = [];
  for (const value of causes.values()) {
    const outcomes = [...new Set(value.intents.map(causalIntentOutcome))], outcome = outcomes.length > 1 ? 'mixed' : outcomes[0] || 'unconfirmed';
    const cause = freeze({ ...value, glyph: causalActionGlyph(value), outcome, suppressed: value.intents.some(causalSourceSuppression), intents: freeze(value.intents), mixes: freeze(value.mixes) }); frozenCauses.push(cause);
    if (cause.identityConflict) { summary.conflicts++; continue; }
    if (cause.referenceKind === 'intent-only') { summary.unlocated++; continue; }
    if (!presentation) { summary.pending++; continue; }
    if (cause.worldId !== presentation.worldId || cause.generation !== presentation.generation) { summary.sourceMismatch++; continue; }
    if (cause.tick == null || cause.tick > presentation.physicalTick) { summary.pending++; continue; }
    if (!cause.point) { summary.unlocated++; continue; }
    const laneIndex = cause.laneIndex ?? Math.floor(cause.point.y / presentation.laneHeight), point = procgenWorldToScreen(presentation, cause.point.x, cause.point.y, laneIndex);
    if (!point) { summary.outside++; continue; }
    const key = `${laneIndex}:${Math.floor((point.x - presentation.rect.left) / cellSize)}:${Math.floor((point.y - presentation.rect.top) / cellSize)}`;
    if (!bundles.has(key)) bundles.set(key, { key, laneIndex, causes: [], x: 0, y: 0 });
    const bundle = bundles.get(key); bundle.causes.push(cause); bundle.x += point.x; bundle.y += point.y;
  }
  const marks = [];
  for (const bundle of bundles.values()) {
    if (marks.length >= maximumMarks) { summary.omitted += bundle.causes.length; continue; }
    marks.push(freeze({ ...bundle, x: bundle.x / bundle.causes.length, y: bundle.y / bundle.causes.length, causes: freeze(bundle.causes), count: bundle.causes.length }));
  }
  return freeze({ version: 1, projectionRevision: presentation?.projectionRevision ?? null, causes: freeze(frozenCauses), marks: freeze(marks), summary: freeze(summary) });
}

export function explainCausalVisual(cause, intentIndex = 0) {
  const event = cause?.intents[intentIndex];
  if (!cause || !event) return 'This cause or intent is no longer retained. It cannot be rebound to a current actor.';
  const mix = cause.mixes?.[intentIndex], applied = event.receipts.filter(isCausalBodyApplication);
  const stages = [cause.referenceKind === 'intent-only' ? 'Physical fact: no source event ID retained. This is an unrooted intent reference; no physical event is invented.' : `Physical fact: ${cause.eventId}; ${cause.recorded ? 'observed source retained' : 'reference only; fact not retained'}; ${cause.action || cause.kind || 'unrecorded action'}; source tick ${cause.tick ?? 'unknown'}; actor ${cause.actorId ?? 'shared/unknown'} (${cause.actorState}).`,
    ...(cause.identityConflict ? ['Conflicting retained source copies: physical attribution and projection are unavailable; no actor is substituted.'] : []),
    `Source binding: ${cause.sourceKey || 'unrecorded'}; world ${cause.worldId}; generation ${cause.generation}.`,
    `Observed coordinate: ${cause.point ? `${cause.point.x}, ${cause.point.y} (${cause.point.evidence})` : 'unrecorded; no nearest-actor fallback'}.`,
    `Mapping/eligibility: ${event.mappingId || 'unknown'}; historical graph revision ${event.graphRevision ?? 'unknown'}; definition revision ${event.mappingRevision ?? 'unknown'}; ${event.mappingEvidence || 'unrecorded construction'}; individual eligibility receipt unrecorded.`,
    `Intent: ${event.intentId}; ${event.kind}; batch ${event.batchId}; voice ${event.voiceId || 'unknown'}; target lane ${event.laneId || 'unknown'}; voice owner actor ${event.actorId ?? 'shared/unknown'}; frozen pitch ${event.pitchCents ?? 'unknown'} cents; velocity ${event.velocity01 ?? 'unknown'}.`,
    ...explainCausalIntentLineage(event),
    `Admission/scheduling: ${causalIntentOutcome(event)}.`,
    ...event.receipts.map(receipt => `${receipt.sinkId || 'Unknown sink'}: ${receipt.status || 'unknown'} / ${receipt.stage || 'unknown'}; ${receipt.reason || 'no reason reported'}; target ${receipt.targetFrame ?? 'unknown'} ${receipt.targetTimeDomain || 'unreported domain'}; execution ${receipt.executionEpoch || 'unknown'}${receipt.terminalState ? '; terminal ' + receipt.terminalState : ''}.`),
    ...(applied.length ? applied.map(receipt => `Local command application: processor acknowledged frame ${receipt.appliedFrame} at ${receipt.sampleRate} Hz; body ${receipt.bodyInstanceId}; node ${receipt.nodeId}; graph ${receipt.graphDefinitionHash}; owner ${receipt.owner}, generation ${receipt.ownerGeneration}, route revision ${receipt.ownerRouteRevision}; execution ${receipt.executionEpoch}. Shared-body/tail PCM and individual audibility remain unconfirmed.`) : ['Local command application: no qualified individually correlated processor receipt retained.']),
    'Local render: individual PCM/audibility unrecorded. Shared-body/tail output cannot be attributed to this actor from an aggregate meter.',
    'Receiver/measured sink: unrecorded; API submission is not acoustic evidence.',
    `References: ${event.sources.map(source => source.eventId + (source.recorded ? '' : ' (unrecorded)')).join(', ') || 'unrecorded'}; ${event.omittedSources} source references / ${event.omittedReceipts} receipts omitted.`,
    `Current lane mix: ${mix?.muted ? 'muted' : mix?.soloSuppressed ? 'solo suppressed' : mix?.muted === false && mix?.soloSuppressed === false ? 'not suppressed' : 'unknown'}; target ${mix?.laneId || event.laneId || 'unknown'}; mix revision ${mix?.revision ?? 'unknown'} at inspection; separate from the historical admission.`];
  return stages.join('\n').slice(0, 32000);
}
