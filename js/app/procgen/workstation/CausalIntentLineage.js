import { validateObservedMaterialResponse } from '../../../midi/content/MaterialResponseMap.js';

const freeze = Object.freeze;
const material = intent => { if (!intent.materialState) return null; try { return validateObservedMaterialResponse(intent.materialState); } catch { return freeze({ classification: 'unavailable', reason: 'invalid-retained-material-evidence' }); } };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
const label = value => typeof value === 'string' ? value.slice(0, 160) : null;
const natural = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : null;
export const causalSourceSuppression = event => event.kind === 'end' && event.terminationReason === 'transfer-destination-unavailable' ? event.terminationReason : null;

export function copyCausalIntentLineage(intent, batch) {
  const time = intent.scoreTime, transfer = intent.articulationState?.transfer, transition = intent.voiceTransition;
  const gesture = intent.sampleGestureState, sampleGestureState = gesture?.schema === 'lemmings-observed-sample-gesture-receipt/v1' && gesture.worldId === intent.worldId && gesture.generation === intent.generation && gesture.actorId === intent.actorId && intent.sourceEventIds?.includes(gesture.sourceEventId) ? freeze({ mapId: id(gesture.mapId), mapRevision: natural(gesture.mapRevision), gesture: label(gesture.gesture), sourceEventId: id(gesture.sourceEventId), workOperationId: id(gesture.workOperationId), surfaceRevision: natural(gesture.surfaceRevision), sourceCell: gesture.sourceCell && [gesture.sourceCell.x, gesture.sourceCell.y].every(Number.isSafeInteger) ? freeze({ x: gesture.sourceCell.x, y: gesture.sourceCell.y }) : null }) : null;
  return freeze({ ...(sampleGestureState ? { sampleGestureState } : {}), materialState: material(intent), onsetId: id(intent.onsetId), actionInstanceId: id(intent.actionInstanceId), terminationReason: label(intent.terminationReason),
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
    ...(event.sampleGestureState ? ['Sample articulation: ' + event.sampleGestureState.gesture + '; map ' + event.sampleGestureState.mapId + '@' + event.sampleGestureState.mapRevision + '; verified work cell ' + (event.sampleGestureState.sourceCell ? event.sampleGestureState.sourceCell.x + ', ' + event.sampleGestureState.sourceCell.y : 'unavailable') + '; terrain revision ' + event.sampleGestureState.surfaceRevision + '; operation ' + event.sampleGestureState.workOperationId + '; source ' + event.sampleGestureState.sourceEventId + '. This is an authored articulation boundary; output selection/application remains separate.'] : []),
    ...(event.materialState ? [`Material: ${event.materialState.classification}; body ${event.materialState.patchId ?? 'unavailable'}; ${event.materialState.reason}; material ID ${event.materialState.materialId ?? 'unclassified'}; tag ${event.materialState.tag ?? 'none'}; articulation ${event.materialState.articulation ?? 'unknown'}; normalized strike site ${event.materialState.site01 ?? 'unknown'}.`,
      `Material source: ${event.materialState.sourceEventId ?? 'unavailable'}; terrain revision ${event.materialState.surfaceRevision ?? 'unknown'}; cell ${event.materialState.sourceCell ? event.materialState.sourceCell.x + ', ' + event.materialState.sourceCell.y : 'unavailable'}; edit ${event.materialState.sourceEditId ?? 'none'}; held policy ${event.materialState.heldPolicy ?? 'unknown'}${event.materialState.workMaterial ? '; ' + event.materialState.workMaterial.changedSolidCells + ' changed solid cells, ' + event.materialState.workMaterial.phase + ', exact material consensus' : ''}.`] : []),
    ...(causalSourceSuppression(event) ? [`Producer suppression: ${event.terminationReason}; the held source ended without a replacement intent. This is separate from each sink's release admission.`] : []),
    ...(transfer ? [`Source transfer: ${transfer.policy ?? 'unrecorded policy'}; previous lane index ${transfer.previousLaneId ?? 'unknown'}; target lane index ${transfer.laneId ?? 'unknown'}; source ${transfer.sourceEventId ?? 'unrecorded'}; previous voice ${transfer.previousVoiceId ?? 'unrecorded'}.`] : []),
    ...(transition ? [`Voice transition: ${transition.kind ?? 'unrecorded kind'}; requested ${transition.seconds ?? 'unknown'} seconds; from voice ${transition.fromVoiceId ?? 'unrecorded'}; action ${transition.fromActionInstanceId ?? 'unrecorded'} to ${transition.toActionInstanceId ?? 'unrecorded'}. Applied crossfade/render evidence remains separate.`] : []),
    `Source coverage: ${event.sourceCoverage?.status ?? 'unrecorded'}; producer reports ${event.sourceCoverage?.dropped ?? 'unknown'} dropped facts. Missing trace is not evidence that an action or output did not occur.`
  ];
}
