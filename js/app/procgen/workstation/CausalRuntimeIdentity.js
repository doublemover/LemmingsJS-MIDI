export function causalRuntimeSourceVersions(world, mappingRevision, checkpointVersion = 2) {
  if (!world || !Number.isSafeInteger(mappingRevision) || mappingRevision < 0 || checkpointVersion !== 2) throw new Error('Unsupported current causal runtime source.');
  return Object.freeze({ generator: 'procgen-workstation-1', worldCheckpoint: checkpointVersion, stallCascade: world.stall?.settings?.cascadeDecisionVersion ?? 1,
    physicalBatch: 1, physicalMusic: 5, swarmReducer: 1, phraseCargo: 1, releaseGesture: 1, physicalFeedback: 1, physicalPlaybackAdmission: 1, instrumentPerformance: 3, project: 2, numericCanonicalization: 'finite-f64-minus-zero-v1', mappingRevision });
}
