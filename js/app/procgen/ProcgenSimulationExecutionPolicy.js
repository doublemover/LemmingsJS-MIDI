import { freezeData } from '../../core/CanonicalData.js';
export function procgenSimulationExecutionPolicy(value = null) {
  const policy = value || { schema: 'lemmings-simulation-execution-policy/v1', physicalFeedbackMode: 'disabled' };
  if (policy.schema !== 'lemmings-simulation-execution-policy/v1' || !['disabled', 'preserve-live', 'exact-command-tape'].includes(policy.physicalFeedbackMode) ||
      Object.keys(policy).some(key => !['schema', 'physicalFeedbackMode'].includes(key))) throw new Error('Choose an explicit physical-feedback execution policy for this simulation continuation.');
  return freezeData({ schema: policy.schema, physicalFeedbackMode: policy.physicalFeedbackMode });
}
