import { procgenWorldToScreen } from '../ProcgenPresentationSnapshot.js';

const freeze = Object.freeze;
export const causalIntentOutcome = event => {
  const sinks = new Map();
  for (const receipt of event.receipts || []) { const key = JSON.stringify([receipt.sinkId ?? null, receipt.executionEpoch ?? null]); if (!sinks.has(key)) sinks.set(key, []); sinks.get(key).push(receipt); }
  const outcomes = new Set([...sinks.values()].map(receipts => {
    if (receipts.some(value => value.terminalState === 'cancelled')) return 'cancelled';
    if (receipts.some(value => value.status === 'rejected')) return 'rejected';
    if (receipts.some(value => value.status === 'degraded')) return 'degraded';
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
  const causes = new Map(), intentsSeen = new Set(), summary = { unlocated: 0, outside: 0, pending: 0, sourceMismatch: 0, omitted: 0, historyOmitted: 0, expired: 0 };
  let inspected = 0;
  for (const display of displays.slice(0, 9)) {
    summary.omitted = Math.max(summary.omitted, display.evidence?.omitted || 0); summary.historyOmitted = Math.max(summary.historyOmitted, display.evidence?.historyOmitted || 0); summary.expired = Math.max(summary.expired, display.evidence?.historyExpired || 0);
    for (const event of display.evidence?.history || []) {
      if (intentsSeen.has(event.intentId)) continue; intentsSeen.add(event.intentId);
      if (++inspected > 128) { summary.omitted++; continue; }
      for (const source of event.sources.slice(0, 4)) {
        const key = JSON.stringify([event.sourceKey ?? [event.worldId, event.generation], source.eventId]);
        let cause = causes.get(key);
        if (!cause) {
          if (causes.size >= 128) { summary.omitted++; continue; }
          cause = { key, sourceKey: event.sourceKey ?? null, eventId: source.eventId, worldId: event.worldId, generation: event.generation, tick: source.tick, laneIndex: source.laneIndex ?? event.laneIndex,
            actorId: source.actorId ?? event.actorId, actorState: event.actorState, action: source.action || event.action, kind: source.kind || event.sourceKind,
            point: source.recorded ? source.point : null, recorded: source.recorded, intents: [], muted: display.mix?.mute === true, soloSuppressed: display.mix?.soloSuppressed === true };
          causes.set(key, cause);
        } else if (!cause.recorded && source.recorded) { cause.recorded = true; cause.point = source.point; cause.tick = source.tick; cause.kind = source.kind; cause.action = source.action; }
        if (event.actorState === 'terminated') cause.actorState = 'terminated';
        if (cause.intents.length < 16) cause.intents.push(event); else summary.omitted++;
      }
    }
  }
  const bundles = new Map(), frozenCauses = [];
  for (const value of causes.values()) {
    const outcomes = [...new Set(value.intents.map(causalIntentOutcome))], outcome = outcomes.length > 1 ? 'mixed' : outcomes[0] || 'unconfirmed';
    const cause = freeze({ ...value, glyph: causalActionGlyph(value), outcome, intents: freeze(value.intents) }); frozenCauses.push(cause);
    if (!presentation) { summary.pending++; continue; }
    if (cause.worldId !== presentation.worldId || cause.generation !== presentation.generation) { summary.sourceMismatch++; continue; }
    if (cause.tick == null || cause.tick > presentation.physicalTick) { summary.pending++; continue; }
    if (!cause.point || cause.laneIndex == null) { summary.unlocated++; continue; }
    const point = procgenWorldToScreen(presentation, cause.point.x, cause.point.y, cause.laneIndex);
    if (!point) { summary.outside++; continue; }
    const key = `${cause.laneIndex}:${Math.floor((point.x - presentation.rect.left) / cellSize)}:${Math.floor((point.y - presentation.rect.top) / cellSize)}`;
    if (!bundles.has(key)) bundles.set(key, { key, causes: [], x: 0, y: 0 });
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
  const stages = [`Physical fact: ${cause.eventId}; ${cause.action || cause.kind || 'unrecorded action'}; source tick ${cause.tick ?? 'unknown'}; actor ${cause.actorId ?? 'shared/unknown'} (${cause.actorState}).`,
    `Source binding: ${cause.sourceKey || 'unrecorded'}; world ${cause.worldId}; generation ${cause.generation}.`,
    `Observed coordinate: ${cause.point ? `${cause.point.x}, ${cause.point.y} (${cause.point.evidence})` : 'unrecorded; no nearest-actor fallback'}.`,
    `Mapping/eligibility: ${event.mappingId || 'unknown'}; historical graph revision ${event.graphRevision ?? 'unknown'}; definition revision ${event.mappingRevision ?? 'unknown'}; ${event.mappingEvidence || 'unrecorded construction'}; individual eligibility receipt unrecorded.`,
    `Intent: ${event.intentId}; ${event.kind}; batch ${event.batchId}; voice ${event.voiceId || 'unknown'}; frozen pitch ${event.pitchCents ?? 'unknown'} cents; velocity ${event.velocity01 ?? 'unknown'}.`,
    `Admission/scheduling: ${causalIntentOutcome(event)}.`,
    ...event.receipts.map(receipt => `${receipt.sinkId || 'Unknown sink'}: ${receipt.status || 'unknown'} / ${receipt.stage || 'unknown'}; ${receipt.reason || 'no reason reported'}; target ${receipt.targetFrame ?? 'unknown'} ${receipt.targetTimeDomain || 'unreported domain'}; execution ${receipt.executionEpoch || 'unknown'}.`),
    'Local render: no individually correlated render receipt retained. Shared-body/tail output cannot be attributed to this actor from an aggregate meter.',
    'Receiver/measured sink: unrecorded; API submission is not acoustic evidence.',
    `References: ${event.sources.map(source => source.eventId + (source.recorded ? '' : ' (unrecorded)')).join(', ') || 'unrecorded'}; ${event.omittedSources} source references / ${event.omittedReceipts} receipts omitted.`,
    `Current lane mix: ${cause.muted ? 'muted' : cause.soloSuppressed ? 'solo suppressed' : 'not suppressed'}; current mix is separate from the historical admission.`];
  return stages.join('\n').slice(0, 32000);
}
