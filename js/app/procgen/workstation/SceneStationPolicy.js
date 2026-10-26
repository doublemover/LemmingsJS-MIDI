export function inspectSceneStationRehearsal(scene) {
  const feedback = scene?.causalMappings?.feedback, rules = feedback?.conductors;
  const available = Array.isArray(rules) && !!rules.length && rules.some(rule => rule?.enabled !== false) && rules.length <= 8 && !(feedback.layers?.length) && rules.every(rule => rule?.source?.kind === 'PickupCrossing' && rule?.target?.kind === 'source-actor' && rule?.command?.kind === 'assign-worker' && rule.fuel === 1 && rule.eligibilityTicks === 0);
  return Object.freeze({ available, maximumRequests: available ? rules.filter(rule => rule.enabled !== false).length : 0, policy: 'explicit-private-one-shot-skill-stations;live-feedback-state-unchanged' });
}

export function sceneStationRehearsalReceipt(stations) {
  return stations ? { policy: stations.policy, requested: stations.requests.length, applied: stations.outcomes.filter(row => row.kind === 'CommandApplied').length, rejected: stations.outcomes.filter(row => row.kind === 'CommandRejected').length, pendingAtPrefixEnd: stations.pendingAtPrefixEnd.length, liveWorldArmedByRehearsal: false, liveFeedbackChanged: false } : null;
}
