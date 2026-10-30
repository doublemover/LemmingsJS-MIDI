const freeze = Object.freeze;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
const label = value => typeof value === 'string' ? value.slice(0, 160) : null;
const natural = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : null;
export const causalSourceSuppression = event => event.kind === 'end' && event.terminationReason === 'transfer-destination-unavailable' ? event.terminationReason : null;

export function copyCausalIntentLineage(intent, batch) {
  const time = intent.scoreTime, transfer = intent.articulationState?.transfer, transition = intent.voiceTransition;
  return freeze({ onsetId: id(intent.onsetId), actionInstanceId: id(intent.actionInstanceId), terminationReason: label(intent.terminationReason),
    scoreTime: time && typeof time === 'object' ? freeze({ epoch: id(time.epoch), simTick: natural(time.simTick), subTick: Number.isFinite(time.subTick) && time.subTick >= 0 && time.subTick < 1 ? time.subTick : null,
      beat: nonnegative(time.beat), precision: label(time.precision), sourceTimeMs: nonnegative(time.sourceTimeMs), sourceTickDurationMs: Number.isFinite(time.sourceTickDurationMs) && time.sourceTickDurationMs > 0 ? time.sourceTickDurationMs : null }) : null,
    transfer: transfer && typeof transfer === 'object' ? freeze({ policy: label(transfer.policy), previousLaneId: natural(transfer.previousLaneId), laneId: natural(transfer.laneId), sourceEventId: id(transfer.sourceEventId), previousVoiceId: id(transfer.previousVoiceId) }) : null,
    voiceTransition: transition && typeof transition === 'object' ? freeze({ kind: label(transition.kind), seconds: nonnegative(transition.seconds), fromVoiceId: id(transition.fromVoiceId), fromActionInstanceId: id(transition.fromActionInstanceId), toActionInstanceId: id(transition.toActionInstanceId) }) : null,
    sourceCoverage: freeze({ status: label(batch.completeness?.status), dropped: natural(batch.completeness?.dropped) }) });
}

export function explainCausalIntentLineage(event) {
  const time = event.scoreTime, transfer = event.transfer, transition = event.voiceTransition;
  return [
    `Producer score time: epoch ${time?.epoch ?? 'unrecorded'}; simulation tick ${time?.simTick ?? 'unknown'} + ${time?.subTick ?? 'unknown'}; beat ${time?.beat ?? 'unknown'}; precision ${time?.precision ?? 'unknown'}; source time ${time?.sourceTimeMs ?? 'unknown'} ms; completed tick duration ${time?.sourceTickDurationMs ?? 'unknown'} ms.`,
    `Voice lifecycle: onset ${event.onsetId ?? 'unrecorded'}; action instance ${event.actionInstanceId ?? 'unrecorded'}; termination ${event.terminationReason ?? 'no reason recorded'}.`,
    ...(causalSourceSuppression(event) ? [`Producer suppression: ${event.terminationReason}; the held source ended without a replacement intent. This is separate from each sink's release admission.`] : []),
    ...(transfer ? [`Source transfer: ${transfer.policy ?? 'unrecorded policy'}; previous lane index ${transfer.previousLaneId ?? 'unknown'}; target lane index ${transfer.laneId ?? 'unknown'}; source ${transfer.sourceEventId ?? 'unrecorded'}; previous voice ${transfer.previousVoiceId ?? 'unrecorded'}.`] : []),
    ...(transition ? [`Voice transition: ${transition.kind ?? 'unrecorded kind'}; requested ${transition.seconds ?? 'unknown'} seconds; from voice ${transition.fromVoiceId ?? 'unrecorded'}; action ${transition.fromActionInstanceId ?? 'unrecorded'} to ${transition.toActionInstanceId ?? 'unrecorded'}. Applied crossfade/render evidence remains separate.`] : []),
    `Source coverage: ${event.sourceCoverage?.status ?? 'unrecorded'}; producer reports ${event.sourceCoverage?.dropped ?? 'unknown'} dropped facts. Missing trace is not evidence that an action or output did not occur.`
  ];
}
